/**
 * PAYE, National Insurance and student loan calculation.
 *
 * Implements HMRC's exact-percentage method (the computerised alternative to
 * the printed tax tables) for Class 1 employees.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS IMPLEMENTED
 *
 *   - Cumulative PAYE, including in-year refunds when a code changes
 *   - Week-1/month-1 (non-cumulative) operation
 *   - Suffix codes (L/M/N/T), BR, D0, D1, D2, 0T, NT and K codes
 *   - The K-code regulatory limit (tax capped at 50% of gross)
 *   - Scottish and Welsh band tables via the S and C prefixes
 *   - Class 1 employee NI for every category letter, period-by-period
 *   - Student loan plans 1, 2, 4 and 5, and postgraduate loans
 *   - Weekly, fortnightly, four-weekly and monthly pay frequencies
 *
 * WHAT IS NOT IMPLEMENTED — deliberately, and documented rather than faked
 *
 *   - Employer (secondary) NI and the Employment Allowance. This engine
 *     computes what the employee is paid, not the employer's own liability.
 *   - Directors' annual-earnings-period NI.
 *   - Statutory payments: SSP, SMP, SPP, ShPP, SAP, SPBP.
 *   - Pension tax relief methods. Contributions are treated as net-pay
 *     arrangement (deducted before tax), which is what a relief-at-source
 *     scheme would get wrong.
 *   - Salary sacrifice, payrolled benefits in kind, Class 1A.
 *   - Attachment of earnings orders.
 *   - RTI: no FPS or EPS is submitted to HMRC. Nothing here is filed.
 *
 * Because of the final point in particular, this produces correct *figures*
 * for the cases it covers but is not a complete payroll filing system.
 * ---------------------------------------------------------------------------
 *
 * All money is integer pence. Rounding follows HMRC:
 *   - free pay is rounded UP to the penny, in the employee's favour
 *   - tax due to date is rounded DOWN to the penny
 *   - NI is rounded to the nearest penny
 *   - student loan deductions are rounded DOWN to the whole pound
 */

import { parseTaxCode, type ParsedTaxCode } from './tax-code'
import { taxYear, type TaxYear } from './tax-years'

export * from './tax-years'
export * from './tax-code'

export const CALCULATION_VERSION = 'hmrc-paye-v1'

export type PayFrequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly'

/** How many times a year each frequency pays. Drives every apportionment. */
export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  four_weekly: 13,
  monthly: 12,
}

/** Cumulative figures for the tax year BEFORE the period being calculated. */
export type YearToDate = {
  grossPence: number
  taxablePence: number
  taxPence: number
  niPence: number
  pensionPence: number
}

export const ZERO_YTD: YearToDate = {
  grossPence: 0,
  taxablePence: 0,
  taxPence: 0,
  niPence: 0,
  pensionPence: 0,
}

export type PayrollInput = {
  /** This period's gross pay, before any deduction. */
  grossPence: number
  taxCode: string
  /** Cumulative unless the code itself carries an X/W1/M1 suffix. */
  basis: 'cumulative' | 'week1_month1'
  niCategory: string
  payFrequency: PayFrequency
  /** April-start year: 2026 is 2026/27. */
  taxYearStart: number
  /** 1-12 for monthly, 1-52/53 for weekly, and so on. */
  taxPeriod: number
  /** Figures for periods 1..taxPeriod-1. */
  ytd?: YearToDate
  /** Employee pension contribution this period, as a net-pay arrangement. */
  pensionPence?: number
  studentLoanPlan?: number | null
  postgradLoan?: boolean
}

export type PayrollResult = {
  grossPence: number
  /** Pay subject to tax this period, after pension and free pay. */
  taxablePence: number
  taxPence: number
  niPence: number
  pensionPence: number
  studentLoanPence: number
  postgradLoanPence: number
  netPence: number

  /** Cumulative totals INCLUDING this period, for storing on the record. */
  ytd: YearToDate

  /** Provenance, so a payslip can explain itself. */
  taxCode: string
  taxCodeDescription: ParsedTaxCode
  basis: 'cumulative' | 'week1_month1'
  niCategory: string
  taxPeriod: number
  taxYearStart: number
  payFrequency: PayFrequency
  calculationVersion: string
}

export class PayrollInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollInputError'
  }
}

/** Rounds a rational number of pence down to a whole penny. */
function floorPence(value: number): number {
  return Math.floor(value + 1e-6)
}

/** Rounds up to a whole penny — used for free pay, which favours the employee. */
function ceilPence(value: number): number {
  return Math.ceil(value - 1e-6)
}

function roundPence(value: number): number {
  return Math.round(value)
}

function applyBp(amountPence: number, basisPoints: number): number {
  return (amountPence * basisPoints) / 10000
}

/**
 * The proportion of an annual figure available by the end of a given period.
 *
 * Under cumulative operation an employee has earned P/N of their annual
 * allowance and band widths by period P. Under week-1/month-1 every period is
 * treated as if it were period 1.
 */
function periodFraction(
  taxPeriod: number,
  periodsPerYear: number,
  cumulative: boolean
): number {
  return cumulative ? taxPeriod / periodsPerYear : 1 / periodsPerYear
}

/**
 * Income tax due on a cumulative taxable figure, using the band table.
 *
 * Bands are apportioned by the same fraction as the allowance, so by month 3 a
 * monthly-paid employee has had 3/12 of the basic rate band available.
 */
function taxOnBands(
  cumulativeTaxablePence: number,
  year: TaxYear,
  parsed: ParsedTaxCode,
  fraction: number
): number {
  if (parsed.flatRateBp !== null) {
    return applyBp(cumulativeTaxablePence, parsed.flatRateBp)
  }

  const bands = year.bands[parsed.regime]
  let tax = 0
  let previousBound = 0

  for (const band of bands) {
    const bound =
      band.upperPence === null
        ? Number.POSITIVE_INFINITY
        : band.upperPence * fraction

    const inBand = Math.min(cumulativeTaxablePence, bound) - previousBound
    if (inBand > 0) tax += applyBp(inBand, band.rateBp)

    if (cumulativeTaxablePence <= bound) break
    previousBound = bound
  }

  return tax
}

/**
 * The NI threshold for a pay frequency, using HMRC's published figures.
 *
 * Weekly and monthly are published directly. Fortnightly and four-weekly are
 * defined by HMRC as multiples of the weekly threshold, which is not the same
 * as the annual figure divided by 26 or 13.
 */
function niThresholdFor(
  threshold: { weeklyPence: number; monthlyPence: number },
  frequency: PayFrequency
): number {
  switch (frequency) {
    case 'weekly':
      return threshold.weeklyPence
    case 'fortnightly':
      return threshold.weeklyPence * 2
    case 'four_weekly':
      return threshold.weeklyPence * 4
    case 'monthly':
      return threshold.monthlyPence
  }
}

/**
 * Employee Class 1 NI for a single period.
 *
 * NI is never cumulative for a normal employee — each period stands alone,
 * which is why someone with an uneven income pays more NI over a year than
 * someone earning the same total evenly. Directors are the exception and are
 * out of scope.
 */
function computeNi(
  grossPence: number,
  year: TaxYear,
  niCategory: string,
  frequency: PayFrequency
): number {
  const rates = year.ni.categories[niCategory.toUpperCase()]
  if (!rates) {
    throw new PayrollInputError(
      `Unknown NI category "${niCategory}". Valid letters: ` +
        Object.keys(year.ni.categories).join(', ')
    )
  }

  const primaryThreshold = niThresholdFor(year.ni.primaryThreshold, frequency)
  const upperLimit = niThresholdFor(year.ni.upperEarningsLimit, frequency)

  if (grossPence <= primaryThreshold) return 0

  const mainBandPay = Math.min(grossPence, upperLimit) - primaryThreshold
  const upperBandPay = Math.max(0, grossPence - upperLimit)

  return roundPence(
    applyBp(Math.max(0, mainBandPay), rates.mainBp) +
      applyBp(upperBandPay, rates.upperBp)
  )
}

/**
 * Student loan deduction for a period.
 *
 * Assessed on gross pay (not taxable pay), non-cumulatively, and rounded down
 * to the whole pound as HMRC requires.
 */
function computeStudentLoan(
  grossPence: number,
  annualThresholdPence: number,
  rateBp: number,
  periodsPerYear: number
): number {
  const threshold = annualThresholdPence / periodsPerYear
  if (grossPence <= threshold) return 0
  const due = applyBp(grossPence - threshold, rateBp)
  // Round down to whole pounds.
  return Math.floor(due / 100) * 100
}

/**
 * Calculates one employee's pay for one period.
 *
 * The cumulative principle: work out the tax due on everything earned so far
 * this tax year, then subtract the tax already paid. The difference is this
 * period's deduction — which is how a tax code change mid-year corrects
 * itself, and how a refund arises when the correction is downward.
 */
export function calculatePay(input: PayrollInput): PayrollResult {
  const {
    grossPence,
    taxCode,
    niCategory,
    payFrequency,
    taxYearStart,
    taxPeriod,
    ytd = ZERO_YTD,
    pensionPence = 0,
    studentLoanPlan = null,
    postgradLoan = false,
  } = input

  if (!Number.isInteger(grossPence) || grossPence < 0) {
    throw new PayrollInputError('Gross pay must be a whole, non-negative number of pence.')
  }
  if (!Number.isInteger(pensionPence) || pensionPence < 0) {
    throw new PayrollInputError('Pension contribution must be a whole, non-negative number of pence.')
  }
  if (pensionPence > grossPence) {
    throw new PayrollInputError('Pension contribution cannot exceed gross pay.')
  }

  const year = taxYear(taxYearStart)
  const parsed = parseTaxCode(taxCode)
  const periodsPerYear = PERIODS_PER_YEAR[payFrequency]

  if (!Number.isInteger(taxPeriod) || taxPeriod < 1) {
    throw new PayrollInputError('Tax period must be a positive whole number.')
  }
  // Week 53 exists for weekly payrolls where a year contains an extra payday.
  const maxPeriod = payFrequency === 'weekly' ? 53 : periodsPerYear
  if (taxPeriod > maxPeriod) {
    throw new PayrollInputError(
      `Tax period ${taxPeriod} is out of range for a ${payFrequency} payroll (max ${maxPeriod}).`
    )
  }

  // The code's own X/W1/M1 suffix overrides whatever basis was stored: HMRC
  // issuing "1257L X" *is* the instruction to operate non-cumulatively.
  const cumulative = input.basis === 'cumulative' && !parsed.week1Month1
  const basis = cumulative ? 'cumulative' : 'week1_month1'

  // Pension under a net-pay arrangement reduces pay before tax, but NOT before
  // NI — NI is always assessed on the full gross.
  const payAfterPension = grossPence - pensionPence

  // --- Income tax --------------------------------------------------------
  let taxPence = 0
  let taxableThisPeriod = 0

  if (parsed.noTax) {
    taxableThisPeriod = 0
    taxPence = 0
  } else {
    const fraction = periodFraction(taxPeriod, periodsPerYear, cumulative)

    // Under week1/month1 nothing before this period counts.
    const priorTaxable = cumulative ? ytd.taxablePence : 0
    const priorTax = cumulative ? ytd.taxPence : 0
    const priorPayAfterPension = cumulative
      ? ytd.grossPence - ytd.pensionPence
      : 0

    const cumulativePay = priorPayAfterPension + payAfterPension

    // Free pay to date, rounded up in the employee's favour. A K code has no
    // free pay; its negative allowance is added to taxable pay instead.
    const freePayToDate = ceilPence(parsed.allowancePence * fraction)
    const additionalToDate = ceilPence(parsed.additionalTaxablePence * fraction)

    const cumulativeTaxable = Math.max(
      0,
      cumulativePay - freePayToDate + additionalToDate
    )

    const cumulativeTaxDue = floorPence(
      taxOnBands(cumulativeTaxable, year, parsed, fraction)
    )

    taxPence = cumulativeTaxDue - priorTax
    taxableThisPeriod = cumulativeTaxable - priorTaxable

    // The regulatory limit: PAYE tax deducted in a period can never exceed 50%
    // of that period's gross pay. It exists for K codes, where the added
    // notional pay could otherwise swallow the whole payslip.
    const regulatoryLimit = floorPence(grossPence / 2)
    if (taxPence > regulatoryLimit) taxPence = regulatoryLimit

    // A negative figure is a refund, which cumulative operation produces
    // legitimately when a code is raised mid-year. It is capped at the tax
    // actually paid so far so the employer never refunds more than it took.
    if (taxPence < 0) taxPence = Math.max(taxPence, -priorTax)
  }

  // --- National Insurance ------------------------------------------------
  const niPence = computeNi(grossPence, year, niCategory, payFrequency)

  // --- Student loans -----------------------------------------------------
  let studentLoanPence = 0
  if (studentLoanPlan != null) {
    const plan = year.studentLoans.plans[studentLoanPlan]
    if (!plan) {
      throw new PayrollInputError(
        `Student loan plan ${studentLoanPlan} does not apply in ${taxYearStart}/` +
          `${String(taxYearStart + 1).slice(2)}.`
      )
    }
    studentLoanPence = computeStudentLoan(
      grossPence,
      plan.annualThresholdPence,
      plan.rateBp,
      periodsPerYear
    )
  }

  const postgradLoanPence = postgradLoan
    ? computeStudentLoan(
        grossPence,
        year.studentLoans.postgraduate.annualThresholdPence,
        year.studentLoans.postgraduate.rateBp,
        periodsPerYear
      )
    : 0

  // --- Net ---------------------------------------------------------------
  const deductions =
    taxPence + niPence + pensionPence + studentLoanPence + postgradLoanPence
  const netPence = grossPence - deductions

  return {
    grossPence,
    taxablePence: Math.max(0, taxableThisPeriod),
    taxPence,
    niPence,
    pensionPence,
    studentLoanPence,
    postgradLoanPence,
    netPence,
    ytd: {
      grossPence: ytd.grossPence + grossPence,
      taxablePence: ytd.taxablePence + Math.max(0, taxableThisPeriod),
      taxPence: ytd.taxPence + taxPence,
      niPence: ytd.niPence + niPence,
      pensionPence: ytd.pensionPence + pensionPence,
    },
    taxCode: parsed.code,
    taxCodeDescription: parsed,
    basis,
    niCategory: niCategory.toUpperCase(),
    taxPeriod,
    taxYearStart,
    payFrequency,
    calculationVersion: CALCULATION_VERSION,
  }
}

// ---------------------------------------------------------------------------
// Tax year / period helpers
// ---------------------------------------------------------------------------

/**
 * The April-start year of the tax year a date falls in.
 *
 * The UK tax year runs 6 April to 5 April, so 1 April 2027 belongs to 2026/27
 * while 6 April 2027 begins 2027/28. Getting this boundary wrong misfiles a
 * whole payslip, so it is derived rather than assumed from the calendar year.
 */
export function taxYearOfDate(date: Date): number {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const beforeApril6 = month < 4 || (month === 4 && day < 6)
  return beforeApril6 ? year - 1 : year
}

/**
 * The HMRC tax period a payment date falls in.
 *
 * Month 1 is 6 April to 5 May. Week 1 is the first 7 days from 6 April.
 */
export function taxPeriodOfDate(date: Date, frequency: PayFrequency): number {
  const startYear = taxYearOfDate(date)
  const yearStart = Date.UTC(startYear, 3, 6)
  const daysElapsed = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      yearStart) /
      86_400_000
  )

  if (frequency === 'monthly') {
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    // On or after the 6th the payment falls in the month beginning that 6th.
    const shifted = day >= 6 ? month : month - 1
    const period = shifted >= 4 ? shifted - 3 : shifted + 9
    return Math.min(12, Math.max(1, period))
  }

  const daysPerPeriod =
    frequency === 'weekly' ? 7 : frequency === 'fortnightly' ? 14 : 28
  return Math.max(1, Math.floor(daysElapsed / daysPerPeriod) + 1)
}

/** "2026/27" — how a tax year is written on a payslip. */
export function formatTaxYear(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}
