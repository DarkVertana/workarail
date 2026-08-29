import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Uploads never reached the server before: the browser produced a `blob:` or
 * `data:` URL and that string was stored as the "attachment". These cover the
 * checks that replaced it — the type allow-list, the magic-byte cross-check,
 * and the refusal to resolve a key outside the upload directory.
 */

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.APP_URL ??= 'http://localhost:3000'
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-value-that-is-long-enough-000'
  process.env.SECRET_ENCRYPTION_KEY ??= 'test-encryption-key-that-is-long-enough-0'
})

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(16)])

describe('putObject', () => {
  it('stores a genuine PNG and returns a key that is not attacker-chosen', async () => {
    const { putObject } = await import('@/app/lib/storage')
    const stored = await putObject({ name: 'receipt.png', type: 'image/png', bytes: PNG })

    expect(stored.kind).toBe('image')
    expect(stored.mimeType).toBe('image/png')
    expect(stored.sizeBytes).toBe(PNG.length)
    expect(stored.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.png$/)
  })

  it('is idempotent, so re-uploading the same file does not duplicate it', async () => {
    const { putObject } = await import('@/app/lib/storage')
    const a = await putObject({ name: 'a.pdf', type: 'application/pdf', bytes: PDF })
    const b = await putObject({ name: 'b.pdf', type: 'application/pdf', bytes: PDF })

    expect(a.storageKey).toBe(b.storageKey)
  })

  it('strips a path out of the display name', async () => {
    const { putObject } = await import('@/app/lib/storage')
    const stored = await putObject({
      name: '../../etc/passwd.png',
      type: 'image/png',
      bytes: PNG,
    })

    expect(stored.name).not.toContain('/')
    expect(stored.name).not.toContain('..')
  })

  it('refuses a type outside the allow-list', async () => {
    const { putObject } = await import('@/app/lib/storage')
    await expect(
      putObject({
        name: 'payload.svg',
        type: 'image/svg+xml',
        bytes: Buffer.from('<svg onload="alert(1)"/>'),
      })
    ).rejects.toThrow(/PDF and image/i)
  })

  it('refuses content that does not match its declared type', async () => {
    const { putObject } = await import('@/app/lib/storage')
    // An HTML page announcing itself as a PNG — the case a declared
    // content-type alone would wave through.
    await expect(
      putObject({
        name: 'evil.png',
        type: 'image/png',
        bytes: Buffer.from('<html><script>alert(1)</script></html>'),
      })
    ).rejects.toThrow(/do not match/i)
  })

  it('refuses an empty file and an oversized one', async () => {
    const { putObject, MAX_UPLOAD_BYTES } = await import('@/app/lib/storage')

    await expect(
      putObject({ name: 'empty.png', type: 'image/png', bytes: Buffer.alloc(0) })
    ).rejects.toThrow(/empty/i)

    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES + 1)])
    await expect(
      putObject({ name: 'huge.png', type: 'image/png', bytes: huge })
    ).rejects.toThrow(/10 MB/i)
  })
})

describe('getObject', () => {
  it('refuses keys that try to escape the upload directory', async () => {
    const { getObject } = await import('@/app/lib/storage')

    for (const key of [
      '../../../etc/passwd',
      'ab/../../etc/passwd',
      '/etc/passwd',
      'ab/cd.png',
      'ab/' + 'f'.repeat(64) + '.exe',
    ]) {
      await expect(getObject(key)).rejects.toThrow(/could not be found/i)
    }
  })

  it('reads back a file that was just stored', async () => {
    const { putObject, getObject } = await import('@/app/lib/storage')
    const stored = await putObject({ name: 'ok.png', type: 'image/png', bytes: PNG })

    const { sizeBytes } = await getObject(stored.storageKey)
    expect(sizeBytes).toBe(PNG.length)
  })
})
