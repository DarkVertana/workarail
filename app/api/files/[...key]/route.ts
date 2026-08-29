import { NextRequest, NextResponse } from 'next/server'
import type { ReadableStream as NodeReadableStream } from 'stream/web'
import { Readable } from 'stream'

import { getActor, visibleStaffRefs } from '@/app/lib/authz'
import { AppError, errorResponse } from '@/app/lib/errors'
import { prisma } from '@/app/lib/prisma'
import { getObject } from '@/app/lib/storage'

export const runtime = 'nodejs'

/**
 * Serves an attachment to callers entitled to see it.
 *
 * Attachments used to be `blob:`/`data:` strings rendered straight into an
 * href, which meant no access control existed at all. Every read now costs an
 * ownership check: staff see their own receipts and documents, approvers and
 * finance see the records they act on.
 */
async function mayRead(
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
  attachmentId: string,
): Promise<boolean> {
  if (actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE') return true

  // The refs this actor may see: their own for CREW, their crew and reports
  // for MANAGER. A previous version asked "is this attached to *any* expense?"
  // using `some: {}` — an empty predicate that matches every row — which let
  // any manager read every receipt, leave attachment, invoice PDF and payment
  // proof in the company, including for staff outside their crew.
  const refs = await visibleStaffRefs(actor)
  if (refs !== null && refs.length === 0) return false

  const scope = refs === null ? {} : { staffRef: { in: refs } }

  const permitted = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      OR: [
        { expenses: { some: scope } },
        { leaveRequests: { some: scope } },
        { documents: { some: scope } },
      ],
    },
    select: { id: true },
  })
  return Boolean(permitted)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    const actor = await getActor()
    if (!actor) {
      throw new AppError('Sign in to view this file.', 401, 'unauthenticated')
    }

    const { key } = await params
    const storageKey = key.map(decodeURIComponent).join('/')

    const attachment = await prisma.attachment.findUnique({
      where: { storageKey },
      select: { id: true, name: true, mimeType: true },
    })
    // Same response whether the file is absent or forbidden, so the route
    // cannot be used to probe which receipts exist.
    if (!attachment || !(await mayRead(actor, attachment.id))) {
      throw new AppError('That file could not be found.', 404, 'not_found')
    }

    const { stream, sizeBytes } = await getObject(storageKey)

    return new NextResponse(
      Readable.toWeb(stream) as NodeReadableStream as ReadableStream,
      {
        headers: {
          'Content-Type': attachment.mimeType,
          'Content-Length': String(sizeBytes),
          // Never let a stored file execute in our origin, and never let a
          // browser second-guess the declared type.
          'Content-Disposition': `inline; filename="${attachment.name.replace(/"/g, '')}"`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          // Private: these are per-user documents behind an auth check.
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      },
    )
  } catch (err) {
    return errorResponse(err, 'GET /api/files')
  }
}
