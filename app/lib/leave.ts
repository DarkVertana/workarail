/**
 * Leave arithmetic, shared by the admin dialog and the server action so the
 * preview a user approves is the number that actually gets stored.
 *
 * Everything here is pure and works on ISO 'YYYY-MM-DD' strings, so there is no
 * timezone drift between what the browser shows and what the server writes.
 */

import type { LeaveType } from '@/app/lib/admin-data'

/** Which half of the first day the absence starts in. */
export type StartAt = 'morning' | 'afternoon'
/** Which half of the last day the absence runs to. */
export type EndAt = 'lunchtime' | 'end_of_day'

/**
 * Per-type rules, the equivalent of Absentify's configurable leave types.
 * `deducts` decides whether the days come off the annual allowance; sick and
 * unpaid are tracked but do not eat into someone's holiday entitlement.
 */
export const LEAVE_POLICY: Record<
  LeaveType,
  {
    label: string
    /** Comes off the annual allowance. */
    deducts: boolean
    /** Can be booked in half days. */
    halfDays: boolean
    hint: string
  }
> = {
  annual: {
    label: 'Annual leave',
    deducts: true,
    halfDays: true,
    hint: 'Paid holiday, comes off the allowance',
  },
  sick: {
    label: 'Sick leave',
    deducts: false,
    halfDays: true,
    hint: 'Paid, does not touch the allowance',
  },
  unpaid: {
    label: 'Unpaid leave',
    deducts: false,
    halfDays: true,
    hint: 'Unpaid, does not touch the allowance',
  },
  parental: {
    label: 'Parental leave',
    deducts: false,
    halfDays: false,
    hint: 'Statutory, booked in whole days',
  },
  compassionate: {
    label: 'Compassionate leave',
    deducts: false,
    halfDays: true,
    hint: 'Paid, does not touch the allowance',
  },
}

export const LEAVE_TYPES = Object.keys(LEAVE_POLICY) as LeaveType[]

/** Which weekend days the company works, read from the settings string. */
export type WorkingPattern = { saturday: boolean; sunday: boolean }

export function workingPatternFrom(setting: string | undefined): WorkingPattern {
  if (setting === 'Monday to Saturday') return { saturday: true, sunday: false }
  return { saturday: false, sunday: false }
}

function dayOfWeek(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}

export function isWorkingDay(
  iso: string,
  pattern: WorkingPattern,
  holidays: Record<string, string>
) {
  if (holidays[iso]) return false
  const day = dayOfWeek(iso)
  if (day === 6) return pattern.saturday
  if (day === 0) return pattern.sunday
  return true
}

/** Every ISO day from `from` to `to` inclusive. */
export function eachDay(from: string, to: string) {
  if (!from || !to || to < from) return []
  const out: string[] = []
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  for (
    let t = new Date(`${from}T00:00:00.000Z`).getTime();
    t <= end;
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10))
    if (out.length > 730) break // two years is well past anything sensible
  }
  return out
}

export type LeaveBreakdown = {
  /** Total span, weekends and holidays included. */
  calendarDays: number
  /** Days dropped because the company does not work them. */
  weekendDays: number
  /** Public holidays inside the span, dropped from the deduction. */
  holidays: Array<{ date: string; name: string }>
  /** The days actually being taken off. */
  workingDays: string[]
  /** Days removed by starting at lunchtime or ending at lunchtime. */
  halfDayAdjustment: number
  /** What the request costs: working days less any half-day adjustment. */
  days: number
  /** Set when the start/end halves cannot describe a real absence. */
  error: string | null
}

/**
 * Works out what a request actually costs, the way Absentify does it: take the
 * span, drop the days the company does not work, drop public holidays, then
 * apply the half-day markers on the first and last day.
 */
export function computeLeave({
  from,
  to,
  startAt = 'morning',
  endAt = 'end_of_day',
  pattern,
  holidays,
  allowHalfDays = true,
}: {
  from: string
  to: string
  startAt?: StartAt
  endAt?: EndAt
  pattern: WorkingPattern
  holidays: Record<string, string>
  allowHalfDays?: boolean
}): LeaveBreakdown {
  const empty: LeaveBreakdown = {
    calendarDays: 0,
    weekendDays: 0,
    holidays: [],
    workingDays: [],
    halfDayAdjustment: 0,
    days: 0,
    error: null,
  }

  if (!from || !to) return { ...empty, error: 'Pick both dates.' }
  if (to < from) return { ...empty, error: 'The end date is before the start date.' }

  const span = eachDay(from, to)
  const holidaysInSpan: Array<{ date: string; name: string }> = []
  const workingDays: string[] = []
  let weekendDays = 0

  for (const iso of span) {
    if (holidays[iso]) {
      holidaysInSpan.push({ date: iso, name: holidays[iso] })
      continue
    }
    const day = dayOfWeek(iso)
    const weekend =
      (day === 6 && !pattern.saturday) || (day === 0 && !pattern.sunday)
    if (weekend) {
      weekendDays += 1
      continue
    }
    workingDays.push(iso)
  }

  const base = {
    ...empty,
    calendarDays: span.length,
    weekendDays,
    holidays: holidaysInSpan,
    workingDays,
  }

  if (workingDays.length === 0) {
    return {
      ...base,
      error: 'That range has no working days in it.',
    }
  }

  // Half days only bite when the boundary day is one being taken off; starting
  // on Saturday afternoon costs nothing extra if Saturday is not worked.
  const effectiveStart = allowHalfDays ? startAt : 'morning'
  const effectiveEnd = allowHalfDays ? endAt : 'end_of_day'
  const firstCounts = workingDays[0] === from
  const lastCounts = workingDays[workingDays.length - 1] === to

  if (
    from === to &&
    effectiveStart === 'afternoon' &&
    effectiveEnd === 'lunchtime'
  ) {
    return {
      ...base,
      error: 'A single day cannot start in the afternoon and end at lunchtime.',
    }
  }

  let halfDayAdjustment = 0
  if (effectiveStart === 'afternoon' && firstCounts) halfDayAdjustment += 0.5
  if (effectiveEnd === 'lunchtime' && lastCounts) halfDayAdjustment += 0.5

  return {
    ...base,
    halfDayAdjustment,
    days: workingDays.length - halfDayAdjustment,
  }
}

/** Human summary of the halves, e.g. 'afternoon → lunchtime'. */
export function halfDayLabel(startAt: StartAt, endAt: EndAt) {
  const start = startAt === 'morning' ? 'from the morning' : 'from the afternoon'
  const end = endAt === 'end_of_day' ? 'to end of day' : 'to lunchtime'
  return `${start} ${end}`
}

/** '2026-08-24' -> '24 Aug 2026'. */
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function formatLeaveDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]} ${y}`
}

/** Trims a float like 4.5 to '4.5' and 4.0 to '4'. */
export function formatDays(days: number) {
  return Number.isInteger(days) ? String(days) : days.toFixed(1)
}

// --- entitlement ------------------------------------------------------------

/**
 * A single employee's annual leave entitlement for a leave year.
 *
 * The previous calculation was `settings.leaveDays + settings.carryOver` for
 * every employee, which gave a part-timer, a mid-year joiner and a leaver the
 * same full-year allowance, and made carry-over an organisation-wide constant
 * rather than a per-person balance rolled forward from the prior year.
 *
 * Two adjustments apply, in order:
 *
 *   1. **Part-time pro-rating.** Entitlement scales with contracted hours
 *      against the organisation's full-time week. Someone on 22.5 of 37.5
 *      hours accrues 60% of the days.
 *   2. **Partial-year pro-rating.** Someone who joins or leaves mid-year
 *      accrues only for the part of the leave year they are employed.
 *
 * `annualLeaveDays` on the staff record overrides step 1 outright, for
 * contracts that state a figure explicitly. Carry-over is never pro-rated —
 * it was already earned.
 *
 * Results are rounded to the nearest half day, which is the smallest unit the
 * booking form can express.
 */
export function entitlementFor(
  staff: {
    joined: string
    endDate?: string | null
    weeklyHours?: number | null
    annualLeaveDays?: number | null
    carryOverDays?: number | null
  },
  leaveYear: { from: string; to: string },
  defaults: { leaveDays: number; fullTimeWeeklyHours: number }
): { entitlement: number; base: number; carryOver: number; proRataFactor: number } {
  const carryOver = staff.carryOverDays ?? 0

  const contracted = staff.weeklyHours ?? defaults.fullTimeWeeklyHours
  const partTimeFactor =
    staff.annualLeaveDays != null || defaults.fullTimeWeeklyHours <= 0
      ? 1
      : Math.min(1, contracted / defaults.fullTimeWeeklyHours)

  const base = (staff.annualLeaveDays ?? defaults.leaveDays) * partTimeFactor

  // The overlap between employment and the leave year.
  const startsAt = staff.joined > leaveYear.from ? staff.joined : leaveYear.from
  const endsAt =
    staff.endDate && staff.endDate < leaveYear.to ? staff.endDate : leaveYear.to

  const yearDays = daysInclusive(leaveYear.from, leaveYear.to)
  const employedDays = endsAt < startsAt ? 0 : daysInclusive(startsAt, endsAt)
  const proRataFactor = yearDays > 0 ? employedDays / yearDays : 0

  const entitlement = roundHalf(base * proRataFactor) + carryOver
  return { entitlement, base: roundHalf(base), carryOver, proRataFactor }
}

function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2
}
