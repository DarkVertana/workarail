import { describe, expect, it } from 'vitest'

import {
  attachmentInput,
  createInvoiceSchema,
  createLeaveSchema,
  expenseDecisionSchema,
  expenseSchema,
  pence,
  recordPaymentSchema,
  settingsPatchSchema,
} from '@/app/lib/validation'

/**
 * Server Actions previously took whatever the client sent and passed it to
 * Prisma. These pin the boundary: amounts stay whole and non-negative, ranges
 * stay ordered, and a payload cannot smuggle in fields nobody declared.
 */

describe('money', () => {
  it('rejects fractional and negative amounts', () => {
    expect(pence.safeParse(10.5).success).toBe(false)
    expect(pence.safeParse(-1).success).toBe(false)
    expect(pence.safeParse(0).success).toBe(true)
    expect(pence.safeParse(1234).success).toBe(true)
  })

  it('rejects a numeric string, so "12.30" cannot become 12 pence downstream', () => {
    expect(pence.safeParse('1230').success).toBe(false)
  })
})

describe('createLeaveSchema', () => {
  const valid = { type: 'annual', from: '2026-07-01', to: '2026-07-05' }

  it('accepts an ordered range and defaults the half-day markers', () => {
    const parsed = createLeaveSchema.parse(valid)
    expect(parsed.startAt).toBe('morning')
    expect(parsed.endAt).toBe('end_of_day')
  })

  it('rejects a range that ends before it starts', () => {
    const result = createLeaveSchema.safeParse({ ...valid, from: '2026-07-05', to: '2026-07-01' })
    expect(result.success).toBe(false)
  })

  it('ignores a client-supplied day count', () => {
    // The deduction is computed server-side; a caller cannot book a fortnight
    // and declare it costs half a day.
    const parsed = createLeaveSchema.parse({ ...valid, days: 0.5 }) as Record<string, unknown>
    expect(parsed.days).toBeUndefined()
  })

  it('rejects a malformed date', () => {
    expect(createLeaveSchema.safeParse({ ...valid, from: '01/07/2026' }).success).toBe(false)
  })
})

describe('expenseSchema', () => {
  const valid = {
    date: '2026-06-01',
    category: 'travel',
    merchant: 'Northern Rail',
    description: 'Return fare',
    amountPence: 8_640,
    method: 'personal',
  }

  it('accepts a well-formed claim', () => {
    expect(expenseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a zero or negative claim', () => {
    expect(expenseSchema.safeParse({ ...valid, amountPence: 0 }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...valid, amountPence: -100 }).success).toBe(false)
  })

  it('rejects a receipt pointing at a data or blob URL', () => {
    for (const storageKey of ['data:image/png;base64,AAAA', 'blob:http://x/y', '../../etc/passwd']) {
      const result = attachmentInput.safeParse({
        name: 'r.png',
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: 100,
        storageKey,
      })
      expect(result.success).toBe(false)
    }
  })

  it('rejects an unsupported attachment MIME type', () => {
    const result = attachmentInput.safeParse({
      name: 'x.svg',
      kind: 'image',
      mimeType: 'image/svg+xml',
      sizeBytes: 100,
      storageKey: 'ab/' + 'c'.repeat(32),
    })
    expect(result.success).toBe(false)
  })
})

describe('expenseDecisionSchema', () => {
  it('requires a reason when rejecting', () => {
    expect(expenseDecisionSchema.safeParse({ id: 'EX-1', decision: 'rejected' }).success).toBe(false)
    expect(
      expenseDecisionSchema.safeParse({ id: 'EX-1', decision: 'rejected', reason: 'Duplicate' })
        .success
    ).toBe(true)
  })

  it('requires a payment reference when marking reimbursed', () => {
    expect(expenseDecisionSchema.safeParse({ id: 'EX-1', decision: 'reimbursed' }).success).toBe(
      false
    )
  })
})

describe('createInvoiceSchema', () => {
  const line = {
    description: 'Inspection',
    quantity: 1,
    unitPricePence: 10_000,
    vatRateBasisPoints: 2000,
  }
  const valid = {
    clientName: 'Network Rail',
    reference: 'INV-1001',
    issued: '2026-06-01',
    due: '2026-06-30',
    lineItems: [line],
  }

  it('accepts a well-formed invoice', () => {
    expect(createInvoiceSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a due date before the issue date', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, due: '2026-05-01' }).success).toBe(false)
  })

  it('rejects an invoice with no lines', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, lineItems: [] }).success).toBe(false)
  })

  it('requires a client', () => {
    const noClient = { ...valid, clientName: undefined }
    expect(createInvoiceSchema.safeParse(noClient).success).toBe(false)
  })
})

describe('recordPaymentSchema', () => {
  it('requires a reference, which doubles as the idempotency key', () => {
    const base = {
      invoiceId: 'INV-1',
      amountPence: 5_000,
      receivedOn: '2026-06-10',
      method: 'bank_transfer',
    }
    expect(recordPaymentSchema.safeParse(base).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...base, reference: 'FT-9912' }).success).toBe(true)
  })

  it('rejects a zero-value payment', () => {
    expect(
      recordPaymentSchema.safeParse({
        invoiceId: 'INV-1',
        amountPence: 0,
        receivedOn: '2026-06-10',
        method: 'cash',
        reference: 'X',
      }).success
    ).toBe(false)
  })
})

describe('settingsPatchSchema', () => {
  it('accepts a partial patch, so saving one field does not blank the rest', () => {
    expect(settingsPatchSchema.safeParse({ company: 'Work à Rail' }).success).toBe(true)
  })

  it('rejects unknown keys rather than silently storing them', () => {
    expect(settingsPatchSchema.safeParse({ isAdmin: true }).success).toBe(false)
  })

  it('rejects out-of-range rates', () => {
    expect(settingsPatchSchema.safeParse({ tax: 150 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ tax: -1 }).success).toBe(false)
  })
})
