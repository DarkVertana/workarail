'use server'

/**
 * Invoice lifecycle transitions.
 *
 * `deriveInvoiceStatus` computes status from payments and dates, which is the
 * right design — but it returns `sent` only when `sentAt` is set, and
 * **nothing in the application ever wrote `sentAt`**. The `canTransition`
 * table in `app/lib/invoices.ts` was likewise never called. The consequence
 * was that an invoice created as a draft stayed a draft permanently, and
 * `getMonthlyFinance` and the finance dashboard both exclude drafts — so
 * every invoice raised through the UI was invisible to every financial total
 * in the product.
 *
 * The transitions are:
 *
 *     draft --issue--> pending --(due date passes)--> overdue
 *                         |                              |
 *                         +--------- payment ------------+
 *                         |                              |
 *                         v                              v
 *                  partially_paid ---- payment ----> paid
 *
 *     draft|pending|overdue --void--> void          (cancels a mistake)
 *     pending|overdue|partially_paid --write off--> written_off  (abandons a debt)
 *
 * `void` and `written_off` are terminal and are deliberately different things:
 * voiding says the invoice should never have existed, writing off says the
 * debt was real and will not be collected. Conflating them would misstate
 * revenue.
 */

import { revalidatePath } from 'next/cache'

import { prisma } from '@/app/lib/prisma'
import { recordAudit } from '@/app/lib/audit'
import { requireFinance } from '@/app/lib/authz'
import {
  actionFailed,
  actionOk,
  Conflict,
  NotFound,
  type ActionResult,
} from '@/app/lib/errors'
import { notify } from '@/app/lib/notifications'
import { businessToday, utcDate } from '@/app/lib/dates'
import {
  issueInvoiceSchema,
  parseOrThrow,
  writeOffInvoiceSchema,
} from '@/app/lib/validation'

/**
 * Issues a draft invoice: records that it was sent and makes it a receivable.
 *
 * Refuses an invoice with no lines, because a zero-value receivable sent to a
 * client is always a mistake.
 */
export async function issueInvoice(
  input: unknown
): Promise<ActionResult<{ status: string; sentOn: string }>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(issueInvoiceSchema, input)
    const sentOn = data.sentOn ?? businessToday()

    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        include: { lineItems: { select: { id: true } }, client: { select: { name: true } } },
      })
      if (!existing) throw NotFound('That invoice no longer exists.')
      if (existing.status !== 'draft') {
        throw Conflict(`That invoice is already ${existing.status.replace(/_/g, ' ')}.`)
      }
      if (existing.lineItems.length === 0) {
        throw Conflict('Add at least one line before issuing this invoice.')
      }
      if (existing.amountPence <= 0) {
        throw Conflict('An invoice for zero cannot be issued.')
      }

      const row = await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { status: 'pending', sentAt: utcDate(sentOn) },
      })

      await recordAudit(
        {
          actor,
          action: 'issue',
          entity: 'Invoice',
          entityId: row.id,
          summary: `Issued ${row.reference} to ${existing.client.name} for ${row.amountPence}p`,
          before: { status: 'draft', sentAt: null },
          after: { status: row.status, sentAt: sentOn },
        },
        tx
      )

      return row
    })

    await notify.invoiceIssued(invoice.id, invoice.reference, invoice.amountPence)

    revalidatePath('/admin/invoices')
    revalidatePath('/finance/invoices')
    return actionOk({ status: invoice.status, sentOn })
  } catch (err) {
    return actionFailed(err, 'issueInvoice')
  }
}

/**
 * Writes off an uncollectable debt.
 *
 * Deliberately separate from voiding: the invoice remains part of the sales
 * history and the loss is explicit, rather than the receivable simply
 * disappearing.
 */
export async function writeOffInvoice(
  input: unknown
): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(writeOffInvoiceSchema, input)

    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        include: { payments: { select: { amountPence: true } } },
      })
      if (!existing) throw NotFound('That invoice no longer exists.')
      if (existing.status === 'paid') {
        throw Conflict('That invoice is paid in full; there is nothing to write off.')
      }
      if (existing.status === 'void' || existing.status === 'written_off') {
        throw Conflict(`That invoice is already ${existing.status.replace(/_/g, ' ')}.`)
      }
      if (existing.status === 'draft') {
        throw Conflict(
          'A draft was never issued, so there is no debt. Delete or void it instead.'
        )
      }

      const paid = existing.payments.reduce((sum, p) => sum + p.amountPence, 0)
      const row = await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { status: 'written_off' },
      })

      await recordAudit(
        {
          actor,
          action: 'write_off',
          entity: 'Invoice',
          entityId: row.id,
          summary: `Wrote off ${row.reference} — ${row.amountPence - paid}p outstanding: ${data.reason}`,
          before: { status: existing.status, outstandingPence: row.amountPence - paid },
          after: { status: 'written_off', reason: data.reason },
        },
        tx
      )

      return row
    })

    revalidatePath('/admin/invoices')
    revalidatePath('/finance/invoices')
    return actionOk({ status: invoice.status })
  } catch (err) {
    return actionFailed(err, 'writeOffInvoice')
  }
}

export type AgedReceivable = {
  id: string
  reference: string
  clientId: string
  clientName: string
  contactEmail: string | null
  contactPhone: string | null
  amountPence: number
  paidPence: number
  balancePence: number
  due: string
  daysOverdue: number
  /** Standard ageing bucket. */
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+'
  status: string
}

/**
 * Aged receivables, bucketed by days past due.
 *
 * The finance dashboard previously described a flat list of overdue invoices
 * as "Receivables" with no ageing at all, and summed gross rather than the
 * outstanding balance — so a £100k invoice with £99k paid was reported as
 * £100k owed. Ageing is what credit control actually works from.
 */
export async function getAgedReceivables(): Promise<AgedReceivable[]> {
  await requireFinance()
  const today = businessToday()

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['pending', 'sent', 'partially_paid', 'overdue'] } },
    include: {
      client: {
        select: { id: true, name: true, primaryContactEmail: true, primaryContactPhone: true },
      },
      payments: { select: { amountPence: true } },
    },
    orderBy: { due: 'asc' },
  })

  return invoices.map((invoice) => {
    const paidPence = invoice.payments.reduce((sum, p) => sum + p.amountPence, 0)
    const due = invoice.due.toISOString().slice(0, 10)
    const daysOverdue = Math.max(
      0,
      Math.round((utcDate(today).getTime() - utcDate(due).getTime()) / 86_400_000)
    )

    const bucket: AgedReceivable['bucket'] =
      daysOverdue === 0 ? 'current'
      : daysOverdue <= 30 ? '1-30'
      : daysOverdue <= 60 ? '31-60'
      : daysOverdue <= 90 ? '61-90'
      : '90+'

    return {
      id: invoice.id,
      reference: invoice.reference,
      clientId: invoice.client.id,
      clientName: invoice.client.name,
      contactEmail: invoice.client.primaryContactEmail,
      contactPhone: invoice.client.primaryContactPhone,
      amountPence: invoice.amountPence,
      paidPence,
      balancePence: invoice.amountPence - paidPence,
      due,
      daysOverdue,
      bucket,
      status: invoice.status,
    }
  })
}
