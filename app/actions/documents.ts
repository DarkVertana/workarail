'use server'

/**
 * Staff compliance documents.
 *
 * `StaffDocument` had a table, indexes, a Zod schema and a `documentExpiring`
 * notification helper — and no create, read, review or expiry code anywhere.
 * All five `DocumentStatus` values were unreachable. For a rail contractor
 * this is the PTS card, medical certificate and right-to-work record, so its
 * absence is a safety and compliance gap rather than merely dead schema: the
 * product could not answer "is this person cleared to be on track today?".
 *
 * Status is *derived*, not chosen. A reviewer decides `valid` or `rejected`;
 * whether a valid document is `expiring` or `expired` follows from its expiry
 * date and today, so a certificate cannot sit in the database marked valid
 * while being three months out of date.
 */

import { revalidatePath } from 'next/cache'

import { prisma } from '@/app/lib/prisma'
import { recordAudit } from '@/app/lib/audit'
import {
  requireActor,
  requireAdmin,
  requireStaff,
  requireStaffAccess,
  visibleStaffRefs,
} from '@/app/lib/authz'
import {
  actionFailed,
  actionOk,
  Conflict,
  NotFound,
  type ActionResult,
} from '@/app/lib/errors'
import { notify } from '@/app/lib/notifications'
import { addDays, businessToday, fromStoredDate, utcDate } from '@/app/lib/dates'
import {
  parseOrThrow,
  reviewDocumentSchema,
  staffDocumentSchema,
} from '@/app/lib/validation'
import type { DocumentStatus } from '@/generated/prisma'

/** How far ahead a document counts as "expiring" rather than simply valid. */
export const EXPIRY_WARNING_DAYS = 60

/**
 * The status a reviewed document actually has today.
 *
 * A stored `valid` is a statement about the review, not about time. Expiry is
 * a function of the date, so it is computed on read — otherwise the roster
 * would show a cleared operative whose medical lapsed last month.
 */
export function effectiveStatus(
  stored: DocumentStatus,
  expiresOn: string | null,
  today = businessToday()
): DocumentStatus {
  if (stored === 'pending_review' || stored === 'rejected') return stored
  if (!expiresOn) return 'valid'
  if (expiresOn < today) return 'expired'
  if (expiresOn <= addDays(today, EXPIRY_WARNING_DAYS)) return 'expiring'
  return 'valid'
}

export type StaffDocumentView = {
  id: string
  staffRef: string
  staffName: string
  kind: string
  reference: string | null
  status: DocumentStatus
  issuedOn: string | null
  expiresOn: string | null
  daysUntilExpiry: number | null
  notes: string | null
  attachmentId: string | null
  attachmentName: string | null
  uploadedAt: string
}

function toView(row: {
  id: string
  staffRef: string
  staff: { name: string }
  kind: string
  reference: string | null
  status: DocumentStatus
  issuedOn: Date | null
  expiresOn: Date | null
  notes: string | null
  attachmentId: string | null
  attachment: { name: string } | null
  createdAt: Date
}): StaffDocumentView {
  const today = businessToday()
  const expiresOn = row.expiresOn ? fromStoredDate(row.expiresOn) : null
  return {
    id: row.id,
    staffRef: row.staffRef,
    staffName: row.staff.name,
    kind: row.kind,
    reference: row.reference,
    status: effectiveStatus(row.status, expiresOn, today),
    issuedOn: row.issuedOn ? fromStoredDate(row.issuedOn) : null,
    expiresOn,
    daysUntilExpiry: expiresOn
      ? Math.round((utcDate(expiresOn).getTime() - utcDate(today).getTime()) / 86_400_000)
      : null,
    notes: row.notes,
    attachmentId: row.attachmentId,
    attachmentName: row.attachment?.name ?? null,
    uploadedAt: fromStoredDate(row.createdAt),
  }
}

const INCLUDE = {
  staff: { select: { name: true } },
  attachment: { select: { name: true } },
} as const

/**
 * Documents for the office screens, scoped to what the caller may see.
 * A MANAGER sees their crew's compliance, not the whole company's.
 */
export async function getStaffDocuments(staffRef?: string): Promise<StaffDocumentView[]> {
  const actor = await requireActor()

  if (staffRef) {
    await requireStaffAccess(staffRef)
    const rows = await prisma.staffDocument.findMany({
      where: { staffRef },
      include: INCLUDE,
      orderBy: [{ expiresOn: 'asc' }],
    })
    return rows.map(toView)
  }

  const refs = await visibleStaffRefs(actor)
  const rows = await prisma.staffDocument.findMany({
    where: refs === null ? {} : { staffRef: { in: refs } },
    include: INCLUDE,
    orderBy: [{ expiresOn: 'asc' }],
    take: 500,
  })
  return rows.map(toView)
}

/** An employee's own compliance record, for the crew portal. */
export async function getMyDocuments(): Promise<StaffDocumentView[]> {
  const actor = await requireStaff()
  const rows = await prisma.staffDocument.findMany({
    where: { staffRef: actor.staff.ref },
    include: INCLUDE,
    orderBy: [{ expiresOn: 'asc' }],
  })
  return rows.map(toView)
}

/**
 * Records a document. Always enters as `pending_review` — an employee
 * uploading their own PTS card cannot self-certify it as valid.
 */
export async function addStaffDocument(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor()
    const data = parseOrThrow(staffDocumentSchema, input)
    await requireStaffAccess(data.staffRef, actor)

    if (data.issuedOn && data.expiresOn && data.expiresOn < data.issuedOn) {
      throw Conflict('The expiry date is before the issue date.')
    }

    const created = await prisma.$transaction(async (tx) => {
      // The upload route has already persisted the bytes and upserted an
      // Attachment row keyed on the opaque storage key, so the document links
      // to that row rather than re-creating one.
      let attachmentId: string | null = null
      if (data.attachment) {
        const stored = await tx.attachment.upsert({
          where: { storageKey: data.attachment.storageKey },
          update: {},
          create: { ...data.attachment, uploadedById: actor.user.id },
          select: { id: true },
        })
        attachmentId = stored.id
      }

      const row = await tx.staffDocument.create({
        data: {
          staffRef: data.staffRef,
          kind: data.kind,
          reference: data.reference || null,
          status: 'pending_review',
          issuedOn: data.issuedOn ? utcDate(data.issuedOn) : null,
          expiresOn: data.expiresOn ? utcDate(data.expiresOn) : null,
          attachmentId,
          uploadedById: actor.user.id,
          notes: data.notes || null,
        },
      })

      await recordAudit(
        {
          actor,
          action: 'create',
          entity: 'StaffDocument',
          entityId: row.id,
          summary: `Added ${data.kind.replace(/_/g, ' ')} for ${data.staffRef}`,
          after: {
            kind: data.kind,
            staffRef: data.staffRef,
            expiresOn: data.expiresOn ?? null,
          },
        },
        tx
      )

      return row
    })

    revalidatePath('/admin/compliance')
    revalidatePath('/crew/documents')
    return actionOk({ id: created.id })
  } catch (err) {
    return actionFailed(err, 'addStaffDocument')
  }
}

/**
 * Reviews a pending document. Admin only: accepting a right-to-work check or
 * a PTS card is the control that keeps someone off track illegally, so it is
 * not delegated to the crew's own manager.
 */
export async function reviewStaffDocument(
  input: unknown
): Promise<ActionResult<{ status: DocumentStatus }>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(reviewDocumentSchema, input)

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.staffDocument.findUnique({
        where: { id: data.documentId },
      })
      if (!existing) throw NotFound('That document no longer exists.')
      if (existing.status !== 'pending_review') {
        throw Conflict('That document has already been reviewed.')
      }

      const expiresOn =
        data.expiresOn !== undefined
          ? data.expiresOn
            ? utcDate(data.expiresOn)
            : null
          : existing.expiresOn

      const row = await tx.staffDocument.update({
        where: { id: data.documentId },
        data: { status: data.decision, notes: data.notes || existing.notes, expiresOn },
      })

      await recordAudit(
        {
          actor,
          action: data.decision === 'valid' ? 'approve' : 'reject',
          entity: 'StaffDocument',
          entityId: row.id,
          summary: `${data.decision === 'valid' ? 'Accepted' : 'Rejected'} ${row.kind.replace(/_/g, ' ')} for ${row.staffRef}`,
          before: { status: 'pending_review' },
          after: { status: data.decision, notes: data.notes ?? null },
        },
        tx
      )

      return row
    })

    revalidatePath('/admin/compliance')
    revalidatePath('/crew/documents')
    return actionOk({ status: updated.status })
  } catch (err) {
    return actionFailed(err, 'reviewStaffDocument')
  }
}

export type ComplianceSummary = {
  staffRef: string
  name: string
  /** Documents that are expired or missing entirely for a required kind. */
  blocking: string[]
  expiringSoon: Array<{ kind: string; expiresOn: string; daysUntilExpiry: number }>
  clearedForSite: boolean
}

/**
 * The kinds every operative must hold to be cleared for site work.
 *
 * Right-to-work is a legal requirement for all staff; PTS is the rail
 * competence card. Kept here rather than in settings because these are
 * statutory rather than configurable.
 */
export const REQUIRED_DOCUMENT_KINDS = ['right_to_work', 'pts'] as const

/**
 * Who is and is not cleared to work, and what is about to lapse.
 *
 * This is the question the product could not previously answer at all.
 */
export async function getComplianceSummary(): Promise<ComplianceSummary[]> {
  const actor = await requireActor()
  const refs = await visibleStaffRefs(actor)
  const today = businessToday()

  const staff = await prisma.staff.findMany({
    where: {
      deletedAt: null,
      employmentStatus: { in: ['onboarding', 'active', 'notice', 'suspended'] },
      ...(refs === null ? {} : { ref: { in: refs } }),
    },
    select: {
      ref: true,
      name: true,
      documents: {
        select: { kind: true, status: true, expiresOn: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return staff.map((person) => {
    const blocking: string[] = []
    const expiringSoon: ComplianceSummary['expiringSoon'] = []

    for (const kind of REQUIRED_DOCUMENT_KINDS) {
      const held = person.documents.filter((d) => d.kind === kind)
      const valid = held.some((d) => {
        const expiry = d.expiresOn ? fromStoredDate(d.expiresOn) : null
        return effectiveStatus(d.status, expiry, today) !== 'expired'
          && d.status === 'valid'
      })
      if (!valid) blocking.push(kind)
    }

    for (const doc of person.documents) {
      if (doc.status !== 'valid' || !doc.expiresOn) continue
      const expiry = fromStoredDate(doc.expiresOn)
      const status = effectiveStatus(doc.status, expiry, today)
      if (status === 'expiring') {
        expiringSoon.push({
          kind: doc.kind,
          expiresOn: expiry,
          daysUntilExpiry: Math.round(
            (utcDate(expiry).getTime() - utcDate(today).getTime()) / 86_400_000
          ),
        })
      }
    }

    return {
      staffRef: person.ref,
      name: person.name,
      blocking,
      expiringSoon,
      clearedForSite: blocking.length === 0,
    }
  })
}

/**
 * Notifies owners and administrators about documents nearing expiry.
 *
 * Intended to be driven by a scheduled job. Idempotent within a day: a
 * document that already produced a notification today is skipped, so running
 * the sweep twice does not double-notify.
 */
export async function sweepExpiringDocuments(): Promise<
  ActionResult<{ notified: number }>
> {
  try {
    await requireAdmin()
    const today = businessToday()
    const horizon = addDays(today, EXPIRY_WARNING_DAYS)

    const due = await prisma.staffDocument.findMany({
      where: {
        status: 'valid',
        expiresOn: { not: null, lte: utcDate(horizon) },
        staff: { deletedAt: null, employmentStatus: { in: ['active', 'onboarding', 'notice'] } },
      },
      select: { id: true, staffRef: true, kind: true, expiresOn: true },
    })

    const startOfToday = utcDate(today)
    let notified = 0

    for (const doc of due) {
      const already = await prisma.notification.findFirst({
        where: {
          type: 'document_expiring',
          entity: 'StaffDocument',
          entityId: doc.id,
          createdAt: { gte: startOfToday },
        },
        select: { id: true },
      })
      if (already) continue

      const days = Math.round(
        (doc.expiresOn!.getTime() - utcDate(today).getTime()) / 86_400_000
      )
      await notify.documentExpiring(doc.staffRef, doc.id, doc.kind, days)
      notified += 1
    }

    return actionOk({ notified })
  } catch (err) {
    return actionFailed(err, 'sweepExpiringDocuments')
  }
}
