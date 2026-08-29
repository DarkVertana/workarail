import { NextRequest, NextResponse } from 'next/server'

import { requireActor } from '@/app/lib/authz'
import { errorResponse, AppError } from '@/app/lib/errors'
import { prisma } from '@/app/lib/prisma'
import { MAX_UPLOAD_BYTES, putObject } from '@/app/lib/storage'

export const runtime = 'nodejs'

/**
 * Accepts an upload and returns the reference a form should submit alongside
 * the rest of its fields.
 *
 * Splitting upload from record creation keeps the multipart body out of the
 * Server Actions, and means a rejected expense claim does not silently drop
 * the receipt the user already picked.
 */
export async function POST(req: NextRequest) {
  try {
    // Any signed-in user may upload; what they may then attach it to is
    // enforced by the action that consumes the key.
    const actor = await requireActor()

    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_UPLOAD_BYTES * 1.1) {
      throw new AppError('Files must be 10 MB or smaller.', 413, 'file_too_large')
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new AppError('No file was included in the upload.', 400, 'missing_file')
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const stored = await putObject({ name: file.name, type: file.type, bytes })

    // Content-addressed keys make re-uploads idempotent, so reuse the existing
    // row rather than colliding on the unique storageKey.
    const attachment = await prisma.attachment.upsert({
      where: { storageKey: stored.storageKey },
      update: {},
      create: {
        name: stored.name,
        kind: stored.kind,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        checksum: stored.checksum,
        uploadedById: actor.user.id,
      },
      select: { id: true, name: true, kind: true, mimeType: true, sizeBytes: true, storageKey: true },
    })

    return NextResponse.json(attachment, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/files')
  }
}
