/**
 * Invoice money and lifecycle rules.
 *
 * Two things this fixes:
 *
 *  1. All arithmetic is in integer pence. VAT is expressed in basis points
 *     (2000 = 20%) so no percentage ever becomes a float in the money path.
 *  2. Status is *derived* from payments and dates rather than chosen from a
 *     dropdown. An invoice can no longer be marked paid because somebody
 *     selected "Paid" while creating it.
 */

import type { InvoiceStatus } from '@/generated/prisma'

export type LineItemInput = {
  description: string
  quantity: number
  unitPricePence: number
  vatRateBasisPoints: number
}

export type ComputedLine = LineItemInput & {
  netPence: number
  vatPence: number
}

export type InvoiceTotals = {
  lines: ComputedLine[]
  netPence: number
  vatPence: number
  grossPence: number
}

/**
 * Rounds half away from zero, which is the convention HMRC expects for VAT
 * and what a person checking the arithmetic by hand will produce.
 */
function roundPence(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

export function computeInvoiceTotals(items: LineItemInput[]): InvoiceTotals {
  const lines = items.map((item) => {
    // quantity may legitimately be fractional (2.5 days); the product is
    // rounded to whole pence immediately so nothing downstream sees a float.
    const netPence = roundPence(item.quantity * item.unitPricePence)
    const vatPence = roundPence((netPence * item.vatRateBasisPoints) / 10000)
    return { ...item, netPence, vatPence }
  })

  const netPence = lines.reduce((sum, l) => sum + l.netPence, 0)
  const vatPence = lines.reduce((sum, l) => sum + l.vatPence, 0)

  return { lines, netPence, vatPence, grossPence: netPence + vatPence }
}

export type PaymentSummary = {
  paidPence: number
  balancePence: number
  isOverpaid: boolean
}

export function summarisePayments(
  grossPence: number,
  payments: Array<{ amountPence: number }>
): PaymentSummary {
  const paidPence = payments.reduce((sum, p) => sum + p.amountPence, 0)
  return {
    paidPence,
    balancePence: grossPence - paidPence,
    isOverpaid: paidPence > grossPence,
  }
}

/**
 * The single rule for what state an invoice is in.
 *
 * Terminal states (void, written_off) and draft are held as stored facts;
 * everything else follows from the payments and the due date, so the status
 * can never disagree with the money.
 */
export function deriveInvoiceStatus(input: {
  stored: InvoiceStatus
  grossPence: number
  paidPence: number
  due: Date
  sentAt: Date | null
  now?: Date
}): InvoiceStatus {
  const { stored, grossPence, paidPence, due, sentAt } = input
  const now = input.now ?? new Date()

  // Operator-set terminal states win outright.
  if (stored === 'void' || stored === 'written_off' || stored === 'draft') {
    return stored
  }

  if (grossPence > 0 && paidPence >= grossPence) return 'paid'
  if (paidPence > 0) return 'partially_paid'

  // Compare dates only; an invoice is not overdue on its due date.
  const dueDay = new Date(
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  )
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  if (today > dueDay) return 'overdue'

  return sentAt ? 'sent' : 'pending'
}

/** Which transitions an operator is allowed to drive by hand. */
const ALLOWED_MANUAL: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['pending', 'void'],
  pending: ['sent', 'void', 'written_off'],
  sent: ['void', 'written_off'],
  partially_paid: ['written_off'],
  overdue: ['sent', 'void', 'written_off'],
  paid: [],
  void: [],
  written_off: [],
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_MANUAL[from]?.includes(to) ?? false
}

export function formatMoney(pence: number, currency = 'GBP'): string {
  return (pence / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
}
