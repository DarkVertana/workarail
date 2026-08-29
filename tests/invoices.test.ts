import { describe, expect, it } from 'vitest'

import {
  canTransition,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  summarisePayments,
} from '@/app/lib/invoices'

/**
 * Invoice money used to be a float `amount` with the VAT split re-derived on
 * every read, and `status` was a free-text column an operator could set to
 * "paid" on an invoice with no payments against it. These cover both.
 */

describe('computeInvoiceTotals', () => {
  it('keeps totals in whole pence', () => {
    const totals = computeInvoiceTotals([
      { description: 'Track inspection', quantity: 3, unitPricePence: 12_500, vatRateBasisPoints: 2000 },
    ])

    expect(totals.netPence).toBe(37_500)
    expect(totals.vatPence).toBe(7_500)
    expect(totals.grossPence).toBe(45_000)
    expect(Number.isInteger(totals.grossPence)).toBe(true)
  })

  it('rounds each line rather than the sum, so gross always equals net plus VAT', () => {
    // 0.01 * 3 is the classic float trap: these amounts do not divide evenly.
    const totals = computeInvoiceTotals([
      { description: 'A', quantity: 1, unitPricePence: 3_333, vatRateBasisPoints: 2000 },
      { description: 'B', quantity: 1, unitPricePence: 3_333, vatRateBasisPoints: 2000 },
      { description: 'C', quantity: 1, unitPricePence: 3_333, vatRateBasisPoints: 2000 },
    ])

    expect(totals.netPence + totals.vatPence).toBe(totals.grossPence)
    totals.lines.forEach((line) => {
      expect(Number.isInteger(line.netPence)).toBe(true)
      expect(Number.isInteger(line.vatPence)).toBe(true)
    })
  })

  it('handles a zero-rated line without inventing VAT', () => {
    const totals = computeInvoiceTotals([
      { description: 'Disbursement', quantity: 1, unitPricePence: 10_000, vatRateBasisPoints: 0 },
    ])

    expect(totals.vatPence).toBe(0)
    expect(totals.grossPence).toBe(10_000)
  })
})

describe('summarisePayments', () => {
  it('reports the balance and flags an overpayment', () => {
    expect(summarisePayments(10_000, [{ amountPence: 4_000 }])).toEqual({
      paidPence: 4_000,
      balancePence: 6_000,
      isOverpaid: false,
    })

    expect(summarisePayments(10_000, [{ amountPence: 12_000 }]).isOverpaid).toBe(true)
  })
})

describe('deriveInvoiceStatus', () => {
  const base = {
    grossPence: 10_000,
    paidPence: 0,
    due: new Date('2026-06-30T00:00:00Z'),
    sentAt: null as Date | null,
    now: new Date('2026-06-01T00:00:00Z'),
  }

  it('cannot be marked paid while the balance is outstanding', () => {
    // The bug this replaces: status was stored, so "paid" survived even when
    // no payment existed.
    expect(deriveInvoiceStatus({ ...base, stored: 'paid', paidPence: 0 })).not.toBe('paid')
  })

  it('becomes paid once payments cover the gross', () => {
    expect(deriveInvoiceStatus({ ...base, stored: 'sent', paidPence: 10_000 })).toBe('paid')
  })

  it('reports a part payment', () => {
    expect(deriveInvoiceStatus({ ...base, stored: 'sent', paidPence: 4_000 })).toBe('partially_paid')
  })

  it('is not overdue on the due date itself, but is the day after', () => {
    expect(
      deriveInvoiceStatus({ ...base, stored: 'sent', now: new Date('2026-06-30T23:00:00Z') })
    ).not.toBe('overdue')

    expect(
      deriveInvoiceStatus({ ...base, stored: 'sent', now: new Date('2026-07-01T01:00:00Z') })
    ).toBe('overdue')
  })

  it('keeps operator-set terminal states', () => {
    for (const stored of ['void', 'written_off', 'draft'] as const) {
      expect(deriveInvoiceStatus({ ...base, stored, paidPence: 10_000 })).toBe(stored)
    }
  })

  it('distinguishes sent from pending', () => {
    expect(deriveInvoiceStatus({ ...base, stored: 'pending' })).toBe('pending')
    expect(
      deriveInvoiceStatus({ ...base, stored: 'sent', sentAt: new Date('2026-05-20T00:00:00Z') })
    ).toBe('sent')
  })
})

describe('canTransition', () => {
  it('refuses to reopen a settled invoice', () => {
    expect(canTransition('paid', 'draft')).toBe(false)
    expect(canTransition('void', 'sent')).toBe(false)
  })

  it('allows the ordinary path forward', () => {
    expect(canTransition('draft', 'pending')).toBe(true)
    expect(canTransition('pending', 'sent')).toBe(true)
    expect(canTransition('overdue', 'written_off')).toBe(true)
  })
})
