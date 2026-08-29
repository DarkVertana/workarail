/**
 * Shared view-model types for the admin and crew screens.
 *
 * This module used to hold a parallel universe of mock rows — a fixed
 * `today = '2026-08-25'`, fourteen fake employees, and a `computePay` with
 * hardcoded tax rates. Components fell back to them whenever a prop was
 * missing, so a page that failed to load real data silently rendered
 * convincing fiction instead of an error.
 *
 * All of that is gone. What remains is types and pure formatting helpers.
 * The domain enums are re-exported from the generated Prisma client so the
 * UI, the validation layer and the database cannot drift apart.
 */

import type {
  ExpenseCategory as PrismaExpenseCategory,
  ExpenseMethod as PrismaExpenseMethod,
  ExpenseStatus as PrismaExpenseStatus,
  InvoiceStatus as PrismaInvoiceStatus,
  LeaveStatus as PrismaLeaveStatus,
  LeaveType as PrismaLeaveType,
  PayrollStatus as PrismaPayrollStatus,
  EmploymentStatus as PrismaEmploymentStatus,
  AttachmentKind as PrismaAttachmentKind,
} from '@/generated/prisma'

export type LeaveType = PrismaLeaveType
export type LeaveStatus = PrismaLeaveStatus
export type ExpenseCategory = PrismaExpenseCategory
export type ExpenseStatus = PrismaExpenseStatus
export type ExpenseMethod = PrismaExpenseMethod
export type InvoiceStatus = PrismaInvoiceStatus
export type PayrollStatus = PrismaPayrollStatus
export type EmploymentStatus = PrismaEmploymentStatus
export type AttachmentKind = PrismaAttachmentKind

/** Retained for the expense form, which still labels this "payment method". */
export type PaymentMethod = ExpenseMethod

/** Operational availability, hyphenated for display. */
export type StaffStatus = 'on-site' | 'available' | 'off-shift'

export type StaffMember = {
  /** Internal staff/payroll id — shown next to the name. */
  ref: string
  name: string
  email: string
  phone: string
  /** Job title, e.g. 'Signalling technician'. */
  role: string
  /** Which crew they are rostered to. Empty when unassigned. */
  crew: string
  /** Null when they are not currently assigned to a job. */
  currentJob: string | null
  status: StaffStatus
  /** Where they are in the employment lifecycle. */
  employmentStatus: EmploymentStatus
  hoursThisWeek: number
  /** Percent of contracted hours booked, 0–100. */
  utilization: number
  /** ISO date the person joined. */
  joined: string
  /** Birthday as MM-DD. No year — the celebration does not need an age. */
  birthday: string
}

/* --- Attendance -------------------------------------------------------- */

export type AttendanceCode = 'P' | 'H' | 'L' | 'A' | '-'

export const ATTENDANCE_CODES: AttendanceCode[] = ['P', 'H', 'L', 'A', '-']

export const ATTENDANCE_LABELS: Record<AttendanceCode, string> = {
  P: 'Present',
  H: 'Half day',
  L: 'Leave',
  A: 'Absent',
  '-': 'Not scheduled',
}

/**
 * Hours credited per code, for display.
 *
 * The authoritative figures used by payroll live in app/lib/payroll.ts; this
 * mirrors them for client components, which cannot import server-only code.
 */
export const attendanceHours: Record<AttendanceCode, number> = {
  P: 9,
  H: 4.5,
  L: 8,
  A: 0,
  '-': 0,
}

/* --- Leave ------------------------------------------------------------- */

export type LeaveRequest = {
  id: string
  /** Links to StaffMember.ref. */
  staffRef: string
  type: LeaveType
  /** Inclusive ISO range. */
  from: string
  to: string
  /** Working days requested, halves included. */
  days: number
  startAt?: 'morning' | 'afternoon'
  endAt?: 'lunchtime' | 'end_of_day'
  /** Whether these days come off the annual allowance. */
  deducts?: boolean
  reason: string
  status: LeaveStatus
  submitted: string
}

/* --- Attachments ------------------------------------------------------- */

export type Attachment = {
  name: string
  kind: AttachmentKind
  /** Pre-formatted for display. */
  size: string
  /**
   * Served through the authenticated file route. Null when the underlying
   * object is not retrievable — historical rows whose "URL" was a browser
   * blob or an inline data URL are reported this way rather than rendered
   * as a link.
   */
  url: string | null
  unavailable?: boolean
}

/* --- Invoices ---------------------------------------------------------- */

export type Invoice = {
  id: string
  client: string
  reference: string
  /** Gross, in minor units (pence). */
  amountPence: number
  netPence: number
  vatPence: number
  /** Sum of recorded payments. */
  paidPence: number
  /** amountPence - paidPence. */
  balancePence: number
  issued: string
  due: string
  /** Derived from payments and dates, never chosen directly. */
  status: InvoiceStatus
  document: Attachment | null
  proof: Attachment | null
}

/* --- Expenses ---------------------------------------------------------- */

export type Expense = {
  id: string
  date: string
  category: ExpenseCategory
  merchant: string
  description: string
  /** Minor units (pence), so totals never hit float rounding. */
  amountPence: number
  /** Who spent it — links to StaffMember.ref. */
  staffRef: string
  method: ExpenseMethod
  status: ExpenseStatus
  receipt: Attachment | null
}

/* --- Payroll ----------------------------------------------------------- */

export type PayrollRecord = {
  staffRef: string
  /** All figures in pence, so nothing rounds twice. */
  grossPence: number
  taxPence: number
  niPence: number
  pensionPence: number
  netPence: number
  status: PayrollStatus
  paidOn: string | null
  reference: string
  /** How many adjustments contributed to this figure. */
  adjustmentCount?: number
}

/* --- Finance analytics ------------------------------------------------- */

export type MonthPoint = {
  /** 'YYYY-MM'. */
  month: string
  label: string
  /** Invoiced revenue, in pence. */
  earnedPence: number
  /** Payroll plus expenses, in pence. */
  spentPence: number
}

/* --- Dashboard --------------------------------------------------------- */

export type Trend = 'up' | 'down' | 'flat'

export type Stat = {
  label: string
  value: string
  delta: string
  trend: Trend
  /** Whether `trend` is a good outcome for this metric. */
  positive: boolean
  hint: string
}

export type DayHours = {
  /** Axis label. */
  day: string
  /** Full date for the tooltip. */
  date: string
  /** Hours from whole days worked. */
  full: number
  /** Hours from half days. */
  half: number
}

export type ActivityKind = 'leave' | 'expense' | 'invoice'

export type ActivityRow = {
  ref: string
  title: string
  who: string
  amount: string
  kind: ActivityKind
  status: string
  date: string
}

/* --- Formatting -------------------------------------------------------- */

/**
 * Pence to '£12,480.00'. Kept in minor units until the last moment.
 * Negatives are formatted from the absolute value — taking the remainder of a
 * negative gives a negative too, which produced '£-32,277.-60'.
 */
export function formatMoney(pence: number) {
  const negative = pence < 0
  const abs = Math.abs(pence)
  const whole = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${negative ? '−' : ''}£${whole.toLocaleString('en-GB')}.${cents}`
}

/** Today as an ISO date string, in UTC to match how dates are stored. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
