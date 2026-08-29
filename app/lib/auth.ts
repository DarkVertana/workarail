import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "./prisma";
import { nextCookies } from "better-auth/next-js";
import crypto from "crypto";
import { sendEmail } from "./mail";
import { getEnv, isGoogleOAuthConfigured } from "./env";

const env = getEnv();

/**
 * scrypt with a per-user salt. `verify` uses a timing-safe comparison —
 * a plain string equality check on the derived key leaks information about
 * how many leading bytes matched.
 */
const password = {
  hash: async (plain: string) =>
    new Promise<string>((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString("hex");
      crypto.scrypt(plain, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt}:${derivedKey.toString("hex")}`);
      });
    }),

  verify: async ({ hash, password: plain }: { hash: string; password: string }) =>
    new Promise<boolean>((resolve) => {
      const [salt, key] = hash.split(":");
      if (!salt || !key) return resolve(false);
      crypto.scrypt(plain, salt, 64, (err, derivedKey) => {
        if (err || !derivedKey) return resolve(false);
        const expected = Buffer.from(key, "hex");
        if (expected.length !== derivedKey.length) return resolve(false);
        resolve(crypto.timingSafeEqual(expected, derivedKey));
      });
    }),
};

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: env.APP_URL,

  emailAndPassword: {
    enabled: true,
    /**
     * Accounts are created by an administrator or a seed script only. Public
     * self-registration is what allowed an unknown email to become an
     * administrator, so it stays off.
     */
    disableSignUp: true,
    minPasswordLength: 12,
    password,
    sendResetPassword: async ({ user, token }) => {
      const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your password - Work à Rail",
        html: resetEmailHtml(resetUrl),
      });
    },
  },

  /**
   * Throttles credential stuffing and password-reset abuse. Previously absent
   * entirely, so sign-in could be attacked at full speed.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    customRules: {
      "/sign-in/email": { window: 300, max: 5 },
      "/forget-password": { window: 900, max: 3 },
      "/reset-password": { window: 900, max: 5 },
    },
  },

  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },

  // Only registered when real credentials exist. There is no mock provider:
  // the previous development fallback signed anyone in as an administrator.
  ...(isGoogleOAuthConfigured()
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),

  secret: env.BETTER_AUTH_SECRET,
  plugins: [nextCookies()],
});

function resetEmailHtml(resetUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1c1917; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 12px;">
      <div style="margin-bottom: 24px;">
        <span style="font-size: 1.25rem; font-weight: 700; color: #4f46e5; letter-spacing: -0.025em;">Work à Rail</span>
      </div>
      <h2 style="font-size: 1.125rem; font-weight: 600; color: #1c1917; margin-top: 0; margin-bottom: 12px;">Reset your password</h2>
      <p style="font-size: 0.875rem; line-height: 1.6; color: #57534e; margin-top: 0; margin-bottom: 24px;">
        We received a request to reset the password for your Work à Rail account.
        Click the button below to choose a new password. This link will expire in 1 hour.
      </p>
      <div style="margin-bottom: 24px;">
        <a href="${resetUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-size: 0.875rem; font-weight: 500; text-decoration: none; padding: 10px 18px; border-radius: 8px;">
          Reset password
        </a>
      </div>
      <p style="font-size: 0.8125rem; line-height: 1.5; color: #78716c; margin-top: 0; margin-bottom: 24px;">
        If the button doesn't work, copy and paste this link into your browser:
        <br />
        <a href="${resetUrl}" style="color: #4f46e5; text-decoration: none; word-break: break-all;">${resetUrl}</a>
      </p>
      <hr style="border: 0; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
      <p style="font-size: 0.75rem; line-height: 1.4; color: #a8a29e; margin: 0;">
        If you didn't request a password reset, you can safely ignore this email.
      </p>
    </div>
  `;
}
