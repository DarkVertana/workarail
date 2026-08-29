'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/app/lib/auth'
import { prisma } from '@/app/lib/prisma'
import { getEnv, isGoogleOAuthConfigured } from '@/app/lib/env'
import { recordAudit } from '@/app/lib/audit'
import type { ResetState, SignInState, PasswordResetState } from '@/app/lib/auth-state'
import type { UserRole } from '@/generated/prisma'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Deliberately identical for "no such account", "wrong password" and
 * "account disabled", so the form cannot be used to enumerate valid users.
 */
const GENERIC_SIGNIN_FAILURE = 'That email address and password do not match.'

/** Where each role lands after signing in. */
export async function landingPathFor(role: UserRole): Promise<string> {
  switch (role) {
    case 'ADMIN':
      return '/admin/dashboard'
    case 'FINANCE':
      return '/finance'
    case 'MANAGER':
      return '/admin/timesheets'
    case 'CREW':
    default:
      return '/crew'
  }
}

export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const intent = String(formData.get('intent') ?? 'email')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const remember = formData.get('remember') === 'on'

  if (intent === 'back') {
    return { step: 'email', values: { email: prevState.values?.email } }
  }

  const emailError = !email
    ? 'Enter your email address.'
    : !EMAIL_PATTERN.test(email)
      ? 'Enter a valid email address.'
      : undefined

  if (intent === 'email') {
    if (emailError) {
      return { step: 'email', errors: { email: emailError }, values: { email } }
    }
    return { step: 'password', values: { email } }
  }

  if (emailError) {
    return { step: 'email', errors: { email: emailError }, values: { email } }
  }

  if (!password) {
    return {
      step: 'password',
      errors: { password: 'Enter your password.' },
      values: { email, remember },
    }
  }

  // A failed sign-in is a failure. It must never fall through to registration:
  // that behaviour turned any unknown email into an administrator account.
  try {
    await auth.api.signInEmail({
      body: { email, password, rememberMe: remember },
      headers: await headers(),
    })
  } catch (error) {
    console.warn('[auth] failed sign-in attempt', {
      email,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return {
      step: 'password',
      message: GENERIC_SIGNIN_FAILURE,
      values: { email, remember },
    }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, isActive: true },
  })

  if (!user || !user.isActive) {
    // Credentials were valid but the account is disabled — end the session.
    try {
      await auth.api.signOut({ headers: await headers() })
    } catch {
      // The session may already be gone; nothing further to do.
    }
    return {
      step: 'password',
      message: 'That account has been deactivated. Contact your administrator.',
      values: { email },
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  await recordAudit({
    actor: null,
    action: 'login',
    entity: 'User',
    entityId: user.id,
    summary: `${user.email} signed in`,
  })

  redirect(await landingPathFor(user.role))
}

export async function signInWithGoogle(): Promise<SignInState> {
  // No development mock. The previous fallback registered and signed in a
  // hardcoded administrator whenever GOOGLE_CLIENT_ID was unset.
  if (!isGoogleOAuthConfigured()) {
    return {
      step: 'email',
      message: 'Google sign-in is not configured. Sign in with your email address.',
    }
  }

  const env = getEnv()
  let redirectUrl: string | null = null

  try {
    const res = await auth.api.signInSocial({
      body: { provider: 'google', callbackURL: `${env.APP_URL}/` },
      headers: await headers(),
    })
    if (res?.url) redirectUrl = res.url
  } catch (error) {
    console.error('[auth] google sign-in failed', error)
    return { step: 'email', message: 'Google sign-in failed. Try again.' }
  }

  if (redirectUrl) redirect(redirectUrl)
  return { step: 'email' }
}

export async function signOut(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() })
  } catch {
    // Signing out is best-effort; the cookie is cleared either way.
  }
  redirect('/signin')
}

export async function requestPasswordReset(
  _prevState: ResetState,
  formData: FormData
): Promise<ResetState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  if (!email) {
    return { status: 'idle', error: 'Enter your email address.', values: { email } }
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { status: 'idle', error: 'Enter a valid email address.', values: { email } }
  }

  try {
    const env = getEnv()
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${env.APP_URL}/reset-password` },
      headers: await headers(),
    })
  } catch (error) {
    // Never surface whether the address exists — always report the same
    // outcome, and log the real reason server-side.
    console.error('[auth] password reset request failed', error)
  }

  return { status: 'sent', values: { email } }
}

export async function resetPassword(
  _prevState: PasswordResetState,
  formData: FormData
): Promise<PasswordResetState> {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const token = String(formData.get('token') ?? '')

  if (!password) {
    return { error: 'Enter a new password.', values: { password, confirmPassword } }
  }
  if (password.length < 12) {
    return {
      error: 'Password must be at least 12 characters.',
      values: { password, confirmPassword },
    }
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return {
      error: 'Password must include upper and lower case letters and a number.',
      values: { password, confirmPassword },
    }
  }
  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.', values: { password, confirmPassword } }
  }
  if (!token) {
    return { error: 'That reset link is invalid or has expired.', values: { password, confirmPassword } }
  }

  try {
    await auth.api.resetPassword({
      body: { token, newPassword: password },
      headers: await headers(),
    })
  } catch (error) {
    console.error('[auth] password reset failed', error)
    return {
      error: 'That reset link is invalid or has expired. Request a new one.',
      values: { password, confirmPassword },
    }
  }

  redirect('/signin?reset=success')
}
