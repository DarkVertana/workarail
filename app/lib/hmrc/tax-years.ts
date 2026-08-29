/**
 * HMRC rates, thresholds and bands, versioned by tax year.
 *
 * Every statutory figure the payroll engine needs lives here and nowhere else,
 * keyed by the April-start year of the tax year (2026 means 2026/27). When
 * HMRC publishes the next year's figures, a new entry is added and no
 * calculation code changes.
 *
 * All money is in integer pence. Percentages are basis points (800 = 8%) so
 * that a rate like 1.85% stays exact in integer arithmetic.
 *
 * Sources (2026/27):
 *   - Income tax rates and allowances — https://www.gov.uk/income-tax-rates
 *   - Rates and thresholds for employers 2026 to 2027 —
 *     https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
 *   - Scottish rates and bands —
 *     https://www.gov.scot/publications/scottish-income-tax-rates-and-bands/
 *   - Student loan repayment guidance —
 *     https://www.gov.uk/guidance/special-rules-for-student-loans
 */

/** Which set of income tax bands applies, driven by the tax code prefix. */
export type TaxRegime = 'uk' | 'scotland' | 'wales'

/** A single income tax band, measured on taxable pay after the allowance. */
export type TaxBand = {
  name: string
  /**
   * Cumulative upper bound of this band in pence, measured on taxable pay
   * (i.e. after free pay is removed). Null means "no upper bound".
   */
  upperPence: number | null
  /** Basis points: 2000 = 20%. */
  rateBp: number
}

export type NiCategoryRates = {
  /** Between the primary threshold and the upper earnings limit. */
  mainBp: number
  /** Above the upper earnings limit. */
  upperBp: number
}

/**
 * An NI threshold, in pence, at each of HMRC's published cadences.
 *
 * These are published figures, NOT the annual amount divided by the number of
 * periods — the two differ. The monthly primary threshold is £1,048 whereas
 * £12,570 / 12 is £1,047.50, and using the derived value over-deducts NI from
 * every monthly-paid employee. Fortnightly and four-weekly thresholds are
 * multiples of the weekly figure, which is how HMRC defines them.
 */
export type NiThreshold = {
  weeklyPence: number
  monthlyPence: number
  annualPence: number
}

export type StudentLoanPlan = {
  annualThresholdPence: number
  rateBp: number
}

export type TaxYear = {
  /** April-start year: 2026 is the 2026/27 tax year. */
  startYear: number
  /** Standard personal allowance, used when a code does not imply one. */
  personalAllowancePence: number
  /**
   * Allowance tapers by £1 for every £2 of income above this. Applied by HMRC
   * through the tax code rather than by the payroll engine, so it is recorded
   * for reference and for validating that a code looks plausible.
   */
  allowanceTaperThresholdPence: number

  bands: Record<TaxRegime, TaxBand[]>

  ni: {
    /** Below this, no NI and no contributory benefit is earned. */
    lowerEarningsLimit: NiThreshold
    /** Employee NI starts here. */
    primaryThreshold: NiThreshold
    /** Above here the employee rate drops to the upper rate. */
    upperEarningsLimit: NiThreshold
    categories: Record<string, NiCategoryRates>
  }

  studentLoans: {
    plans: Record<number, StudentLoanPlan>
    postgraduate: StudentLoanPlan
  }
}

const POUND = 100

/**
 * 2026/27.
 *
 * Band bounds are expressed on *taxable* pay, so the published thresholds have
 * the personal allowance removed: the basic rate ends at £50,270 of income,
 * which is £37,700 of taxable pay once £12,570 of allowance is taken off.
 */
const TAX_YEAR_2026: TaxYear = {
  startYear: 2026,
  personalAllowancePence: 12_570 * POUND,
  allowanceTaperThresholdPence: 100_000 * POUND,

  bands: {
    // England and Northern Ireland.
    uk: [
      { name: 'Basic rate', upperPence: 37_700 * POUND, rateBp: 2000 },
      { name: 'Higher rate', upperPence: 112_570 * POUND, rateBp: 4000 },
      { name: 'Additional rate', upperPence: null, rateBp: 4500 },
    ],
    // Welsh rates are set by the Senedd but currently match rUK exactly.
    wales: [
      { name: 'Basic rate', upperPence: 37_700 * POUND, rateBp: 2000 },
      { name: 'Higher rate', upperPence: 112_570 * POUND, rateBp: 4000 },
      { name: 'Additional rate', upperPence: null, rateBp: 4500 },
    ],
    scotland: [
      { name: 'Starter rate', upperPence: 3_967 * POUND, rateBp: 1900 },
      { name: 'Basic rate', upperPence: 16_956 * POUND, rateBp: 2000 },
      { name: 'Intermediate rate', upperPence: 31_092 * POUND, rateBp: 2100 },
      { name: 'Higher rate', upperPence: 62_430 * POUND, rateBp: 4200 },
      { name: 'Advanced rate', upperPence: 112_570 * POUND, rateBp: 4500 },
      { name: 'Top rate', upperPence: null, rateBp: 4800 },
    ],
  },

  ni: {
    lowerEarningsLimit: {
      weeklyPence: 129 * POUND,
      monthlyPence: 559 * POUND,
      annualPence: 6_708 * POUND,
    },
    primaryThreshold: {
      weeklyPence: 242 * POUND,
      monthlyPence: 1_048 * POUND,
      annualPence: 12_570 * POUND,
    },
    upperEarningsLimit: {
      weeklyPence: 967 * POUND,
      monthlyPence: 4_189 * POUND,
      annualPence: 50_270 * POUND,
    },
    categories: {
      A: { mainBp: 800, upperBp: 200 },
      // Married women / widows with a valid certificate of election.
      B: { mainBp: 185, upperBp: 200 },
      // Over state pension age: no employee contribution.
      C: { mainBp: 0, upperBp: 0 },
      D: { mainBp: 200, upperBp: 200 },
      E: { mainBp: 185, upperBp: 200 },
      F: { mainBp: 800, upperBp: 200 },
      // Apprentice under 25.
      H: { mainBp: 800, upperBp: 200 },
      I: { mainBp: 185, upperBp: 200 },
      // Deferment: already paying NI in another job.
      J: { mainBp: 200, upperBp: 200 },
      K: { mainBp: 0, upperBp: 0 },
      L: { mainBp: 200, upperBp: 200 },
      // Under 21.
      M: { mainBp: 800, upperBp: 200 },
      N: { mainBp: 800, upperBp: 200 },
      S: { mainBp: 0, upperBp: 0 },
      // Veteran in first civilian job.
      V: { mainBp: 800, upperBp: 200 },
      // Not liable, e.g. under 16.
      X: { mainBp: 0, upperBp: 0 },
      // Under 21 with deferment.
      Z: { mainBp: 200, upperBp: 200 },
    },
  },

  studentLoans: {
    plans: {
      1: { annualThresholdPence: 26_900 * POUND, rateBp: 900 },
      2: { annualThresholdPence: 29_385 * POUND, rateBp: 900 },
      4: { annualThresholdPence: 33_795 * POUND, rateBp: 900 },
      // Plan 5 becomes collectable through PAYE from 6 April 2026.
      5: { annualThresholdPence: 25_000 * POUND, rateBp: 900 },
    },
    postgraduate: { annualThresholdPence: 21_000 * POUND, rateBp: 600 },
  },
}

/**
 * 2025/26. Retained so that a correction or a late payslip for the previous
 * year is recalculated with the rules that actually applied at the time.
 */
const TAX_YEAR_2025: TaxYear = {
  ...TAX_YEAR_2026,
  startYear: 2025,
  bands: {
    ...TAX_YEAR_2026.bands,
    scotland: [
      { name: 'Starter rate', upperPence: 2_827 * POUND, rateBp: 1900 },
      { name: 'Basic rate', upperPence: 14_921 * POUND, rateBp: 2000 },
      { name: 'Intermediate rate', upperPence: 31_092 * POUND, rateBp: 2100 },
      { name: 'Higher rate', upperPence: 62_430 * POUND, rateBp: 4200 },
      { name: 'Advanced rate', upperPence: 112_570 * POUND, rateBp: 4500 },
      { name: 'Top rate', upperPence: null, rateBp: 4800 },
    ],
  },
  ni: {
    ...TAX_YEAR_2026.ni,
    // The only NI threshold that moved between 2025/26 and 2026/27.
    lowerEarningsLimit: {
      weeklyPence: 125 * POUND,
      monthlyPence: 542 * POUND,
      annualPence: 6_500 * POUND,
    },
  },
  studentLoans: {
    plans: {
      1: { annualThresholdPence: 26_065 * POUND, rateBp: 900 },
      2: { annualThresholdPence: 28_470 * POUND, rateBp: 900 },
      4: { annualThresholdPence: 32_745 * POUND, rateBp: 900 },
      // Plan 5 existed but was not collectable through PAYE before April 2026.
    },
    postgraduate: { annualThresholdPence: 21_000 * POUND, rateBp: 600 },
  },
}

const TAX_YEARS: Record<number, TaxYear> = {
  2025: TAX_YEAR_2025,
  2026: TAX_YEAR_2026,
}

/** The most recent tax year this build carries figures for. */
export const LATEST_TAX_YEAR = 2026

export class UnsupportedTaxYearError extends Error {
  constructor(startYear: number) {
    super(
      `No HMRC figures are held for the ${startYear}/${String(startYear + 1).slice(2)} ` +
        `tax year. Supported: ${Object.keys(TAX_YEARS).join(', ')}.`
    )
    this.name = 'UnsupportedTaxYearError'
  }
}

/**
 * Returns the statutory figures for a tax year.
 *
 * Throws rather than falling back to the latest year: silently paying someone
 * using next year's thresholds is far worse than refusing to run.
 */
export function taxYear(startYear: number): TaxYear {
  const year = TAX_YEARS[startYear]
  if (!year) throw new UnsupportedTaxYearError(startYear)
  return year
}

export function isSupportedTaxYear(startYear: number): boolean {
  return startYear in TAX_YEARS
}

export function supportedTaxYears(): number[] {
  return Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b)
}
