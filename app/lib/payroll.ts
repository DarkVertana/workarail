/**
 * Payroll calculation engine — SIMPLIFIED, NOT HMRC-COMPLIANT.
 *
 * ---------------------------------------------------------------------------
 * SCOPE WARNING
 *
 * This applies flat percentages from the organisation's settings to a single
 * annual allowance. It does NOT implement:
 *
 *   - cumulative PAYE, tax code operation (L/M/N/BR/D0/K, week-1/month-1)
 *   - National Insurance categories, thresholds or director's NI
 *   - student loan plans, postgraduate loans, salary sacrifice
 *   - pension tax relief methods (net pay vs relief-at-source)
 *   - statutory payments (SSP, SMP, SPP), or RTI/FPS submission to HMRC
 *
 * It is a management estimate for internal cost reporting. Figures produced
 * here must not be presented to an employee or to HMRC as a statutory
 * calculation. Every stored record carries `calculationVersion` so runs
 * produced by this engine remain identifiable if a compliant engine replaces
 * it later.
 * ---------------------------------------------------------------------------
 *
 * All arithmetic is in integer pence.
 */

export const CALCULATION_VERSION = 'simplified-v1'

export const PAYROLL_DISCLAIMER =
  'Estimated using simplified flat rates. Not a statutory HMRC calculation.'

export type PayrollRates = {
  /** Annual personal allowance in pence, apportioned monthly. */
  allowancePence: number
  taxPercent: number
  niPercent: number
  pensionPercent: number
}

export type PayComponents = {
  grossPence: number
  taxablePence: number
  taxPence: number
  niPence: number
  pensionPence: number
  netPence: number
  calculationVersion: string
}

function pct(amountPence: number, percent: number): number {
  // Percentages arrive as human numbers (20 for 20%). Scale to basis points
  // first so a fractional percent cannot introduce a float into the result.
  const basisPoints = Math.round(percent * 100)
  return Math.round((amountPence * basisPoints) / 10000)
}

/**
 * Computes one month's deductions.
 *
 * The allowance is the *monthly* share of the annual figure, which is what
 * the previous implementation got wrong: it subtracted the full annual
 * allowance from a single month's gross, understating tax for every employee.
 */
export function computePay(
  grossPence: number,
  rates: PayrollRates
): PayComponents {
  if (!Number.isInteger(grossPence) || grossPence < 0) {
    throw new Error('Gross pay must be a non-negative whole number of pence.')
  }

  const monthlyAllowance = Math.round(rates.allowancePence / 12)
  const taxablePence = Math.max(0, grossPence - monthlyAllowance)

  const taxPence = pct(taxablePence, rates.taxPercent)
  const niPence = pct(taxablePence, rates.niPercent)
  const pensionPence = pct(grossPence, rates.pensionPercent)

  // Deductions can never exceed gross, however the rates are configured.
  const totalDeductions = Math.min(
    taxPence + niPence + pensionPence,
    grossPence
  )

  return {
    grossPence,
    taxablePence,
    taxPence,
    niPence,
    pensionPence,
    netPence: grossPence - totalDeductions,
    calculationVersion: CALCULATION_VERSION,
  }
}

/**
 * Recomputes a payroll record from its base pay plus every adjustment, so an
 * adjustment never silently overwrites the figure it was applied to and the
 * run can always be rebuilt from its inputs.
 *
 * The invariant `netPence === grossPence - (tax + ni + pension)` holds for
 * every result. A previous version added non-taxable adjustments to net
 * *after* the deductions were clamped to gross, so a large negative
 * non-taxable adjustment floored net at zero while gross floored
 * independently — gross and net could then describe amounts that did not
 * reconcile, and the payslip rendered both.
 */
export function recomputeWithAdjustments(
  baseGrossPence: number,
  adjustments: Array<{ amountPence: number; taxable: boolean }>,
  rates: PayrollRates
): PayComponents & { baseGrossPence: number; deductionsPence: number } {
  const sum = (taxable: boolean) =>
    adjustments
      .filter((a) => a.taxable === taxable)
      .reduce((total, a) => total + a.amountPence, 0)

  // Deductions are assessed on the taxable portion only, but the employee is
  // paid the whole gross, so the two are tracked separately and reconciled at
  // the end.
  const taxableGross = Math.max(0, baseGrossPence + sum(true))
  const computed = computePay(taxableGross, rates)
  const grossPence = Math.max(0, taxableGross + sum(false))

  const deductionsPence = Math.min(
    computed.taxPence + computed.niPence + computed.pensionPence,
    grossPence
  )

  return {
    ...computed,
    baseGrossPence,
    grossPence,
    deductionsPence,
    netPence: grossPence - deductionsPence,
  }
}

/**
 * Nominal hours each attendance code contributes to a working day.
 *
 * This is the single definition. A duplicate previously lived in
 * `app/lib/admin-data.ts` and was consumed by the finance dashboard, which
 * therefore reported nominal hours while the staff roster reported recorded
 * hours, and the two screens disagreed about the same week.
 */
export const attendanceHours: Record<string, number> = {
  P: 9,
  H: 4.5,
  L: 8,
  A: 0,
  '-': 0,
}

export function hoursFor(code: string): number {
  return attendanceHours[code] ?? 0
}

/**
 * The share of a day's pay each attendance code earns, for day-rate staff.
 *
 * Distinct from `attendanceHours`, which measures time worked for utilisation.
 * `L` pays in full because unpaid leave is recorded against the leave request
 * (`LeaveType.unpaid`) and excluded before it reaches here — see
 * `payableDaysFrom`.
 */
export const payableDayValue: Record<string, number> = {
  P: 1,
  H: 0.5,
  L: 1,
  A: 0,
  '-': 0,
}

/**
 * Payable days for a month's attendance.
 *
 * `unpaidDates` are days covered by unpaid leave; they are excluded whatever
 * code the roster carries, so an unpaid absence recorded as `L` does not pay.
 */
export function payableDaysFrom(
  rows: Array<{ date: string; code: string }>,
  unpaidDates: ReadonlySet<string> = new Set()
): number {
  const days = rows.reduce((total, row) => {
    if (unpaidDates.has(row.date)) return total
    return total + (payableDayValue[row.code] ?? 0)
  }, 0)
  // Halves are the only fraction the roster can produce.
  return Math.round(days * 2) / 2
}

/** Base gross for a day-rate employee, in pence. */
export function computeBaseGross(daysWorked: number, dayRatePence: number): number {
  if (dayRatePence < 0) throw new Error('Day rate cannot be negative.')
  return Math.round(daysWorked * dayRatePence)
}
