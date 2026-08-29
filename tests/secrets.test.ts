import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The SMTP password was stored in plaintext, returned by the settings API and
 * rendered into the page as an input default. These cover the sealing that
 * replaced it — in particular that a tampered payload fails loudly rather than
 * decrypting to something plausible.
 */

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.APP_URL ??= 'http://localhost:3000'
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-value-that-is-long-enough-000'
  process.env.SECRET_ENCRYPTION_KEY ??= 'test-encryption-key-that-is-long-enough-0'
})

describe('secret sealing', () => {
  it('round-trips a value', async () => {
    const { encryptSecret, decryptSecret } = await import('@/app/lib/secrets')
    expect(decryptSecret(encryptSecret('hunter2'))).toBe('hunter2')
  })

  it('never emits the plaintext in the sealed form', async () => {
    const { encryptSecret } = await import('@/app/lib/secrets')
    expect(encryptSecret('hunter2')).not.toContain('hunter2')
  })

  it('produces a different ciphertext each time, so equal secrets are not linkable', async () => {
    const { encryptSecret } = await import('@/app/lib/secrets')
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('rejects a tampered ciphertext instead of returning garbage', async () => {
    const { encryptSecret, decryptSecret } = await import('@/app/lib/secrets')
    const sealed = encryptSecret('hunter2')
    const [v, iv, tag, data] = sealed.split(':')

    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 0xff

    expect(() =>
      decryptSecret(`${v}:${iv}:${tag}:${flipped.toString('base64')}`)
    ).toThrow()
  })

  it('rejects a malformed payload', async () => {
    const { decryptSecret } = await import('@/app/lib/secrets')
    expect(() => decryptSecret('not-sealed')).toThrow()
    expect(() => decryptSecret('v2:a:b:c')).toThrow()
  })
})
