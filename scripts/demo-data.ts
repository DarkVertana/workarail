import type {
  Attachment,
  Expense,
  Invoice,
  LeaveRequest,
  PayrollRecord,
  StaffMember,
} from "../app/lib/admin-data"

export const today = '2026-08-25'

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

