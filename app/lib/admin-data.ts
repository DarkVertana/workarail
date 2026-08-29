// Placeholder data for the admin dashboard. Swap these for real queries — the
// shapes below are what the UI components expect.
//
// Dates are hardcoded rather than derived from `new Date()` on purpose: the page
// is statically prerendered, so a value computed at render time could differ
// between the server and client and trip a hydration mismatch.

export const today = '2026-08-25'

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

/**
 * Demo staff. Replace these rows with your company's people — the tables,
 * pagination and counts all read from this one array.
 */
export const staff: StaffMember[] = [
  { ref: 'EMP-001', name: 'Jordan Vale', email: 'jordan.vale@workarail.com', phone: '+44 7700 900142', role: 'Crew lead', crew: 'Crew A', currentJob: 'WR-1042 · Platform 3 resurfacing', status: 'on-site', hoursThisWeek: 42, utilization: 94, joined: '2023-03-12', birthday: '08-25' },
  { ref: 'EMP-002', name: 'Priya Raman', email: 'priya.raman@workarail.com', phone: '+44 7700 900218', role: 'Track operative', crew: 'Crew A', currentJob: 'WR-1042 · Platform 3 resurfacing', status: 'on-site', hoursThisWeek: 40, utilization: 90, joined: '2024-07-01', birthday: '11-03' },
  { ref: 'EMP-003', name: 'Marcus Bell', email: 'marcus.bell@workarail.com', phone: '+44 7700 900367', role: 'Plant operator', crew: 'Crew A', currentJob: 'WR-1042 · Platform 3 resurfacing', status: 'on-site', hoursThisWeek: 38, utilization: 86, joined: '2022-11-19', birthday: '08-27' },
  { ref: 'EMP-004', name: 'Sofia Ferraro', email: 'sofia.ferraro@workarail.com', phone: '+44 7700 900405', role: 'Signalling technician', crew: 'Crew D', currentJob: 'WR-1041 · Signal box rewire', status: 'on-site', hoursThisWeek: 44, utilization: 96, joined: '2021-05-04', birthday: '01-19' },
  { ref: 'EMP-005', name: 'Daniel Okafor', email: 'daniel.okafor@workarail.com', phone: '+44 7700 900533', role: 'Crew lead', crew: 'Crew D', currentJob: 'WR-1041 · Signal box rewire', status: 'on-site', hoursThisWeek: 41, utilization: 92, joined: '2023-09-27', birthday: '09-02' },
  { ref: 'EMP-006', name: 'Anya Kowalski', email: 'anya.kowalski@workarail.com', phone: '+44 7700 900671', role: 'Electrician', crew: 'Crew B', currentJob: 'WR-1038 · Depot lighting retrofit', status: 'on-site', hoursThisWeek: 39, utilization: 88, joined: '2025-01-15', birthday: '08-30' },
  { ref: 'EMP-007', name: 'Tomas Lindberg', email: 'tomas.lindberg@workarail.com', phone: '+44 7700 900709', role: 'Electrician', crew: 'Crew B', currentJob: 'WR-1038 · Depot lighting retrofit', status: 'on-site', hoursThisWeek: 36, utilization: 82, joined: '2024-02-08', birthday: '04-11' },
  { ref: 'EMP-008', name: 'Rachel Nkemdirim', email: 'rachel.nkemdirim@workarail.com', phone: '+44 7700 900824', role: 'Crew lead', crew: 'Crew B', currentJob: 'WR-1038 · Depot lighting retrofit', status: 'on-site', hoursThisWeek: 43, utilization: 93, joined: '2020-08-30', birthday: '12-24' },
  { ref: 'EMP-009', name: 'Hugo Marchetti', email: 'hugo.marchetti@workarail.com', phone: '+44 7700 900950', role: 'Site inspector', crew: 'Crew C', currentJob: 'WR-1035 · Culvert inspection', status: 'on-site', hoursThisWeek: 34, utilization: 76, joined: '2026-08-03', birthday: '02-08' },
  { ref: 'EMP-010', name: 'Lena Fischer', email: 'lena.fischer@workarail.com', phone: '+44 7700 900063', role: 'Track operative', crew: 'Crew C', currentJob: 'WR-1035 · Culvert inspection', status: 'on-site', hoursThisWeek: 37, utilization: 84, joined: '2026-07-14', birthday: '09-15' },
  { ref: 'EMP-011', name: 'Owen Brady', email: 'owen.brady@workarail.com', phone: '+44 7700 900187', role: 'Welder', crew: 'Crew E', currentJob: null, status: 'available', hoursThisWeek: 22, utilization: 48, joined: '2026-08-19', birthday: '06-30' },
  { ref: 'EMP-012', name: 'Nadia Haddad', email: 'nadia.haddad@workarail.com', phone: '+44 7700 900246', role: 'Overhead line engineer', crew: 'Crew E', currentJob: null, status: 'available', hoursThisWeek: 18, utilization: 40, joined: '2025-06-22', birthday: '08-26' },
  { ref: 'EMP-013', name: 'Felix Mwangi', email: 'felix.mwangi@workarail.com', phone: '+44 7700 900392', role: 'Machine operator', crew: 'Crew C', currentJob: null, status: 'available', hoursThisWeek: 26, utilization: 55, joined: '2026-06-01', birthday: '10-05' },
  { ref: 'EMP-014', name: 'Clara Jensen', email: 'clara.jensen@workarail.com', phone: '+44 7700 900478', role: 'Ganger', crew: 'Crew A', currentJob: null, status: 'off-shift', hoursThisWeek: 0, utilization: 0, joined: '2019-04-16', birthday: '03-22' },
]

/* --- Attendance -------------------------------------------------------- */

export type AttendanceCode = 'P' | 'H' | 'L' | 'A' | '-'

/** The demo week (Mon–Sun) containing `today`. Fixed, like `today` itself. */
export const attendanceWeek = [
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
  '2026-08-30',
]

/**
 * One 7-character pattern per person, Mon–Sun:
 *   P present · H half day · L leave · A absent · - non-working
 *
 * Editing a row here is the whole edit — the grid, the totals and the
 * day-summary counts all read from it.
 */
export const attendancePatterns: Record<string, string> = {
  'EMP-001': 'PPPPP--',
  'EMP-002': 'PPPPP--',
  'EMP-003': 'PHPPP--',
  'EMP-004': 'PPPPP--',
  'EMP-005': 'PPLLL--',
  'EMP-006': 'PPPPP--',
  'EMP-007': 'PAPPP--',
  'EMP-008': 'PPPPH--',
  'EMP-009': 'PPPPP--',
  'EMP-010': 'LLPPP--',
  'EMP-011': 'PPPPP--',
  'EMP-012': 'PPPAP--',
  'EMP-013': 'HPPPP--',
  'EMP-014': '-------',
}

/** Hours credited per code. */
export const attendanceHours: Record<AttendanceCode, number> = {
  P: 8,
  H: 4,
  L: 0,
  A: 0,
  '-': 0,
}

export function attendanceFor(ref: string): AttendanceCode[] {
  const pattern = attendancePatterns[ref] ?? '-------'
  return pattern.split('') as AttendanceCode[]
}

export function weekHours(ref: string) {
  return attendanceFor(ref).reduce((n, c) => n + attendanceHours[c], 0)
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

export const leaveRequests: LeaveRequest[] = [
  { id: 'LV-1052', staffRef: 'EMP-005', type: 'annual', from: '2026-08-26', to: '2026-08-28', days: 3, reason: 'Family holiday', status: 'pending', submitted: '2026-08-18' },
  { id: 'LV-1051', staffRef: 'EMP-010', type: 'sick', from: '2026-08-24', to: '2026-08-25', days: 2, reason: 'Flu', status: 'approved', submitted: '2026-08-24' },
  { id: 'LV-1050', staffRef: 'EMP-012', type: 'annual', from: '2026-09-07', to: '2026-09-11', days: 5, reason: 'Trip abroad', status: 'pending', submitted: '2026-08-20' },
  { id: 'LV-1049', staffRef: 'EMP-002', type: 'parental', from: '2026-09-14', to: '2026-10-09', days: 20, reason: 'Parental leave', status: 'pending', submitted: '2026-08-11' },
  { id: 'LV-1048', staffRef: 'EMP-007', type: 'unpaid', from: '2026-08-25', to: '2026-08-25', days: 1, reason: 'Personal matter', status: 'approved', submitted: '2026-08-21' },
  { id: 'LV-1047', staffRef: 'EMP-014', type: 'annual', from: '2026-08-24', to: '2026-08-30', days: 5, reason: 'Annual leave', status: 'approved', submitted: '2026-08-03' },
  { id: 'LV-1046', staffRef: 'EMP-009', type: 'compassionate', from: '2026-08-31', to: '2026-09-02', days: 3, reason: 'Bereavement', status: 'pending', submitted: '2026-08-22' },
  { id: 'LV-1045', staffRef: 'EMP-003', type: 'sick', from: '2026-08-19', to: '2026-08-19', days: 1, reason: 'Medical appointment', status: 'approved', submitted: '2026-08-17' },
  { id: 'LV-1044', staffRef: 'EMP-011', type: 'annual', from: '2026-08-10', to: '2026-08-14', days: 5, reason: 'Summer break', status: 'approved', submitted: '2026-07-24' },
  { id: 'LV-1043', staffRef: 'EMP-006', type: 'unpaid', from: '2026-09-21', to: '2026-09-25', days: 5, reason: 'Extended travel', status: 'rejected', submitted: '2026-08-09' },
  { id: 'LV-1042', staffRef: 'EMP-013', type: 'annual', from: '2026-08-03', to: '2026-08-07', days: 5, reason: 'Annual leave', status: 'approved', submitted: '2026-07-15' },
  { id: 'LV-1041', staffRef: 'EMP-004', type: 'sick', from: '2026-07-29', to: '2026-07-31', days: 3, reason: 'Recovery', status: 'rejected', submitted: '2026-07-28' },
]

/** Approved leave covering `today`. */
export function onLeaveToday() {
  return leaveRequests.filter(
    (r) => r.status === 'approved' && r.from <= today && r.to >= today
  ).length
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

const PDF = (name: string, size: string): Attachment => ({
  name,
  kind: 'pdf',
  size,
  url: '/samples/invoice-sample.pdf',
})

const PROOF_IMG = (name: string, size: string): Attachment => ({
  name,
  kind: 'image',
  size,
  url: '/samples/proof-sample.svg',
})

const PROOF_PDF = (name: string, size: string): Attachment => ({
  name,
  kind: 'pdf',
  size,
  url: '/samples/invoice-sample.pdf',
})

export const invoices: Invoice[] = [
  { id: 'WR-2041', client: 'Northline Transit', reference: 'Contract staffing, August', amountPence: 1248000, issued: '2026-08-03', due: '2026-09-02', status: 'paid', document: null, proof: PROOF_IMG('receipt-fp-8841.svg', '212 KB') },
  { id: 'WR-2040', client: 'Vale Freight', reference: 'Depot electrical works', amountPence: 736550, issued: '2026-08-06', due: '2026-09-05', status: 'pending', document: PDF('WR-2040.pdf', '77 KB'), proof: null },
  { id: 'WR-2039', client: 'Harbour Rail', reference: 'Crew supply, July', amountPence: 2104000, issued: '2026-07-01', due: '2026-07-31', status: 'overdue', document: PDF('WR-2039.pdf', '91 KB'), proof: null },
  { id: 'WR-2038', client: 'Northline Transit', reference: 'Signalling maintenance', amountPence: 458000, issued: '2026-07-14', due: '2026-08-13', status: 'paid', document: null, proof: PROOF_PDF('remittance-2038.pdf', '46 KB') },
  { id: 'WR-2037', client: 'Meridian Works', reference: 'Overtime, July', amountPence: 189900, issued: '2026-07-20', due: '2026-08-19', status: 'overdue', document: PDF('WR-2037.pdf', '52 KB'), proof: null },
  { id: 'WR-2036', client: 'Vale Freight', reference: 'Culvert survey', amountPence: 312400, issued: '2026-08-11', due: '2026-09-10', status: 'pending', document: PDF('WR-2036.pdf', '61 KB'), proof: null },
  { id: 'WR-2035', client: 'Harbour Rail', reference: 'Ballast regulation', amountPence: 1587500, issued: '2026-06-22', due: '2026-07-22', status: 'paid', document: null, proof: PROOF_IMG('receipt-fp-8702.svg', '198 KB') },
  { id: 'WR-2034', client: 'Meridian Works', reference: 'Site inspection retainer', amountPence: 96000, issued: '2026-08-18', due: '2026-09-17', status: 'draft', document: PDF('WR-2034-draft.pdf', '39 KB'), proof: null },
  { id: 'WR-2033', client: 'Northline Transit', reference: 'Platform resurfacing', amountPence: 3402000, issued: '2026-06-08', due: '2026-07-08', status: 'paid', document: null, proof: PROOF_PDF('remittance-2033.pdf', '51 KB') },
  { id: 'WR-2032', client: 'Vale Freight', reference: 'Welding crew, June', amountPence: 874200, issued: '2026-06-15', due: '2026-07-15', status: 'paid', document: null, proof: PROOF_IMG('receipt-fp-8655.svg', '205 KB') },
  { id: 'WR-2031', client: 'Harbour Rail', reference: 'Emergency callout', amountPence: 241800, issued: '2026-08-21', due: '2026-09-20', status: 'pending', document: PDF('WR-2031.pdf', '44 KB'), proof: null },
  { id: 'WR-2030', client: 'Meridian Works', reference: 'Annual framework fee', amountPence: 5000000, issued: '2026-08-24', due: '2026-09-23', status: 'draft', document: PDF('WR-2030-draft.pdf', '58 KB'), proof: null },
]

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

const RECEIPT_IMG = (name: string, size: string): Attachment => ({
  name,
  kind: 'image',
  size,
  url: '/samples/proof-sample.svg',
})

const RECEIPT_PDF = (name: string, size: string): Attachment => ({
  name,
  kind: 'pdf',
  size,
  url: '/samples/invoice-sample.pdf',
})

export const expenses: Expense[] = [
  { id: 'EX-4021', date: '2026-08-24', category: 'travel', merchant: 'Northern Rail', description: 'Return fare to Vale depot', amountPence: 8640, staffRef: 'EMP-004', method: 'personal', status: 'submitted', receipt: RECEIPT_IMG('rail-ticket.svg', '96 KB') },
  { id: 'EX-4020', date: '2026-08-23', category: 'materials', merchant: 'Buildbase', description: 'Ballast bags and fixings', amountPence: 42750, staffRef: 'EMP-001', method: 'company-card', status: 'approved', receipt: RECEIPT_PDF('buildbase-inv.pdf', '58 KB') },
  { id: 'EX-4019', date: '2026-08-22', category: 'meals', merchant: 'The Sidings Cafe', description: 'Crew lunch, night shift', amountPence: 5320, staffRef: 'EMP-008', method: 'personal', status: 'reimbursed', receipt: RECEIPT_IMG('cafe-receipt.svg', '74 KB') },
  { id: 'EX-4018', date: '2026-08-21', category: 'equipment', merchant: 'SafetyFirst Ltd', description: 'Replacement hi-vis and helmets', amountPence: 118900, staffRef: 'EMP-005', method: 'company-card', status: 'approved', receipt: RECEIPT_PDF('safetyfirst.pdf', '63 KB') },
  { id: 'EX-4017', date: '2026-08-20', category: 'training', merchant: 'RailSkills Academy', description: 'Signalling refresher, 2 places', amountPence: 96000, staffRef: 'EMP-002', method: 'company-card', status: 'submitted', receipt: RECEIPT_PDF('railskills.pdf', '71 KB') },
  { id: 'EX-4016', date: '2026-08-19', category: 'travel', merchant: 'City Cabs', description: 'Late callout transport', amountPence: 3450, staffRef: 'EMP-011', method: 'cash', status: 'rejected', receipt: null },
  { id: 'EX-4015', date: '2026-08-18', category: 'materials', merchant: 'Trackform Supplies', description: 'Rail clips, box of 200', amountPence: 27600, staffRef: 'EMP-006', method: 'company-card', status: 'reimbursed', receipt: RECEIPT_PDF('trackform.pdf', '49 KB') },
  { id: 'EX-4014', date: '2026-08-17', category: 'equipment', merchant: 'ToolHire Direct', description: 'Tamping machine hire, 3 days', amountPence: 214000, staffRef: 'EMP-003', method: 'company-card', status: 'approved', receipt: RECEIPT_PDF('toolhire.pdf', '55 KB') },
  { id: 'EX-4013', date: '2026-08-14', category: 'meals', merchant: 'Greggs', description: 'Early start breakfast, crew B', amountPence: 2880, staffRef: 'EMP-007', method: 'personal', status: 'submitted', receipt: RECEIPT_IMG('greggs.svg', '61 KB') },
  { id: 'EX-4012', date: '2026-08-12', category: 'other', merchant: 'Royal Mail', description: 'Certified document postage', amountPence: 1240, staffRef: 'EMP-010', method: 'personal', status: 'reimbursed', receipt: RECEIPT_IMG('postage.svg', '38 KB') },
  { id: 'EX-4011', date: '2026-08-10', category: 'travel', merchant: 'Shell', description: 'Fuel, site van', amountPence: 9180, staffRef: 'EMP-009', method: 'company-card', status: 'approved', receipt: RECEIPT_IMG('fuel.svg', '82 KB') },
  { id: 'EX-4010', date: '2026-08-07', category: 'training', merchant: 'First Aid Works', description: 'First aid certification', amountPence: 34500, staffRef: 'EMP-013', method: 'personal', status: 'reimbursed', receipt: RECEIPT_PDF('firstaid.pdf', '44 KB') },
  { id: 'EX-4009', date: '2026-08-05', category: 'materials', merchant: 'Buildbase', description: 'Drainage pipe, 12m', amountPence: 61400, staffRef: 'EMP-012', method: 'company-card', status: 'approved', receipt: RECEIPT_PDF('buildbase-2.pdf', '52 KB') },
  { id: 'EX-4008', date: '2026-08-03', category: 'other', merchant: 'Parkway NCP', description: 'Site parking, week', amountPence: 4200, staffRef: 'EMP-014', method: 'personal', status: 'rejected', receipt: null },
]

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
 * The single source of truth for deductions. The seeded rows were generated
 * with exactly this formula, so an adjusted row can never use different maths
 * from the rest of the run.
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

/** The period this run covers. */
export const payPeriod = { year: 2026, month: 8, label: 'August 2026' }

export const payrollRuns: PayrollRecord[] = [
  { staffRef: 'EMP-001', grossPence: 421000, taxPence: 63250, niPence: 25300, pensionPence: 21050, netPence: 311400, status: 'paid', paidOn: '2026-08-25', reference: 'PS-001-202608' },
  { staffRef: 'EMP-002', grossPence: 315000, taxPence: 42050, niPence: 16820, pensionPence: 15750, netPence: 240380, status: 'paid', paidOn: '2026-08-25', reference: 'PS-002-202608' },
  { staffRef: 'EMP-003', grossPence: 340000, taxPence: 47050, niPence: 18820, pensionPence: 17000, netPence: 257130, status: 'paid', paidOn: '2026-08-25', reference: 'PS-003-202608' },
  { staffRef: 'EMP-004', grossPence: 396000, taxPence: 58250, niPence: 23300, pensionPence: 19800, netPence: 294650, status: 'paid', paidOn: '2026-08-25', reference: 'PS-004-202608' },
  { staffRef: 'EMP-005', grossPence: 421000, taxPence: 63250, niPence: 25300, pensionPence: 21050, netPence: 311400, status: 'paid', paidOn: '2026-08-25', reference: 'PS-005-202608' },
  { staffRef: 'EMP-006', grossPence: 375000, taxPence: 54050, niPence: 21620, pensionPence: 18750, netPence: 280580, status: 'paid', paidOn: '2026-08-25', reference: 'PS-006-202608' },
  { staffRef: 'EMP-007', grossPence: 375000, taxPence: 54050, niPence: 21620, pensionPence: 18750, netPence: 280580, status: 'paid', paidOn: '2026-08-25', reference: 'PS-007-202608' },
  { staffRef: 'EMP-008', grossPence: 421000, taxPence: 63250, niPence: 25300, pensionPence: 21050, netPence: 311400, status: 'paid', paidOn: '2026-08-25', reference: 'PS-008-202608' },
  { staffRef: 'EMP-009', grossPence: 362000, taxPence: 51450, niPence: 20580, pensionPence: 18100, netPence: 271870, status: 'paid', paidOn: '2026-08-25', reference: 'PS-009-202608' },
  { staffRef: 'EMP-010', grossPence: 315000, taxPence: 42050, niPence: 16820, pensionPence: 15750, netPence: 240380, status: 'paid', paidOn: '2026-08-25', reference: 'PS-010-202608' },
  { staffRef: 'EMP-011', grossPence: 358000, taxPence: 50650, niPence: 20260, pensionPence: 17900, netPence: 269190, status: 'paid', paidOn: '2026-08-25', reference: 'PS-011-202608' },
  { staffRef: 'EMP-012', grossPence: 408000, taxPence: 60650, niPence: 24260, pensionPence: 20400, netPence: 302690, status: 'pending', paidOn: null, reference: 'PS-012-202608' },
  { staffRef: 'EMP-013', grossPence: 332000, taxPence: 45450, niPence: 18180, pensionPence: 16600, netPence: 251770, status: 'pending', paidOn: null, reference: 'PS-013-202608' },
  { staffRef: 'EMP-014', grossPence: 305000, taxPence: 40050, niPence: 16020, pensionPence: 15250, netPence: 233680, status: 'pending', paidOn: null, reference: 'PS-014-202608' },
]

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

/**
 * Six months of company earnings and spend. The latest month is derived from
 * the live invoice, expense and payroll data below, so the chart agrees with
 * the tables; earlier months are seeded history.
 */
export const financeHistory: MonthPoint[] = [
  { month: '2026-03', label: 'Mar', earnedPence: 4180000, spentPence: 3610000 },
  { month: '2026-04', label: 'Apr', earnedPence: 3925000, spentPence: 3740000 },
  { month: '2026-05', label: 'May', earnedPence: 4760000, spentPence: 3880000 },
  { month: '2026-06', label: 'Jun', earnedPence: 5863700, spentPence: 4102000 },
  { month: '2026-07', label: 'Jul', earnedPence: 4751900, spentPence: 4295000 },
]

/** Revenue invoiced in a given 'YYYY-MM', excluding drafts. */
export function invoicedIn(month: string) {
  return invoices
    .filter((i) => i.status !== 'draft' && i.issued.slice(0, 7) === month)
    .reduce((n, i) => n + i.amountPence, 0)
}

/** Expenses claimed in a given month, excluding rejected claims. */
export function spentIn(month: string) {
  return expenses
    .filter((e) => e.status !== 'rejected' && e.date.slice(0, 7) === month)
    .reduce((n, e) => n + e.amountPence, 0)
}

/** Total payroll cost for the current run. */
export function payrollCost() {
  return payrollRuns.reduce((n, r) => n + r.grossPence, 0)
}

/** History plus the current month, built from the live tables. */
export function monthlyFinance(): MonthPoint[] {
  const current = `${payPeriod.year}-${String(payPeriod.month).padStart(2, '0')}`
  return [
    ...financeHistory,
    {
      month: current,
      label: 'Aug',
      earnedPence: invoicedIn(current),
      spentPence: spentIn(current) + payrollCost(),
    },
  ]
}

/* --- Dashboard ---------------------------------------------------------- */

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

/** The tiles, computed from the same tables the other pages render. */
export function dashboardStats(): Stat[] {
  const todayIndex = attendanceWeek.indexOf(today)
  const codes = staff.map((p) => attendanceFor(p.ref)[todayIndex])
  const inToday = codes.filter((c) => c === 'P' || c === 'H').length
  const away = codes.filter((c) => c === 'L' || c === 'A').length

  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending').length
  const pendingExpenses = expenses.filter((e) => e.status === 'submitted').length
  const netPay = payrollRuns.reduce((n, r) => n + r.netPence, 0)

  return [
    {
      label: 'Headcount',
      value: String(staff.length),
      delta: '+2',
      trend: 'up',
      positive: true,
      hint: 'vs last month',
    },
    {
      label: 'In today',
      value: String(inToday),
      delta: String(away),
      trend: away === 0 ? 'flat' : 'down',
      positive: away === 0,
      hint: away === 1 ? 'person away' : 'people away',
    },
    {
      label: 'Awaiting approval',
      value: String(pendingLeave + pendingExpenses),
      delta: String(pendingLeave),
      trend: 'flat',
      positive: pendingLeave + pendingExpenses === 0,
      hint: 'leave requests',
    },
    {
      label: 'Net payroll',
      value: formatMoney(netPay),
      delta: '+1.4%',
      trend: 'up',
      positive: true,
      hint: payPeriod.label,
    },
  ]
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

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** This week's hours, split by whole and half days, straight from attendance. */
export function weeklyHours(): DayHours[] {
  return attendanceWeek.map((iso, i) => {
    const codes = staff.map((p) => attendanceFor(p.ref)[i])
    return {
      day: DOW[i],
      date: iso,
      full: codes.filter((c) => c === 'P').length * attendanceHours.P,
      half: codes.filter((c) => c === 'H').length * attendanceHours.H,
    }
  })
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

/** Newest leave, expense and invoice records, merged for the dashboard table. */
export function recentActivity(): ActivityRow[] {
  const nameFor = (ref: string) => staff.find((p) => p.ref === ref)?.name ?? ref

  const rows: ActivityRow[] = [
    ...leaveRequests.map((r) => ({
      ref: r.id,
      title: `${r.days} day${r.days === 1 ? '' : 's'} ${r.type} leave`,
      who: nameFor(r.staffRef),
      amount: '—',
      kind: 'leave' as const,
      status: r.status,
      date: r.submitted,
    })),
    ...expenses.map((e) => ({
      ref: e.id,
      title: e.merchant,
      who: nameFor(e.staffRef),
      amount: formatMoney(e.amountPence),
      kind: 'expense' as const,
      status: e.status,
      date: e.date,
    })),
    ...invoices.map((i) => ({
      ref: i.id,
      title: i.reference,
      who: i.client,
      amount: formatMoney(i.amountPence),
      kind: 'invoice' as const,
      status: i.status,
      date: i.issued,
    })),
  ]

  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
}

/* --- Crew portal -------------------------------------------------------- */

/**
 * The signed-in employee for the /crew portal. There's no auth yet, so this
 * stands in for the session — read it from the session once auth is wired.
 */
export const currentStaffRef = 'EMP-001'

export function currentStaff(): StaffMember {
  const person = staff.find((p) => p.ref === currentStaffRef)
  if (!person) throw new Error(`Unknown staff ref: ${currentStaffRef}`)
  return person
}

/** Annual entitlement, mirroring the Settings default. */
export const ANNUAL_LEAVE_DAYS = 28

export function leaveTakenBy(ref: string) {
  return leaveRequests
    .filter((r) => r.staffRef === ref && r.status === 'approved')
    .reduce((n, r) => n + r.days, 0)
}

export function leaveFor(ref: string) {
  return leaveRequests
    .filter((r) => r.staffRef === ref)
    .sort((a, b) => b.submitted.localeCompare(a.submitted))
}

export function expensesFor(ref: string) {
  return expenses
    .filter((e) => e.staffRef === ref)
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function payrollFor(ref: string) {
  return payrollRuns.find((r) => r.staffRef === ref) ?? null
}
