/**
 * HMRC engine tests.
 *
 * The expected figures are derived from published 2026/27 rates and
 * thresholds, not from the implementation, so a change in behaviour shows up
 * as a failure rather than being silently absorbed.
 */

import { describe, expect, it } from 'vitest'
import {
  calculatePay,
  parseTaxCode,
  isValidTaxCode,
  taxYearOfDate,
  taxPeriodOfDate,
  formatTaxYear,
  PERIODS_PER_YEAR,
  ZERO_YTD,
  InvalidTaxCodeError,
  PayrollInputError,
  UnsupportedTaxYearError,
} from '@/app/lib/hmrc'

const BASE = {
  basis: 'cumulative' as const,
  niCategory: 'A',
  payFrequency: 'monthly' as const,
  taxYearStart: 2026,
}

describe('tax code parsing', () => {
  it('reads the allowance from a suffix code', () => {
    const parsed = parseTaxCode('1257L')
    expect(parsed.allowancePence).toBe(1_257_000) // £12,570
    expect(parsed.regime).toBe('uk')
    expect(parsed.week1Month1).toBe(false)
  })

  it('treats M and N marriage-allowance codes as ordinary suffix codes', () => {
    expect(parseTaxCode('1383M').allowancePence).toBe(1_383_000)
    expect(parseTaxCode('1131N').allowancePence).toBe(1_131_000)
  })

  it('maps flat-rate codes to a single rate with no allowance', () => {
    expect(parseTaxCode('BR').flatRateBp).toBe(2000)
    expect(parseTaxCode('D0').flatRateBp).toBe(4000)
    expect(parseTaxCode('D1').flatRateBp).toBe(4500)
    expect(parseTaxCode('BR').allowancePence).toBe(0)
  })

  it('detects the regime prefix', () => {
    expect(parseTaxCode('S1257L').regime).toBe('scotland')
    expect(parseTaxCode('C1257L').regime).toBe('wales')
    expect(parseTaxCode('SBR').flatRateBp).toBe(2000)
  })

  it('detects week-1/month-1 operation from X, W1 and M1', () => {
    expect(parseTaxCode('1257L X').week1Month1).toBe(true)
    expect(parseTaxCode('1257LW1').week1Month1).toBe(true)
    expect(parseTaxCode('1257LM1').week1Month1).toBe(true)
  })

  it('reads a K code as a negative allowance', () => {
    const parsed = parseTaxCode('K475')
    expect(parsed.additionalTaxablePence).toBe(475_000) // £4,750 added
    expect(parsed.allowancePence).toBe(0)
  })

  it('handles 0T and NT', () => {
    expect(parseTaxCode('0T').allowancePence).toBe(0)
    expect(parseTaxCode('0T').flatRateBp).toBeNull()
    expect(parseTaxCode('NT').noTax).toBe(true)
  })

  it('rejects nonsense rather than defaulting to 1257L', () => {
    expect(() => parseTaxCode('BANANA')).toThrow(InvalidTaxCodeError)
    expect(() => parseTaxCode('')).toThrow(InvalidTaxCodeError)
    expect(isValidTaxCode('1257Q')).toBe(false)
    expect(isValidTaxCode('1257L')).toBe(true)
  })
})

describe('income tax — monthly, cumulative', () => {
  it('deducts nothing when pay is under the apportioned allowance', () => {
    // £1,000 in month 1 against free pay of £1,047.50.
    const r = calculatePay({ ...BASE, grossPence: 100_000, taxCode: '1257L', taxPeriod: 1 })
    expect(r.taxPence).toBe(0)
    expect(r.taxablePence).toBe(0)
  })

  it('taxes the excess at 20% in month 1', () => {
    // £2,000 gross. Free pay 12,570/12 = £1,047.50. Taxable £952.50 @ 20%.
    const r = calculatePay({ ...BASE, grossPence: 200_000, taxCode: '1257L', taxPeriod: 1 })
    expect(r.taxablePence).toBe(95_250)
    expect(r.taxPence).toBe(19_050) // £190.50
  })

  it('reaches the higher rate once cumulative pay passes the band', () => {
    // £8,000 a month. By month 1: free pay £1,047.50, taxable £6,952.50.
    // Basic band 37,700/12 = £3,141.67 @20% = £628.33
    // Remainder £3,810.83 @40% = £1,524.33
    const r = calculatePay({ ...BASE, grossPence: 800_000, taxCode: '1257L', taxPeriod: 1 })
    expect(r.taxPence).toBeGreaterThan(200_000)
    // Verify against an independent recomputation of the two bands.
    const freePay = Math.ceil(1_257_000 / 12)
    const taxable = 800_000 - freePay
    const basicBand = (37_700 * 100) / 12
    const expected = Math.floor(
      Math.min(taxable, basicBand) * 0.2 + Math.max(0, taxable - basicBand) * 0.4
    )
    expect(r.taxPence).toBe(expected)
  })

  it('taxes every pound at 20% on BR with no allowance', () => {
    const r = calculatePay({ ...BASE, grossPence: 200_000, taxCode: 'BR', taxPeriod: 1 })
    expect(r.taxPence).toBe(40_000)
  })

  it('taxes every pound at 40% on D0', () => {
    const r = calculatePay({ ...BASE, grossPence: 200_000, taxCode: 'D0', taxPeriod: 1 })
    expect(r.taxPence).toBe(80_000)
  })

  it('deducts no tax at all on NT', () => {
    const r = calculatePay({ ...BASE, grossPence: 500_000, taxCode: 'NT', taxPeriod: 1 })
    expect(r.taxPence).toBe(0)
  })

  it('adds notional pay for a K code and caps tax at 50% of gross', () => {
    // K1000 adds £10,000/yr = £833.33/month to taxable pay.
    const r = calculatePay({ ...BASE, grossPence: 200_000, taxCode: 'K1000', taxPeriod: 1 })
    expect(r.taxablePence).toBeGreaterThan(200_000)
    expect(r.taxPence).toBeLessThanOrEqual(100_000)
  })

  it('never breaches the regulatory limit even on an extreme K code', () => {
    const r = calculatePay({ ...BASE, grossPence: 100_000, taxCode: 'K9999', taxPeriod: 1 })
    expect(r.taxPence).toBe(50_000) // exactly 50% of gross
  })
})

describe('cumulative operation across periods', () => {
  it('spreads the allowance so a steady salary pays steady tax', () => {
    const monthly = 300_000 // £3,000
    let ytd = { ...ZERO_YTD }
    const deductions: number[] = []

    for (let period = 1; period <= 12; period++) {
      const r = calculatePay({
        ...BASE,
        grossPence: monthly,
        taxCode: '1257L',
        taxPeriod: period,
        ytd,
      })
      deductions.push(r.taxPence)
      ytd = r.ytd
    }

    // Every month should deduct essentially the same amount.
    const first = deductions[0]
    for (const d of deductions) expect(Math.abs(d - first)).toBeLessThanOrEqual(2)

    // Annual check: £36,000 gross, £12,570 allowance, £23,430 @ 20% = £4,686.
    expect(ytd.taxPence).toBeGreaterThan(468_000)
    expect(ytd.taxPence).toBeLessThan(469_000)
  })

  it('refunds through the payroll when a code is raised mid-year', () => {
    let ytd = { ...ZERO_YTD }
    // Six months on BR — over-taxed, since no allowance is given.
    for (let period = 1; period <= 6; period++) {
      ytd = calculatePay({
        ...BASE, grossPence: 200_000, taxCode: 'BR', taxPeriod: period, ytd,
      }).ytd
    }
    const overpaid = ytd.taxPence

    // HMRC issues 1257L cumulative in month 7; the correction is automatic.
    const r = calculatePay({
      ...BASE, grossPence: 200_000, taxCode: '1257L', taxPeriod: 7, ytd,
    })
    expect(r.taxPence).toBeLessThan(0)
    expect(Math.abs(r.taxPence)).toBeLessThanOrEqual(overpaid)
  })

  it('never refunds more tax than was actually deducted', () => {
    const ytd = { ...ZERO_YTD, grossPence: 100_000, taxablePence: 0, taxPence: 500 }
    const r = calculatePay({
      ...BASE, grossPence: 10_000, taxCode: '1257L', taxPeriod: 6, ytd,
    })
    expect(r.taxPence).toBeGreaterThanOrEqual(-500)
  })

  it('ignores history under week 1/month 1', () => {
    const ytd = { ...ZERO_YTD, grossPence: 5_000_000, taxPence: 900_000 }
    const cumulative = calculatePay({
      ...BASE, grossPence: 200_000, taxCode: '1257L', taxPeriod: 9, ytd,
    })
    const nonCumulative = calculatePay({
      ...BASE, basis: 'week1_month1', grossPence: 200_000, taxCode: '1257L',
      taxPeriod: 9, ytd,
    })
    expect(nonCumulative.taxPence).not.toBe(cumulative.taxPence)
    // Month 1 of the same salary is the reference point.
    const monthOne = calculatePay({
      ...BASE, grossPence: 200_000, taxCode: '1257L', taxPeriod: 1,
    })
    expect(nonCumulative.taxPence).toBe(monthOne.taxPence)
  })

  it('honours an X suffix even when the stored basis says cumulative', () => {
    const ytd = { ...ZERO_YTD, grossPence: 5_000_000, taxPence: 900_000 }
    const r = calculatePay({
      ...BASE, basis: 'cumulative', grossPence: 200_000, taxCode: '1257L X',
      taxPeriod: 9, ytd,
    })
    expect(r.basis).toBe('week1_month1')
  })
})

describe('Scottish rates', () => {
  it('applies the starter rate band that rUK does not have', () => {
    const scottish = calculatePay({
      ...BASE, grossPence: 150_000, taxCode: 'S1257L', taxPeriod: 1,
    })
    const rest = calculatePay({
      ...BASE, grossPence: 150_000, taxCode: '1257L', taxPeriod: 1,
    })
    // 19% starter rate means slightly less tax than the 20% basic rate.
    expect(scottish.taxPence).toBeLessThan(rest.taxPence)
  })

  it('charges more than rUK at a high salary', () => {
    const scottish = calculatePay({
      ...BASE, grossPence: 800_000, taxCode: 'S1257L', taxPeriod: 1,
    })
    const rest = calculatePay({
      ...BASE, grossPence: 800_000, taxCode: '1257L', taxPeriod: 1,
    })
    expect(scottish.taxPence).toBeGreaterThan(rest.taxPence)
  })
})

describe('National Insurance', () => {
  it('charges nothing below the primary threshold', () => {
    // PT is £1,048/month.
    const r = calculatePay({ ...BASE, grossPence: 104_800, taxCode: '1257L', taxPeriod: 1 })
    expect(r.niPence).toBe(0)
  })

  it('charges 8% between the primary threshold and the upper earnings limit', () => {
    // £3,000 gross, monthly PT £1,048: (3,000 - 1,048) x 8% = £156.16
    const r = calculatePay({ ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    expect(r.niPence).toBe(15_616)
  })

  it('uses the published monthly threshold, not the annual figure over twelve', () => {
    // £12,570/12 is £1,047.50, but HMRC's monthly PT is £1,048. Deriving the
    // threshold by division over-deducts by 4p on every monthly payslip.
    const atThreshold = calculatePay({
      ...BASE, grossPence: 104_800, taxCode: '1257L', taxPeriod: 1,
    })
    expect(atThreshold.niPence).toBe(0)
  })

  it('drops to 2% above the upper earnings limit', () => {
    // £6,000, monthly UEL £4,189:
    // (4,189 - 1,048) x 8% + (6,000 - 4,189) x 2%
    const expected = Math.round((418_900 - 104_800) * 0.08 + (600_000 - 418_900) * 0.02)
    const r = calculatePay({ ...BASE, grossPence: 600_000, taxCode: '1257L', taxPeriod: 1 })
    expect(r.niPence).toBe(expected)
  })

  it('exempts category C, over state pension age', () => {
    const r = calculatePay({
      ...BASE, niCategory: 'C', grossPence: 600_000, taxCode: '1257L', taxPeriod: 1,
    })
    expect(r.niPence).toBe(0)
  })

  it('applies the reduced rate for category B', () => {
    const a = calculatePay({ ...BASE, niCategory: 'A', grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    const b = calculatePay({ ...BASE, niCategory: 'B', grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    expect(b.niPence).toBeLessThan(a.niPence)
    expect(b.niPence).toBe(Math.round((300_000 - 104_800) * 0.0185))
  })

  it('charges deferment category J at 2% throughout', () => {
    const r = calculatePay({
      ...BASE, niCategory: 'J', grossPence: 300_000, taxCode: '1257L', taxPeriod: 1,
    })
    expect(r.niPence).toBe(Math.round((300_000 - 104_800) * 0.02))
  })

  it('treats under-21 category M like A for the employee', () => {
    const a = calculatePay({ ...BASE, niCategory: 'A', grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    const m = calculatePay({ ...BASE, niCategory: 'M', grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    expect(m.niPence).toBe(a.niPence)
  })

  it('rejects an unknown category letter', () => {
    expect(() =>
      calculatePay({ ...BASE, niCategory: 'Q', grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    ).toThrow(PayrollInputError)
  })

  it('is assessed per period, so uneven pay below the UEL costs more NI', () => {
    // Two months of £2,000 each get the threshold twice; £4,000 then nothing
    // gets it once, and the whole £4,000 stays under the £4,189 UEL.
    const even =
      calculatePay({ ...BASE, grossPence: 200_000, taxCode: '1257L', taxPeriod: 1 }).niPence * 2
    const uneven =
      calculatePay({ ...BASE, grossPence: 400_000, taxCode: '1257L', taxPeriod: 1 }).niPence +
      calculatePay({ ...BASE, grossPence: 0, taxCode: '1257L', taxPeriod: 2 }).niPence
    expect(uneven).toBeGreaterThan(even)
  })
})

describe('student loans', () => {
  it('deducts nothing below the plan threshold', () => {
    // Plan 2 threshold £29,385/yr = £2,448.75/month.
    const r = calculatePay({
      ...BASE, grossPence: 200_000, taxCode: '1257L', taxPeriod: 1, studentLoanPlan: 2,
    })
    expect(r.studentLoanPence).toBe(0)
  })

  it('deducts 9% above the threshold, rounded down to the pound', () => {
    // £3,000 - £2,448.75 = £551.25 x 9% = £49.61 -> £49
    const r = calculatePay({
      ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1, studentLoanPlan: 2,
    })
    expect(r.studentLoanPence).toBe(4_900)
    expect(r.studentLoanPence % 100).toBe(0)
  })

  it('uses the lower plan 5 threshold', () => {
    const plan2 = calculatePay({
      ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1, studentLoanPlan: 2,
    })
    const plan5 = calculatePay({
      ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1, studentLoanPlan: 5,
    })
    expect(plan5.studentLoanPence).toBeGreaterThan(plan2.studentLoanPence)
  })

  it('runs a postgraduate loan alongside a plan loan at 6%', () => {
    const r = calculatePay({
      ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1,
      studentLoanPlan: 2, postgradLoan: true,
    })
    // PGL threshold £21,000/yr = £1,750/month. (3,000-1,750) x 6% = £75.
    expect(r.postgradLoanPence).toBe(7_500)
    expect(r.studentLoanPence).toBe(4_900)
  })

  it('rejects plan 5 in a year where it was not collectable', () => {
    expect(() =>
      calculatePay({
        ...BASE, taxYearStart: 2025, grossPence: 300_000, taxCode: '1257L',
        taxPeriod: 1, studentLoanPlan: 5,
      })
    ).toThrow(PayrollInputError)
  })
})

describe('pay frequency', () => {
  it('apportions thresholds by the number of periods', () => {
    expect(PERIODS_PER_YEAR.weekly).toBe(52)
    expect(PERIODS_PER_YEAR.monthly).toBe(12)

    // A week's pay of £692.31 is roughly a twelfth of a month's £3,000.
    const weekly = calculatePay({
      ...BASE, payFrequency: 'weekly', grossPence: 69_231, taxCode: '1257L', taxPeriod: 1,
    })
    // Published weekly PT is £242.
    expect(weekly.niPence).toBe(Math.round((69_231 - 24_200) * 0.08))
  })

  it('derives fortnightly and four-weekly NI thresholds from the weekly one', () => {
    // HMRC defines these as multiples of £242, not as £12,570/26 or /13.
    const fortnightly = calculatePay({
      ...BASE, payFrequency: 'fortnightly', grossPence: 48_400, taxCode: '1257L', taxPeriod: 1,
    })
    expect(fortnightly.niPence).toBe(0) // exactly 2 x £242

    const fourWeekly = calculatePay({
      ...BASE, payFrequency: 'four_weekly', grossPence: 96_800, taxCode: '1257L', taxPeriod: 1,
    })
    expect(fourWeekly.niPence).toBe(0) // exactly 4 x £242
  })

  it('accepts week 53 for a weekly payroll but not month 13', () => {
    expect(() =>
      calculatePay({ ...BASE, payFrequency: 'weekly', grossPence: 50_000, taxCode: '1257L', taxPeriod: 53 })
    ).not.toThrow()
    expect(() =>
      calculatePay({ ...BASE, grossPence: 50_000, taxCode: '1257L', taxPeriod: 13 })
    ).toThrow(PayrollInputError)
  })
})

describe('pension, net pay and invariants', () => {
  it('reduces taxable pay but not NI', () => {
    const without = calculatePay({ ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1 })
    const with_ = calculatePay({
      ...BASE, grossPence: 300_000, taxCode: '1257L', taxPeriod: 1, pensionPence: 15_000,
    })
    expect(with_.taxPence).toBeLessThan(without.taxPence)
    expect(with_.niPence).toBe(without.niPence)
  })

  it('always reconciles net to gross minus every deduction', () => {
    const r = calculatePay({
      ...BASE, grossPence: 400_000, taxCode: '1257L', taxPeriod: 3,
      pensionPence: 20_000, studentLoanPlan: 2, postgradLoan: true,
      ytd: { grossPence: 800_000, taxablePence: 590_500, taxPence: 118_100, niPence: 31_232, pensionPence: 40_000 },
    })
    expect(r.netPence).toBe(
      r.grossPence - r.taxPence - r.niPence - r.pensionPence -
      r.studentLoanPence - r.postgradLoanPence
    )
  })

  it('produces whole pence only', () => {
    const r = calculatePay({
      ...BASE, grossPence: 333_333, taxCode: '1257L', taxPeriod: 5, studentLoanPlan: 1,
    })
    for (const v of [r.taxPence, r.niPence, r.netPence, r.studentLoanPence, r.taxablePence]) {
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('rejects a pension contribution larger than gross', () => {
    expect(() =>
      calculatePay({ ...BASE, grossPence: 100_000, taxCode: '1257L', taxPeriod: 1, pensionPence: 200_000 })
    ).toThrow(PayrollInputError)
  })

  it('refuses a tax year it holds no figures for', () => {
    expect(() =>
      calculatePay({ ...BASE, taxYearStart: 2019, grossPence: 100_000, taxCode: '1257L', taxPeriod: 1 })
    ).toThrow(UnsupportedTaxYearError)
  })
})

describe('tax year and period boundaries', () => {
  it('puts 5 April in the closing year and 6 April in the new one', () => {
    expect(taxYearOfDate(new Date('2027-04-05T00:00:00Z'))).toBe(2026)
    expect(taxYearOfDate(new Date('2027-04-06T00:00:00Z'))).toBe(2027)
    expect(taxYearOfDate(new Date('2026-12-31T00:00:00Z'))).toBe(2026)
    expect(taxYearOfDate(new Date('2027-01-01T00:00:00Z'))).toBe(2026)
  })

  it('maps months to HMRC tax periods', () => {
    expect(taxPeriodOfDate(new Date('2026-04-30T00:00:00Z'), 'monthly')).toBe(1)
    expect(taxPeriodOfDate(new Date('2026-05-31T00:00:00Z'), 'monthly')).toBe(2)
    expect(taxPeriodOfDate(new Date('2027-03-31T00:00:00Z'), 'monthly')).toBe(12)
  })

  it('starts week 1 on 6 April', () => {
    expect(taxPeriodOfDate(new Date('2026-04-06T00:00:00Z'), 'weekly')).toBe(1)
    expect(taxPeriodOfDate(new Date('2026-04-12T00:00:00Z'), 'weekly')).toBe(1)
    expect(taxPeriodOfDate(new Date('2026-04-13T00:00:00Z'), 'weekly')).toBe(2)
  })

  it('formats a tax year the way a payslip does', () => {
    expect(formatTaxYear(2026)).toBe('2026/27')
    expect(formatTaxYear(1999)).toBe('1999/00')
  })
})
