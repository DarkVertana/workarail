import { describe, expect, it } from 'vitest'

import { computePay, hoursFor, recomputeWithAdjustments } from '@/app/lib/payroll'

const rates = {
  allowancePence: 1_257_000,
  taxPercent: 20,
  niPercent: 8,
  pensionPercent: 5,
}

describe('computePay', () => {
  it('produces components that reconcile to net', () => {
    const pay = computePay(300_000, rates)

    expect(pay.netPence).toBe(
      pay.grossPence - pay.taxPence - pay.niPence - pay.pensionPence
    )
    for (const value of Object.values(pay)) {
      if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('charges no tax below the apportioned allowance', () => {
    const monthlyAllowance = Math.round(rates.allowancePence / 12)
    expect(computePay(monthlyAllowance - 1, rates).taxPence).toBe(0)
  })

  it('taxes only the amount above the allowance', () => {
    const monthlyAllowance = Math.round(rates.allowancePence / 12)
    const pay = computePay(monthlyAllowance + 100_000, rates)

    expect(pay.taxablePence).toBe(100_000)
    expect(pay.taxPence).toBe(20_000)
  })

  it('rejects fractional or negative gross pay', () => {
    expect(() => computePay(1234.5, rates)).toThrow()
    expect(() => computePay(-1, rates)).toThrow()
  })

  it('stamps the calculation version, so a payslip can be traced to its rules', () => {
    expect(computePay(200_000, rates).calculationVersion).toBeTruthy()
  })
})

describe('recomputeWithAdjustments', () => {
  it('is reproducible from base pay plus adjustments', () => {
    // The point of the rewrite: figures are derived, never hand-edited, so
    // re-running the same inputs cannot drift from the stored payslip.
    const run = () =>
      recomputeWithAdjustments(
        250_000,
        [
          { amountPence: 20_000, taxable: true },
          { amountPence: 5_000, taxable: false },
        ],
        rates
      )

    expect(run()).toEqual(run())
  })

  it('excludes a non-taxable adjustment from the taxable base but pays it out', () => {
    const withExpense = recomputeWithAdjustments(
      250_000,
      [{ amountPence: 5_000, taxable: false }],
      rates
    )
    const plain = recomputeWithAdjustments(250_000, [], rates)

    expect(withExpense.taxPence).toBe(plain.taxPence)
    expect(withExpense.netPence).toBe(plain.netPence + 5_000)
  })

  it('applies a negative adjustment without producing negative gross', () => {
    const result = recomputeWithAdjustments(
      10_000,
      [{ amountPence: -50_000, taxable: true }],
      rates
    )

    expect(result.grossPence).toBeGreaterThanOrEqual(0)
  })

  it('keeps the base separate from the adjusted total', () => {
    const result = recomputeWithAdjustments(
      250_000,
      [{ amountPence: 20_000, taxable: true }],
      rates
    )

    expect(result.baseGrossPence).toBe(250_000)
    expect(result.grossPence).toBe(270_000)
  })
})

describe('hoursFor', () => {
  it('returns no hours for an unknown attendance code rather than NaN', () => {
    expect(hoursFor('?')).toBe(0)
  })
})
