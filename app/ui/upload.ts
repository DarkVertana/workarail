'use client'

/** The reference a form submits once its file is safely stored server-side. */
export type AttachmentRef = {
  name: string
  kind: 'pdf' | 'image'
  mimeType: string
  sizeBytes: number
  storageKey: string
}

/**
 * Sends a picked file to the server and returns its stored reference.
 *
 * Forms used to inline the file as a `data:` URL and post that as the
 * "attachment", which never survived a reload and bloated every row. The bytes
 * now go to storage first, and only the key travels with the form.
 */
export async function uploadAttachment(file: File): Promise<AttachmentRef> {
  const body = new FormData()
  body.append('file', file)

  const res = await fetch('/api/files', { method: 'POST', body })
  const payload = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(payload?.error ?? 'That file could not be uploaded.')
  }

  return payload as AttachmentRef
}

/** Human-readable size, for the "Attached: receipt.pdf (128 KB)" hint. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
