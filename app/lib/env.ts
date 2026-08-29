/**
 * Environment validation.
 *
 * Every secret this application depends on is required to be present and
 * non-trivial at startup. There are deliberately no fallback values: a deploy
 * that forgets a variable must fail loudly rather than silently run on a
 * publicly-known default, which is how the previous hardcoded
 * `default-better-auth-secret-key-123456` made every session forgeable.
 */

const MIN_SECRET_LENGTH = 32

/** Values that must never be accepted as a real secret. */
const FORBIDDEN_SECRETS = new Set([
  'default-better-auth-secret-key-123456',
  'secret',
  'changeme',
  'development',
  'mock',
])

type Env = {
  DATABASE_URL: string
  APP_URL: string
  BETTER_AUTH_SECRET: string
  /** Used to encrypt secrets at rest (SMTP password and similar). */
  SECRET_ENCRYPTION_KEY: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  isProduction: boolean
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `[config] ${name} is required but was not set. Refusing to start. ` +
        `See .env.example for the full list of required variables.`
    )
  }
  return value.trim()
}

function requiredSecret(name: string): string {
  const value = required(name)
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[config] ${name} must be at least ${MIN_SECRET_LENGTH} characters. ` +
        `Generate one with: openssl rand -base64 32`
    )
  }
  if (FORBIDDEN_SECRETS.has(value.toLowerCase())) {
    throw new Error(
      `[config] ${name} is set to a well-known placeholder value. ` +
        `Generate a real secret with: openssl rand -base64 32`
    )
  }
  return value
}

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached

  cached = {
    DATABASE_URL: required('DATABASE_URL'),
    APP_URL: required('APP_URL').replace(/\/$/, ''),
    BETTER_AUTH_SECRET: requiredSecret('BETTER_AUTH_SECRET'),
    SECRET_ENCRYPTION_KEY: requiredSecret('SECRET_ENCRYPTION_KEY'),
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
    isProduction: process.env.NODE_ENV === 'production',
  }

  // Google OAuth is optional, but half-configured is always a mistake.
  const hasId = Boolean(cached.GOOGLE_CLIENT_ID)
  const hasSecret = Boolean(cached.GOOGLE_CLIENT_SECRET)
  if (hasId !== hasSecret) {
    throw new Error(
      '[config] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together, or neither.'
    )
  }

  return cached
}

/** True when real Google OAuth credentials are configured. */
export function isGoogleOAuthConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}
