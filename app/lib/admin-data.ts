export type StaffStatus = 'on-site' | 'available' | 'off-shift'

export type StaffMember = {
  /** Your internal staff/payroll id — shown next to the name. */
  ref: string
  name: string
  /** Work email address. */
  email: string
  /** Work contact number. */
  phone: string
  /** Job title, e.g. 'Signalling technician'. */
  role: string
  /** Which crew they are rostered to. */
  crew: string
  /** Null when they are not currently assigned to a job. */
  currentJob: string | null
  status: StaffStatus
  hoursThisWeek: number
  /** Percent of scheduled hours booked to a job, 0–100. */
  utilization: number
  /** ISO date the person joined, e.g. '2023-03-12'. */
  joined: string
  /** Birthday as MM-DD. No year — the celebration doesn't need an age. */
  birthday: string
}

/* --- Attendance -------------------------------------------------------- */

export type AttendanceCode = 'P' | 'H' | 'L' | 'A' | '-'

/** Hours credited per code. */
export const attendanceHours: Record<AttendanceCode, number> = {
  P: 8,
  H: 4,
  L: 0,
  A: 0,
  '-': 0,
}

/* --- Leave ------------------------------------------------------------- */

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'parental' | 'compassionate'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

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
  /** Which half of the first day it starts in. */
  startAt?: 'morning' | 'afternoon'
  /** Which half of the last day it runs to. */
  endAt?: 'lunchtime' | 'end_of_day'
  /** Whether these days come off the annual allowance. */
  deducts?: boolean
  reason: string
  status: LeaveStatus
  submitted: string
}

/* --- Invoices ---------------------------------------------------------- */

export type InvoiceStatus = 'paid' | 'pending' | 'overdue' | 'draft'
export type AttachmentKind = 'pdf' | 'image'

export type Attachment = {
  name: string
  kind: AttachmentKind
  /** Pre-formatted for display; real uploads would store bytes. */
  size: string
  /** Served from /public. Swap for your storage URLs. */
  url: string
}

/**
 * Exactly one file per invoice — the upload step is either/or: you attach the
 * invoice document or the payment proof. The union makes that a compile-time
 * rule, so neither "both" nor "neither" can slip through.
 */
export type InvoiceFiles =
  | { document: Attachment; proof: null }
  | { document: null; proof: Attachment }

export type Invoice = {
  id: string
  client: string
  reference: string
  /** Minor units (pence), so totals never hit float rounding. */
  amountPence: number
  issued: string
  due: string
  status: InvoiceStatus
} & InvoiceFiles

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

/* --- Expenses ---------------------------------------------------------- */

export type ExpenseCategory =
  | 'travel'
  | 'materials'
  | 'equipment'
  | 'meals'
  | 'training'
  | 'other'

export type ExpenseStatus = 'submitted' | 'approved' | 'reimbursed' | 'rejected'
export type PaymentMethod = 'company-card' | 'personal' | 'cash'

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
  method: PaymentMethod
  status: ExpenseStatus
  /** Receipt image or PDF. Null when nothing was attached. */
  receipt: Attachment | null
}

/* --- Payroll ----------------------------------------------------------- */

export type PayrollStatus = 'paid' | 'pending'

export type PayrollRecord = {
  /** Links to StaffMember.ref. */
  staffRef: string
  /** All figures in pence, so nothing rounds twice. */
  grossPence: number
  taxPence: number
  niPence: number
  pensionPence: number
  /** gross - tax - ni - pension. Stored so a payslip can never disagree. */
  netPence: number
  status: PayrollStatus
  paidOn: string | null
  reference: string
}

/** Monthly personal allowance, in pence. */
export const PAY_ALLOWANCE_PENCE = 104750

/**
 * The single source of truth for deductions.
 */
export function computePay(grossPence: number) {
  const taxable = Math.max(0, grossPence - PAY_ALLOWANCE_PENCE)
  const taxPence = Math.round(taxable * 0.2)
  const niPence = Math.round(taxable * 0.08)
  const pensionPence = Math.round(grossPence * 0.05)
  return {
    taxPence,
    niPence,
    pensionPence,
    netPence: grossPence - taxPence - niPence - pensionPence,
  }
}

export type MonthPoint = {
  /** 'YYYY-MM'. */
  month: string
  label: string
  /** Invoiced revenue, in pence. */
  earnedPence: number
  /** Payroll plus expenses, in pence. */
  spentPence: number
}

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

/** Annual entitlement, mirroring the Settings default. */
export const ANNUAL_LEAVE_DAYS = 28
