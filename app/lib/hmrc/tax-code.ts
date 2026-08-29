/**
 * Parsing and validation of PAYE tax codes.
 *
 * A tax code is not a label — it is an instruction telling the employer how to
 * tax someone. This module turns the string HMRC issues into the three facts
 * the calculation needs: which band table applies, how much tax-free pay the
 * employee gets, and whether the code is operated cumulatively.
 *
 * Codes handled:
 *
 *   1257L, 1185M, 1000N, 500T   suffix codes — allowance = digits × 10
 *   K475                        negative allowance — pay is *added* to
 *   BR                          all pay at basic rate, no allowance
 *   D0, D1, D2                  all pay at higher / additional / top rate
 *   NT                          no tax deducted
 *   0T                          no allowance, but bands still apply
 *   S…                          Scottish rates (S1257L, SBR, SD0…)
 *   C…                          Welsh rates (C1257L, CBR…)
 *   … X, … W1, … M1             operated on a week-1/month-1 basis
 */

import type { TaxRegime } from './tax-years'

export type ParsedTaxCode = {
  /** The code as written, normalised to upper case without spaces. */
  code: string
  regime: TaxRegime
  /**
   * Annual tax-free pay in pence. Zero for BR/D0/D1/0T. For a K code this is
   * zero and `additionalTaxablePence` carries the negative allowance instead.
   */
  allowancePence: number
  /**
   * K codes represent a negative allowance: benefits or unpaid tax exceed the
   * allowance, so this amount is ADDED to taxable pay each year rather than
   * removed from it.
   */
  additionalTaxablePence: number
  /**
   * When set, every pound is taxed at this basis-point rate and the band table
   * is ignored. Used by BR, D0, D1 and D2.
   */
  flatRateBp: number | null
  /** NT — no tax at all. */
  noTax: boolean
  /** True when the code carries an X / W1 / M1 suffix. */
  week1Month1: boolean
}

export class InvalidTaxCodeError extends Error {
  constructor(code: string, reason: string) {
    super(`"${code}" is not a valid tax code: ${reason}`)
    this.name = 'InvalidTaxCodeError'
  }
}

/** Flat-rate codes, after any regime prefix has been removed. */
const FLAT_RATES: Record<string, number> = {
  BR: 2000,
  D0: 4000,
  D1: 4500,
  // Scotland's top rate. Only meaningful with an S prefix, but harmless here.
  D2: 4800,
}

/**
 * Parses a tax code, throwing if it cannot be operated.
 *
 * Rejecting an unrecognised code is deliberate. Defaulting to 1257L would
 * under-deduct tax for someone on BR and leave the employee with a bill they
 * did not expect.
 */
export function parseTaxCode(raw: string): ParsedTaxCode {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!code) throw new InvalidTaxCodeError(raw, 'it is empty')

  let rest = code

  // 1. Regime prefix.
  let regime: TaxRegime = 'uk'
  if (rest.startsWith('S')) {
    regime = 'scotland'
    rest = rest.slice(1)
  } else if (rest.startsWith('C')) {
    regime = 'wales'
    rest = rest.slice(1)
  }

  // 2. Week-1/month-1 suffix. HMRC writes this as X, W1 or M1, sometimes
  //    separated by a space, which normalisation has already removed.
  let week1Month1 = false
  const nonCumulative = /(X|W1|M1)$/.exec(rest)
  if (nonCumulative && rest !== 'X') {
    week1Month1 = true
    rest = rest.slice(0, -nonCumulative[1].length)
  }

  const base = {
    code,
    regime,
    allowancePence: 0,
    additionalTaxablePence: 0,
    flatRateBp: null as number | null,
    noTax: false,
    week1Month1,
  }

  // 3. NT — no tax.
  if (rest === 'NT') return { ...base, noTax: true }

  // 4. Flat-rate codes.
  if (rest in FLAT_RATES) return { ...base, flatRateBp: FLAT_RATES[rest] }

  // 5. 0T — no allowance, but the normal bands still apply.
  if (rest === '0T') return base

  // 6. K codes — negative allowance.
  if (rest.startsWith('K')) {
    const digits = rest.slice(1)
    if (!/^\d+$/.test(digits)) {
      throw new InvalidTaxCodeError(raw, 'a K code must be K followed by digits')
    }
    return { ...base, additionalTaxablePence: Number(digits) * 10 * 100 }
  }

  // 7. Suffix codes: digits followed by L, M, N or T.
  const suffix = /^(\d+)([LMNT])$/.exec(rest)
  if (suffix) {
    return { ...base, allowancePence: Number(suffix[1]) * 10 * 100 }
  }

  throw new InvalidTaxCodeError(
    raw,
    'it is not a recognised suffix (1257L), flat rate (BR, D0, D1), K, 0T or NT code'
  )
}

/** Whether a string is a tax code this engine can operate. */
export function isValidTaxCode(raw: string): boolean {
  try {
    parseTaxCode(raw)
    return true
  } catch {
    return false
  }
}

/**
 * A short human description, for the payslip and the staff profile.
 * `1257L` on its own tells an employee nothing.
 */
export function describeTaxCode(raw: string): string {
  const parsed = parseTaxCode(raw)
  const parts: string[] = []

  if (parsed.noTax) parts.push('No tax deducted')
  else if (parsed.flatRateBp !== null) {
    parts.push(`All pay taxed at ${parsed.flatRateBp / 100}%`)
  } else if (parsed.additionalTaxablePence > 0) {
    parts.push(
      `Adds £${(parsed.additionalTaxablePence / 100).toLocaleString('en-GB')} to taxable pay`
    )
  } else if (parsed.allowancePence > 0) {
    parts.push(
      `£${(parsed.allowancePence / 100).toLocaleString('en-GB')} tax-free a year`
    )
  } else {
    parts.push('No tax-free allowance')
  }

  if (parsed.regime === 'scotland') parts.push('Scottish rates')
  if (parsed.regime === 'wales') parts.push('Welsh rates')
  if (parsed.week1Month1) parts.push('week 1/month 1 basis')

  return parts.join(', ')
}
