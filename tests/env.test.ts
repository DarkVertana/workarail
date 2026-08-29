import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `BETTER_AUTH_SECRET` was never set in this project, and the code fell back to
 * a hardcoded `default-better-auth-secret-key-123456`, which made every session
 * cookie forgeable by anyone who had read the source. These pin the refusal to
 * start on a missing or well-known secret.
 *
 * The module caches its result, so each case re-imports it with a fresh
 * registry.
 */

const GOOD = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/workarail',
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'B'.repeat(40),
  SECRET_ENCRYPTION_KEY: 'S'.repeat(40),
}

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  vi.resetModules()
  for (const key of [
    ...Object.keys(GOOD),
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ]) {
    delete process.env[key]
  }
})

afterEach(() => {
  process.env = saved
})

async function loadEnv() {
  return (await import('@/app/lib/env')).getEnv()
}

describe('getEnv', () => {
  it('accepts a fully configured environment', async () => {
    Object.assign(process.env, GOOD)
    const env = await loadEnv()

    expect(env.DATABASE_URL).toBe(GOOD.DATABASE_URL)
    expect(env.BETTER_AUTH_SECRET).toBe(GOOD.BETTER_AUTH_SECRET)
  })

  it.each(Object.keys(GOOD))('refuses to start when %s is missing', async (missing) => {
    Object.assign(process.env, GOOD)
    delete process.env[missing]

    await expect(loadEnv()).rejects.toThrow(new RegExp(missing))
  })

  it('rejects the hardcoded secret this replaced', async () => {
    Object.assign(process.env, GOOD, {
      BETTER_AUTH_SECRET: 'default-better-auth-secret-key-123456',
    })

    await expect(loadEnv()).rejects.toThrow(/placeholder/i)
  })

  it('rejects a secret that is too short to be meaningful', async () => {
    Object.assign(process.env, GOOD, { SECRET_ENCRYPTION_KEY: 'short' })
    await expect(loadEnv()).rejects.toThrow(/at least 32/i)
  })

  it('treats a whitespace-only value as missing', async () => {
    Object.assign(process.env, GOOD, { APP_URL: '   ' })
    await expect(loadEnv()).rejects.toThrow(/APP_URL/)
  })

  it('trims the trailing slash from APP_URL so callback URLs do not double up', async () => {
    Object.assign(process.env, GOOD, { APP_URL: 'https://example.com/' })
    expect((await loadEnv()).APP_URL).toBe('https://example.com')
  })

  it('rejects half-configured Google OAuth', async () => {
    Object.assign(process.env, GOOD, { GOOGLE_CLIENT_ID: 'id-only' })
    await expect(loadEnv()).rejects.toThrow(/together/i)
  })

  it('treats absent Google credentials as "no Google sign-in", not as a mock', async () => {
    Object.assign(process.env, GOOD)
    const { getEnv, isGoogleOAuthConfigured } = await import('@/app/lib/env')

    getEnv()
    expect(isGoogleOAuthConfigured()).toBe(false)
  })

  it('treats empty Google credentials as absent', async () => {
    // The live .env had GOOGLE_CLIENT_ID= with no value, which the old code
    // read as configured and then substituted mock credentials for.
    Object.assign(process.env, GOOD, { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' })
    const { getEnv, isGoogleOAuthConfigured } = await import('@/app/lib/env')

    getEnv()
    expect(isGoogleOAuthConfigured()).toBe(false)
  })
})
