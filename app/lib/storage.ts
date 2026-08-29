import 'server-only'

import crypto from 'crypto'
import { createReadStream } from 'fs'
import { mkdir, stat, writeFile } from 'fs/promises'
import path from 'path'

import { AppError } from './errors'

/**
 * Attachment storage.
 *
 * Uploads previously never left the browser: the UI produced a `blob:` or
 * `data:` URL and stored that string in the database, so every "attachment"
 * broke on reload and bloated rows. Bytes now land on disk under a key the
 * client never chooses, and are served only through an authorised route.
 *
 * This is a local-filesystem driver. It is a single-node story — swapping in
 * S3 means reimplementing `putObject`/`getObject` and nothing above them.
 */

const ROOT = path.resolve(process.cwd(), 'var', 'uploads')

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Allow-list, not a block-list. The value also decides the `Content-Type` we
 * serve back, so anything absent here can never be echoed as active content.
 */
const ALLOWED: Record<string, { ext: string; kind: 'pdf' | 'image' }> = {
  'application/pdf': { ext: 'pdf', kind: 'pdf' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
}

/** Magic-byte prefixes. A declared MIME type is a claim, not evidence. */
const SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
]

function sniff(buf: Buffer): string | null {
  for (const sig of SIGNATURES) {
    const at = sig.offset ?? 0
    if (buf.length < at + sig.bytes.length) continue
    if (sig.bytes.every((b, i) => buf[at + i] === b)) return sig.mime
  }
  return null
}

export type StoredFile = {
  name: string
  kind: 'pdf' | 'image'
  mimeType: string
  sizeBytes: number
  storageKey: string
  checksum: string
}

/**
 * Strips directories and anything exotic from a user-supplied filename. Only
 * used for the display name and the download header, never for the path.
 */
function safeDisplayName(name: string, ext: string): string {
  const base = path
    .basename(name)
    .replace(/[^\w. -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!base || base === '.' || base === '..') return `upload.${ext}`
  return base
}

export async function putObject(
  file: { name: string; type: string; bytes: Buffer },
): Promise<StoredFile> {
  if (file.bytes.length === 0) {
    throw new AppError('That file is empty.', 400, 'empty_file')
  }
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError('Files must be 10 MB or smaller.', 413, 'file_too_large')
  }

  const declared = file.type.toLowerCase().split(';')[0].trim()
  const allowed = ALLOWED[declared]
  if (!allowed) {
    throw new AppError(
      'Only PDF and image files (PNG, JPEG, WebP, GIF) can be attached.',
      415,
      'unsupported_file_type',
    )
  }

  // Reject a PDF renamed to .png, or a script wearing an image content-type.
  const actual = sniff(file.bytes)
  if (actual !== declared) {
    throw new AppError(
      'That file’s contents do not match its type.',
      415,
      'file_type_mismatch',
    )
  }

  const checksum = crypto.createHash('sha256').update(file.bytes).digest('hex')

  // Sharded by checksum prefix to keep directories small, and content-addressed
  // so re-uploading the same receipt is idempotent.
  const storageKey = `${checksum.slice(0, 2)}/${checksum}.${allowed.ext}`
  const target = path.join(ROOT, storageKey)

  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, file.bytes, { flag: 'w' })

  return {
    name: safeDisplayName(file.name, allowed.ext),
    kind: allowed.kind,
    mimeType: declared,
    sizeBytes: file.bytes.length,
    storageKey,
    checksum,
  }
}

/**
 * Resolves a stored key to a readable stream.
 *
 * The key is re-derived from its own components rather than trusted, and the
 * result is confirmed to sit inside ROOT, so `../` in a request path cannot
 * reach outside the upload directory.
 */
export async function getObject(storageKey: string) {
  if (!/^[0-9a-f]{2}\/[0-9a-f]{64}\.(pdf|png|jpg|webp|gif)$/.test(storageKey)) {
    throw new AppError('That file could not be found.', 404, 'not_found')
  }

  const target = path.resolve(ROOT, storageKey)
  if (target !== path.join(ROOT, storageKey) || !target.startsWith(ROOT + path.sep)) {
    throw new AppError('That file could not be found.', 404, 'not_found')
  }

  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) {
    throw new AppError('That file could not be found.', 404, 'not_found')
  }

  return { stream: createReadStream(target), sizeBytes: info.size }
}
