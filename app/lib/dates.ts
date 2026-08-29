/**
 * Business dates, in one place.
 *
 * The application deals with two different kinds of time and previously
 * conflated them:
 *
 *   - **Business dates** (a leave day, an attendance day, an invoice due date,
 *     a pay period) have no time component. They are stored as UTC midnight
 *     and compared as `YYYY-MM-DD` strings.
 *   - **Instants** (submittedAt, decidedAt) are real timestamps.
 *
 * The bug this module fixes: "today" was derived with `new Date()` and
 * `getUTCMonth()`/`getUTCDate()`. The business operates in Europe/London, so
 * for the hour after midnight during British Summer Time the UTC date is still
 * *yesterday*. That produced a family of off-by-one-day failures:
 *
 *   - an expense legitimately dated today was rejected as "in the future"
 *   - the whole dashboard reported the previous month between 00:00 and 01:00
 *     on the 1st, and `PayrollRecord.reference` was built for the wrong period
 *   - attendance recorded late on a Friday evening in BST landed on Saturday's
 *     row, and `@@unique([staffRef, date])` then wrote to the wrong record
 *   - leave self-cancellation opened and closed an hour early or late
 *
 * Everything that asks "what day is it for the business?" must come through
 * `businessToday()`, never `new Date()`.
 *
 * Helper copies previously existed in `app/actions/admin.ts`,
 * `app/actions/crew.ts` and `app/lib/leave.ts`. This module replaces all three.
 */

/** The organisation's operating timezone. */
export const BUSINESS_TIMEZONE = 'Europe/London'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The calendar date at the given instant *in the business timezone*.
 * `en-CA` formats as `YYYY-MM-DD`, which is what we want to compare on.
 */
export function toBusinessDate(instant: Date = new Date()): string {
  return formatter.format(instant)
}

/** Today's business date as `YYYY-MM-DD`. */
export function businessToday(): string {
  return toBusinessDate()
}

/**
 * The UTC-midnight timestamp a business date is stored as.
 * `utcDate('2026-08-29')` is the value written to a date-only column.
 */
export function utcDate(iso: string): Date {
  if (!ISO_DATE.test(iso)) {
    throw new Error(`Not a business date: ${iso}`)
  }
  return new Date(`${iso}T00:00:00.000Z`)
}

/** Reads a stored date-only column back as a business date string. */
export function fromStoredDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `iso` shifted by whole days, still a business date. */
export function addDays(iso: string, days: number): string {
  return fromStoredDate(new Date(utcDate(iso).getTime() + days * 86_400_000))
}

/** Whole days from `a` to `b`, inclusive of both ends. */
export function daysBetweenInclusive(a: string, b: string): number {
  return Math.round((utcDate(b).getTime() - utcDate(a).getTime()) / 86_400_000) + 1
}

/** Every business date from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** 0 = Sunday … 6 = Saturday, for a business date. */
export function dayOfWeek(iso: string): number {
  return utcDate(iso).getUTCDay()
}

export function isWeekend(iso: string): boolean {
  const d = dayOfWeek(iso)
  return d === 0 || d === 6
}

/** The Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const day = dayOfWeek(iso)
  return addDays(iso, day === 0 ? -6 : 1 - day)
}

/** The seven business dates of the week containing `iso`, Monday first. */
export function weekDays(iso: string): string[] {
  const monday = startOfWeek(iso)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/**
 * A Prisma range filter covering whole business days.
 *
 * Date-only columns hold an exact UTC-midnight timestamp, so an inclusive
 * range must run to the start of the day *after* `to` rather than matching
 * `to`'s midnight.
 */
export function dayRange(fromIso: string, toIso: string) {
  return { gte: utcDate(fromIso), lt: utcDate(addDays(toIso, 1)) }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export type Period = { year: number; month: number; label: string }

/** The calendar month a business date falls in. */
export function periodOf(iso: string): Period {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return { year, month, label: `${MONTHS[month - 1]} ${year}` }
}

/** The current pay period, in business time. */
export function currentPeriod(): Period {
  return periodOf(businessToday())
}

export function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/** First and last business dates of a calendar month. */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from, to: `${year}-${String(month).padStart(2, '0')}-${lastDay}` }
}

/** The previous calendar month. */
export function previousPeriod(year: number, month: number): Period {
  const m = month === 1 ? 12 : month - 1
  const y = month === 1 ? year - 1 : year
  return { year: y, month: m, label: periodLabel(y, m) }
}

/**
 * The UK tax year containing a business date, as the year it starts in.
 * The UK tax year runs 6 April to 5 April, which is what payslip
 * year-to-date figures must accumulate over — not the calendar year.
 */
export function taxYearOf(iso: string): number {
  const year = Number(iso.slice(0, 4))
  return iso >= `${year}-04-06` ? year : year - 1
}

/** First and last business dates of the UK tax year starting in `startYear`. */
export function taxYearBounds(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` }
}

/**
 * The leave year a business date falls in, given the configured start.
 *
 * `startMonth`/`startDay` default to 1 January. Returns the year the leave
 * year *starts* in, which is what `LeaveRequest.leaveYear` stores. A request
 * spanning 31 December to 2 January therefore belongs wholly to the leave year
 * its first day falls in, and the balance check must use the same value —
 * previously the balance was checked against the current calendar year while
 * the row was filed under the year taken from the `from` date, which let an
 * employee book all of next year's allowance in December unchecked.
 */
export function leaveYearOf(iso: string, startMonth = 1, startDay = 1): number {
  const year = Number(iso.slice(0, 4))
  const boundary = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`
  return iso >= boundary ? year : year - 1
}

/** First and last business dates of a leave year. */
export function leaveYearBounds(
  startYear: number,
  startMonth = 1,
  startDay = 1
): { from: string; to: string } {
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`
  return { from, to: addDays(`${startYear + 1}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`, -1) }
}
