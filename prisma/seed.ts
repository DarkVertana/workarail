/**
 * Deterministic seed for a realistic operating environment.
 *
 * The goal is not "some rows in every table". It is a small rail contracting
 * business mid-quarter, with enough history and enough awkward cases that
 * every screen, every role boundary and every workflow state can be exercised
 * without inventing data by hand:
 *
 *   - four roles, and staff in every employment state including one
 *     onboarding, one suspended, one on notice, one leaver and one archived
 *   - two managers with separate crews, so manager scoping is testable
 *     (a manager must see their own crew and not the other's)
 *   - a part-timer, an agency worker, a subcontractor and an apprentice, so
 *     pro-rated leave entitlement and contract handling are exercised
 *   - compliance documents that are valid, expiring, expired, pending review
 *     and rejected — including one operative who is *not* cleared for site
 *   - timesheets in every state, with the approved ones actually feeding the
 *     historical payroll runs
 *   - leave in every state including half-days, unpaid leave and leave that
 *     crosses the leave-year boundary
 *   - expenses in every state, with and without receipts
 *   - invoices in every state with real line items, partial payments and both
 *     a void and a written-off case
 *   - three settled payroll months plus an open draft, with adjustments
 *
 * Everything is derived from a fixed anchor date and a seeded PRNG, so two
 * runs produce the same database. Dates are relative to today so the data
 * stays plausible whenever it is run.
 *
 * Run against an empty database:
 *   npx tsx scripts/reset-db.ts && npx tsx prisma/seed.ts
 *
 * Every account uses the same development password, printed at the end.
 */

import 'dotenv/config'
import crypto from 'crypto'

import { prisma } from '../app/lib/prisma'
import {
  addDays,
  businessToday,
  monthBounds,
  previousPeriod,
  startOfWeek,
  utcDate,
} from '../app/lib/dates'
import {
  computeBaseGross,
  payableDaysFrom,
} from '../app/lib/payroll'
import { computeInvoiceTotals } from '../app/lib/invoices'
import { prepareBankAccount } from '../app/lib/bank'
import {
  calculatePay,
  taxYearOfDate,
  taxPeriodOfDate,
  ZERO_YTD,
  type YearToDate,
} from '../app/lib/hmrc'
import type { Prisma } from '../generated/prisma'

const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'Workarail-Dev-2026'

function hashPassword(password: string): string {
  // Matches scripts/seed-admin.ts, which mirrors better-auth's scrypt format.
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = crypto.scryptSync(password, salt, 64)
  return `${salt}:${derivedKey.toString('hex')}`
}

/**
 * Deterministic PRNG (mulberry32). Seeded so a rerun produces byte-identical
 * choices — a seed that shuffles between runs makes a failing test
 * unreproducible.
 */
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20260829)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]

const TODAY = businessToday()
const THIS_YEAR = Number(TODAY.slice(0, 4))
const THIS_MONTH = Number(TODAY.slice(5, 7))

const money = (pounds: number) => Math.round(pounds * 100)

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type SeedStaff = {
  ref: string
  name: string
  email: string
  role: string
  jobTitle: string
  userRole: 'ADMIN' | 'FINANCE' | 'MANAGER' | 'CREW'
  crew: string | null
  manager: string | null
  status: 'onboarding' | 'active' | 'suspended' | 'notice' | 'leaver' | 'archived'
  contract: 'permanent' | 'fixed_term' | 'agency' | 'subcontractor' | 'apprentice'
  weeklyHours: number
  dayRate: number
  joinedDaysAgo: number
  birthday: string
  isStaff?: boolean

  // --- Payroll scenario ------------------------------------------------
  // Left undefined for most people so they get the ordinary arrangement.
  // Set explicitly where a specific case needs to be exercisable.

  /** Omit to default to 1257L. Null means "no code yet" — payroll must refuse. */
  taxCode?: string | null
  taxBasis?: 'cumulative' | 'week1_month1'
  niCategory?: string
  payFrequency?: 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly'
  studentLoanPlan?: 1 | 2 | 4 | 5 | null
  postgradLoan?: boolean
  /**
   * 'verified'   — payable
   * 'unverified' — entered but not checked, so payroll refuses
   * 'none'       — nothing on record, so payroll refuses
   */
  bank?: 'verified' | 'unverified' | 'none'
  /** A second, superseded tax code, to exercise mid-year code changes. */
  previousTaxCode?: string
}

const CREWS = [
  { name: 'Track Renewals North', site: 'Doncaster', supervisor: 'WR-004' },
  { name: 'Signalling South', site: 'Reading', supervisor: 'WR-005' },
  { name: 'Overhead Line', site: 'Crewe', supervisor: null },
  { name: 'Plant & Machinery', site: 'Doncaster', supervisor: null },
  // Retained for historical records but no longer operating.
  { name: 'Structures (disbanded)', site: null, supervisor: null, inactive: true },
]

/**
 * The payroll scenarios this roster is built to exercise:
 *
 *   WR-001  high earner crossing the higher-rate band
 *   WR-002  Scottish taxpayer (S prefix), different band table
 *   WR-003  part-time, week1/month1 basis, plan 2 student loan
 *   WR-010  ordinary case: 1257L cumulative, category A, verified bank
 *   WR-011  mid-year tax code change, so YTD and a correction are testable
 *   WR-012  BR code — second job, no allowance
 *   WR-013  NI category C, over state pension age, no employee NI
 *   WR-014  weekly paid rather than monthly
 *   WR-015  K code, negative allowance and the 50% regulatory limit
 *   WR-020  bank details entered but NOT verified  -> payroll refuses
 *   WR-021  no bank details at all                 -> payroll refuses
 *   WR-022  no tax code at all                     -> payroll refuses
 *   WR-023  under 21, NI category M
 *   WR-030  apprentice, category H, postgraduate loan
 */
const STAFF: SeedStaff[] = [
  // --- Office ---
  {
    ref: 'WR-001', name: 'Priya Raman', email: 'priya.raman@workarail.test',
    role: 'Operations Director', jobTitle: 'Operations Director', userRole: 'ADMIN',
    crew: null, manager: null, status: 'active', contract: 'permanent',
    weeklyHours: 37.5, dayRate: 320, joinedDaysAgo: 1900, birthday: '03-14',
    taxCode: '1257L', bank: 'verified',
  },
  {
    ref: 'WR-002', name: 'Daniel Okafor', email: 'daniel.okafor@workarail.test',
    role: 'Finance Manager', jobTitle: 'Finance Manager', userRole: 'FINANCE',
    crew: null, manager: 'WR-001', status: 'active', contract: 'permanent',
    weeklyHours: 37.5, dayRate: 280, joinedDaysAgo: 1200, birthday: '07-02',
    // Scottish taxpayer: the S prefix selects the six-band Scottish table.
    taxCode: 'S1257L', bank: 'verified',
  },
  {
    ref: 'WR-003', name: 'Hannah Whitfield', email: 'hannah.whitfield@workarail.test',
    role: 'Payroll Administrator', jobTitle: 'Payroll Administrator',
    userRole: 'FINANCE', crew: null, manager: 'WR-002', status: 'active',
    contract: 'permanent', weeklyHours: 30, dayRate: 190, joinedDaysAgo: 700,
    birthday: '11-23',
    // Part-time, on a week1/month1 basis with a plan 2 student loan.
    taxCode: '1257L', taxBasis: 'week1_month1', studentLoanPlan: 2, bank: 'verified',
  },

  // --- Crew supervisors (MANAGER) ---
  {
    ref: 'WR-004', name: 'Gareth Lloyd', email: 'gareth.lloyd@workarail.test',
    role: 'Site Supervisor', jobTitle: 'Track Supervisor', userRole: 'MANAGER',
    crew: 'Track Renewals North', manager: 'WR-001', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 265, joinedDaysAgo: 1500,
    birthday: '01-09',
    taxCode: '1257L', bank: 'verified',
  },
  {
    ref: 'WR-005', name: 'Marta Kowalczyk', email: 'marta.kowalczyk@workarail.test',
    role: 'Site Supervisor', jobTitle: 'Signalling Supervisor', userRole: 'MANAGER',
    crew: 'Signalling South', manager: 'WR-001', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 270, joinedDaysAgo: 1100,
    birthday: '05-30',
    taxCode: '1257L', bank: 'verified',
  },

  // --- Track Renewals North ---
  {
    ref: 'WR-010', name: 'Tomasz Nowak', email: 'tomasz.nowak@workarail.test',
    role: 'Track Operative', jobTitle: 'Track Operative', userRole: 'CREW',
    crew: 'Track Renewals North', manager: 'WR-004', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 185, joinedDaysAgo: 800,
    birthday: '02-18',
    // The ordinary case everything else is compared against.
    taxCode: '1257L', bank: 'verified',
  },
  {
    ref: 'WR-011', name: 'Callum Fraser', email: 'callum.fraser@workarail.test',
    role: 'Machine Operator', jobTitle: 'Tamper Operator', userRole: 'CREW',
    crew: 'Track Renewals North', manager: 'WR-004', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 210, joinedDaysAgo: 620,
    birthday: '09-05',
    // Started on an emergency code, moved to a cumulative one in-year.
    previousTaxCode: '1257L X', taxCode: '1257L', bank: 'verified',
  },
  {
    ref: 'WR-012', name: 'Ade Balogun', email: 'ade.balogun@workarail.test',
    role: 'Track Operative', jobTitle: 'Track Operative', userRole: 'CREW',
    crew: 'Track Renewals North', manager: 'WR-004', status: 'active',
    contract: 'agency', weeklyHours: 40, dayRate: 175, joinedDaysAgo: 210,
    birthday: '12-11',
    // Second job: no allowance, every pound at basic rate.
    taxCode: 'BR', bank: 'verified',
  },
  {
    // Part-time: exercises pro-rated leave entitlement.
    ref: 'WR-013', name: 'Sofia Marchetti', email: 'sofia.marchetti@workarail.test',
    role: 'Site Administrator', jobTitle: 'Site Administrator', userRole: 'CREW',
    crew: 'Track Renewals North', manager: 'WR-004', status: 'active',
    contract: 'permanent', weeklyHours: 22.5, dayRate: 140, joinedDaysAgo: 430,
    birthday: '06-27',
    // Over state pension age: NI category C means no employee NI at all.
    taxCode: '1257L', niCategory: 'C', bank: 'verified',
  },

  // --- Signalling South ---
  {
    ref: 'WR-020', name: 'Rhys Bevan', email: 'rhys.bevan@workarail.test',
    role: 'Signalling Technician', jobTitle: 'Signalling Technician',
    userRole: 'CREW', crew: 'Signalling South', manager: 'WR-005', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 230, joinedDaysAgo: 950,
    birthday: '04-03',
    // Bank details entered but never checked -> payroll must refuse to pay.
    taxCode: '1257L', bank: 'unverified',
  },
  {
    ref: 'WR-021', name: 'Chen Wei', email: 'chen.wei@workarail.test',
    role: 'Signalling Technician', jobTitle: 'Senior Signalling Technician',
    userRole: 'CREW', crew: 'Signalling South', manager: 'WR-005', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 245, joinedDaysAgo: 1320,
    birthday: '08-16',
    // No payment details at all -> payroll must refuse to pay.
    taxCode: '1257L', bank: 'none',
  },
  {
    ref: 'WR-022', name: 'Leah Donnelly', email: 'leah.donnelly@workarail.test',
    role: 'Apprentice Technician', jobTitle: 'Apprentice Signalling Technician',
    userRole: 'CREW', crew: 'Signalling South', manager: 'WR-005', status: 'active',
    contract: 'apprentice', weeklyHours: 37.5, dayRate: 105, joinedDaysAgo: 150,
    birthday: '10-08',
    // New starter with no P45 and no coding notice yet -> payroll must
    // refuse rather than assume 1257L.
    taxCode: null, bank: 'verified',
  },

  // --- Overhead Line ---
  {
    ref: 'WR-030', name: 'Ibrahim Sesay', email: 'ibrahim.sesay@workarail.test',
    role: 'OLE Linesman', jobTitle: 'OLE Linesman', userRole: 'CREW',
    crew: 'Overhead Line', manager: 'WR-004', status: 'active',
    contract: 'permanent', weeklyHours: 40, dayRate: 240, joinedDaysAgo: 540,
    birthday: '01-31',
    // Apprentice under 25: NI category H, and a postgraduate loan running
    // alongside a plan 1 loan.
    taxCode: '1257L', niCategory: 'H', studentLoanPlan: 1, postgradLoan: true,
    bank: 'verified',
  },
  {
    ref: 'WR-031', name: 'Kirsty Muir', email: 'kirsty.muir@workarail.test',
    role: 'OLE Linesman', jobTitle: 'OLE Linesman', userRole: 'CREW',
    crew: 'Overhead Line', manager: 'WR-004', status: 'active',
    contract: 'subcontractor', weeklyHours: 40, dayRate: 260, joinedDaysAgo: 300,
    birthday: '03-22',
    // Under 21: NI category M.
    taxCode: '1257L', niCategory: 'M', bank: 'verified',
  },

  // --- Lifecycle edge cases ---
  {
    // Onboarding: paperwork incomplete, so must not be activatable yet.
    ref: 'WR-040', name: 'Jamie Iqbal', email: 'jamie.iqbal@workarail.test',
    role: 'Track Operative', jobTitle: 'Track Operative', userRole: 'CREW',
    crew: 'Plant & Machinery', manager: 'WR-004', status: 'onboarding',
    contract: 'permanent', weeklyHours: 40, dayRate: 180, joinedDaysAgo: -7,
    birthday: '05-12',
    // Still onboarding and paid weekly: exercises both the incomplete-record
    // path and the weekly PAYE period length.
    taxCode: null, payFrequency: 'weekly', bank: 'none',
  },
  {
    ref: 'WR-041', name: 'Dean Harper', email: 'dean.harper@workarail.test',
    role: 'Plant Operator', jobTitle: 'Plant Operator', userRole: 'CREW',
    crew: 'Plant & Machinery', manager: 'WR-004', status: 'suspended',
    contract: 'permanent', weeklyHours: 40, dayRate: 200, joinedDaysAgo: 660,
    birthday: '07-19',
    // K code: benefits exceed the allowance, so pay is added to rather than
    // relieved, and the 50% regulatory limit becomes reachable.
    taxCode: 'K475', bank: 'verified',
  },
  {
    ref: 'WR-042', name: 'Noor Hassan', email: 'noor.hassan@workarail.test',
    role: 'Track Operative', jobTitle: 'Track Operative', userRole: 'CREW',
    crew: 'Signalling South', manager: 'WR-005', status: 'notice',
    contract: 'permanent', weeklyHours: 40, dayRate: 190, joinedDaysAgo: 890,
    birthday: '02-04',
    taxCode: '1257L', bank: 'verified',
  },
  {
    ref: 'WR-043', name: 'Paul Ashworth', email: 'paul.ashworth@workarail.test',
    role: 'Track Operative', jobTitle: 'Track Operative', userRole: 'CREW',
    crew: null, manager: null, status: 'leaver', contract: 'fixed_term',
    weeklyHours: 40, dayRate: 180, joinedDaysAgo: 1050, birthday: '09-28',
    taxCode: '1257L', bank: 'verified',
  },
  {
    ref: 'WR-044', name: 'Elaine Prescott', email: 'elaine.prescott@workarail.test',
    role: 'Site Administrator', jobTitle: 'Site Administrator', userRole: 'CREW',
    crew: null, manager: null, status: 'archived', contract: 'permanent',
    weeklyHours: 30, dayRate: 150, joinedDaysAgo: 2100, birthday: '11-02',
    taxCode: '1257L', bank: 'verified',
  },
]

const CLIENTS = [
  {
    name: 'Network Rail (Eastern)', legalName: 'Network Rail Infrastructure Limited',
    companyNumber: '02904587', vatNumber: 'GB756934567', terms: 45,
    city: 'Milton Keynes', postcode: 'MK9 1EN',
    contact: 'Alison Pike', email: 'alison.pike@nr-eastern.test', phone: '01908 555201',
    creditLimit: money(500000), active: true,
  },
  {
    name: 'TransPennine Infrastructure', legalName: 'TransPennine Infrastructure plc',
    companyNumber: '04417723', vatNumber: 'GB812445901', terms: 30,
    city: 'Leeds', postcode: 'LS1 4DY',
    contact: 'Mark Sutcliffe', email: 'm.sutcliffe@tpinfra.test', phone: '0113 555 8820',
    creditLimit: money(250000), active: true,
  },
  {
    name: 'Southern Signalling Ltd', legalName: 'Southern Signalling Limited',
    companyNumber: '09912008', vatNumber: 'GB334128776', terms: 30,
    city: 'Reading', postcode: 'RG1 8EQ',
    contact: 'Fiona Grant', email: 'fiona.grant@southernsig.test', phone: '0118 555 4410',
    creditLimit: money(120000), active: true,
  },
  {
    name: 'Crewe Depot Services', legalName: 'Crewe Depot Services Ltd',
    companyNumber: '07781234', vatNumber: null, terms: 14,
    city: 'Crewe', postcode: 'CW1 2DB',
    contact: 'Ray Tomlinson', email: 'ray@crewedepot.test', phone: '01270 555 118',
    creditLimit: money(40000), active: true,
  },
  {
    // Dormant: exercises the inactive-client path and historical invoices.
    name: 'Midland Permanent Way', legalName: 'Midland Permanent Way Co.',
    companyNumber: '03310945', vatNumber: 'GB221009834', terms: 60,
    city: 'Derby', postcode: 'DE1 2RS',
    contact: 'Susan Wilde', email: 's.wilde@midlandpw.test', phone: '01332 555 970',
    creditLimit: null, active: false,
  },
]

// ---------------------------------------------------------------------------

async function main() {
  const existing = await prisma.staff.count()
  if (existing > 0) {
    throw new Error(
      `The database already holds ${existing} staff records. Run scripts/reset-db.ts first — seeding on top of existing data would produce duplicates.`
    )
  }

  console.log(`Seeding a realistic environment as at ${TODAY}...\n`)
  const passwordHash = hashPassword(DEV_PASSWORD)

  // --- Settings -----------------------------------------------------------
  const settings: Array<[string, Prisma.InputJsonValue]> = [
    ['company', 'Work à Rail Ltd'],
    ['timezone', 'Europe/London'],
    ['currency', 'GBP'],
    ['workingDays', 'Monday to Friday'],
    ['standardDay', 8],
    ['leaveDays', 28],
    ['carryOver', 5],
    ['payday', 28],
    ['tax', 20],
    ['ni', 12],
    ['pension', 5],
    ['allowancePence', money(12570)],
    ['notifyLeave', true],
    ['notifyExpenses', true],
    ['notifyPayroll', true],
    ['notifyCelebrations', true],
  ]
  for (const [key, value] of settings) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  }
  console.log(`  Settings          ${settings.length}`)

  // --- Crews --------------------------------------------------------------
  const crewIds = new Map<string, string>()
  for (const crew of CREWS) {
    const row = await prisma.crew.create({
      data: {
        name: crew.name,
        nameKey: crew.name.trim().toLowerCase(),
        site: crew.site,
        isActive: !('inactive' in crew && crew.inactive),
      },
    })
    crewIds.set(crew.name, row.id)
  }
  console.log(`  Crews             ${CREWS.length}`)

  // --- Clients ------------------------------------------------------------
  const clientIds = new Map<string, string>()
  for (const client of CLIENTS) {
    const row = await prisma.client.create({
      data: {
        name: client.name,
        nameKey: client.name.trim().toLowerCase(),
        legalName: client.legalName,
        companyNumber: client.companyNumber,
        vatNumber: client.vatNumber,
        billingAddressLine1: '1 Station Approach',
        billingCity: client.city,
        billingPostcode: client.postcode,
        primaryContactName: client.contact,
        primaryContactEmail: client.email,
        primaryContactPhone: client.phone,
        paymentTermsDays: client.terms,
        creditLimitPence: client.creditLimit,
        isActive: client.active,
      },
    })
    clientIds.set(client.name, row.id)
  }
  console.log(`  Clients           ${CLIENTS.length}`)

  // --- Jobs ---------------------------------------------------------------
  const JOBS = [
    {
      ref: 'JOB-0041', title: 'Doncaster S&C renewal', client: 'Network Rail (Eastern)',
      crew: 'Track Renewals North', location: 'Doncaster South Yard', cost: 'DN-SC-41',
      rate: money(2400), start: -60, end: 30, active: true,
    },
    {
      ref: 'JOB-0042', title: 'Reading area resignalling', client: 'Southern Signalling Ltd',
      crew: 'Signalling South', location: 'Reading West Jn', cost: 'RD-SIG-42',
      rate: money(2900), start: -95, end: 60, active: true,
    },
    {
      ref: 'JOB-0043', title: 'Crewe OLE refurbishment', client: 'Crewe Depot Services',
      crew: 'Overhead Line', location: 'Crewe North', cost: 'CW-OLE-43',
      rate: money(3100), start: -40, end: 15, active: true,
    },
    {
      ref: 'JOB-0044', title: 'Leeds embankment stabilisation',
      client: 'TransPennine Infrastructure', crew: 'Plant & Machinery',
      location: 'Leeds Holbeck', cost: 'LS-EMB-44', rate: money(2200),
      start: 14, end: 90, active: true,
    },
    {
      ref: 'JOB-0038', title: 'Wakefield ballast drop', client: 'Network Rail (Eastern)',
      crew: 'Track Renewals North', location: 'Wakefield Kirkgate', cost: 'WF-BAL-38',
      rate: money(2100), start: -180, end: -120, active: false,
    },
    {
      ref: 'JOB-0039', title: 'Derby PW survey', client: 'Midland Permanent Way',
      crew: null, location: 'Derby', cost: 'DE-PW-39', rate: money(1500),
      start: -400, end: -360, active: false,
    },
  ]

  const jobIds = new Map<string, string>()
  for (const job of JOBS) {
    const row = await prisma.job.create({
      data: {
        reference: job.ref,
        title: job.title,
        clientId: clientIds.get(job.client)!,
        crewId: job.crew ? crewIds.get(job.crew)! : null,
        location: job.location,
        costCode: job.cost,
        dayRatePence: job.rate,
        startDate: utcDate(addDays(TODAY, job.start)),
        endDate: utcDate(addDays(TODAY, job.end)),
        isActive: job.active,
      },
    })
    jobIds.set(job.ref, row.id)
  }
  console.log(`  Jobs              ${JOBS.length}`)

  // --- Users and staff ----------------------------------------------------
  // Two passes: create everyone, then wire managers and supervisors, because
  // the references are circular.
  for (const person of STAFF) {
    const joined = addDays(TODAY, -person.joinedDaysAgo)
    const isLeaver = person.status === 'leaver' || person.status === 'archived'

    const user = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        emailVerified: true,
        role: person.userRole,
        isActive: !isLeaver && person.status !== 'suspended',
        lastLoginAt:
          isLeaver || person.status === 'onboarding'
            ? null
            : new Date(Date.parse(`${addDays(TODAY, -Math.floor(rand() * 5))}T08:${10 + Math.floor(rand() * 40)}:00Z`)),
      },
    })
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: passwordHash,
        passwordChangedAt: new Date(),
      },
    })

    // Contract staff are the ones most likely to have a non-standard
    // entitlement stated on the contract rather than derived from hours.
    const annualLeaveDays =
      person.contract === 'subcontractor' ? 0
      : person.contract === 'apprentice' ? 25
      : null

    await prisma.staff.create({
      data: {
        ref: person.ref,
        name: person.name,
        email: person.email,
        phone: `07${700 + Math.floor(rand() * 200)} ${100000 + Math.floor(rand() * 899999)}`,
        role: person.role,
        jobTitle: person.jobTitle,
        employmentStatus: person.status,
        availability:
          person.status !== 'active' ? 'off_shift' : pick(['on_site', 'available', 'off_shift'] as const),
        contractType: person.contract,
        joined: utcDate(joined),
        probationEndDate:
          person.joinedDaysAgo < 180 ? utcDate(addDays(joined, 180)) : null,
        endDate:
          person.status === 'leaver' ? utcDate(addDays(TODAY, -35))
          : person.status === 'archived' ? utcDate(addDays(TODAY, -400))
          : person.status === 'notice' ? utcDate(addDays(TODAY, 21))
          : null,
        noticeDate: person.status === 'notice' ? utcDate(addDays(TODAY, -9)) : null,
        leaverReason:
          person.status === 'leaver' ? 'Fixed-term contract ended'
          : person.status === 'notice' ? 'Resigned — moving to another operator'
          : person.status === 'archived' ? 'Retired'
          : null,
        suspendedAt: person.status === 'suspended' ? utcDate(addDays(TODAY, -12)) : null,
        suspensionReason:
          person.status === 'suspended'
            ? 'Under investigation following a near-miss report'
            : null,
        weeklyHours: person.weeklyHours,
        dayRatePence: money(person.dayRate),
        annualLeaveDays,
        carryOverDays: person.joinedDaysAgo > 400 ? pick([0, 1.5, 3, 5]) : 0,
        crewId: person.crew ? crewIds.get(person.crew)! : null,
        birthday: person.birthday,
        dateOfBirth: utcDate(
          `${1970 + Math.floor(rand() * 30)}-${person.birthday}`
        ),
        addressLine1: `${1 + Math.floor(rand() * 90)} ${pick(['Beech', 'Station', 'Mill', 'Chapel', 'Victoria'])} ${pick(['Road', 'Street', 'Lane', 'Avenue'])}`,
        addressCity: pick(['Doncaster', 'Leeds', 'Reading', 'Crewe', 'Derby']),
        addressPostcode: `${pick(['DN', 'LS', 'RG', 'CW', 'DE'])}${1 + Math.floor(rand() * 9)} ${1 + Math.floor(rand() * 9)}${pick(['AB', 'JQ', 'RS', 'TW'])}`,
        emergencyContactName: pick(['Sam Reed', 'Alex Doyle', 'Chris Farrow', 'Jo Mensah']),
        emergencyContactPhone: `07${800 + Math.floor(rand() * 99)} ${100000 + Math.floor(rand() * 899999)}`,
        emergencyContactRelation: pick(['Partner', 'Parent', 'Sibling', 'Friend']),
        niNumber: `${pick(['AB', 'JT', 'NM', 'PR', 'SK'])}${String(100000 + Math.floor(rand() * 899999))}${pick(['A', 'B', 'C', 'D'])}`,
        preferredName: rand() > 0.7 ? person.name.split(' ')[0] : null,
        personalEmail: `${person.ref.toLowerCase()}.personal@example.test`,
        personalPhone: `07${800 + Math.floor(rand() * 99)} ${100000 + Math.floor(rand() * 899999)}`,
        gender: pick(['male', 'female', 'non_binary', 'prefer_not_to_say'] as const),
        nationality: pick(['British', 'British', 'Polish', 'Irish', 'Italian']),
        addressCountry: 'United Kingdom',
        payFrequency: person.payFrequency ?? 'monthly',
        userId: user.id,
      },
    })

    // --- PAYE arrangement -------------------------------------------------
    // Effective-dated rather than columns on Staff. `taxCode: null` in the
    // scenario means no code has been issued yet, which payroll must refuse
    // to work around.
    if (person.taxCode !== null) {
      const code = person.taxCode ?? '1257L'

      // Where a previous code is given, the employee started on it and was
      // moved to the current one part-way through, so a mid-year change and
      // the resulting cumulative correction are both testable.
      if (person.previousTaxCode) {
        const changedOn = addDays(TODAY, -75)
        await prisma.staffPayrollProfile.create({
          data: {
            staffRef: person.ref,
            taxCode: person.previousTaxCode,
            basis: 'week1_month1',
            niCategory: person.niCategory ?? 'A',
            effectiveFrom: utcDate(joined),
            effectiveTo: utcDate(changedOn),
            source: 'P46 starter checklist',
          },
        })
        await prisma.staffPayrollProfile.create({
          data: {
            staffRef: person.ref,
            taxCode: code,
            basis: 'cumulative',
            niCategory: person.niCategory ?? 'A',
            studentLoanPlan: person.studentLoanPlan ?? null,
            postgradLoan: person.postgradLoan ?? false,
            effectiveFrom: utcDate(changedOn),
            source: 'P6 coding notice',
          },
        })
      } else {
        await prisma.staffPayrollProfile.create({
          data: {
            staffRef: person.ref,
            taxCode: code,
            basis: person.taxBasis ?? 'cumulative',
            niCategory: person.niCategory ?? 'A',
            studentLoanPlan: person.studentLoanPlan ?? null,
            postgradLoan: person.postgradLoan ?? false,
            effectiveFrom: utcDate(joined),
            source: 'P45',
          },
        })
      }
    }

    // --- Bank details -----------------------------------------------------
    // Synthetic throughout. The sort codes use the 04-00-04 test range and the
    // account numbers are sequential from the staff reference, so nothing here
    // resembles a real account even by accident.
    const bankMode = person.bank ?? 'verified'
    if (bankMode !== 'none') {
      const seq = Number(person.ref.replace(/\D/g, '')) || 1
      const accountNumber = String(10_000_000 + seq * 1_111).slice(0, 8)
      const prepared = prepareBankAccount({
        method: 'bacs',
        sortCode: '040004',
        accountNumber,
      })
      await prisma.staffBankAccount.create({
        data: {
          staffRef: person.ref,
          accountHolderName: person.name,
          bankName: pick(['Monzo (test)', 'Starling (test)', 'Barclays (test)']),
          method: 'bacs',
          ...prepared,
          isPrimary: true,
          effectiveFrom: utcDate(joined),
          verifiedAt: bankMode === 'verified' ? utcDate(addDays(joined, 2)) : null,
        },
      })
    }

    // Effective-dated pay history: a raise 12 months in for longer-serving
    // staff, so a historical payroll run reads the rate in force at the time.
    if (person.joinedDaysAgo > 400) {
      const raiseFrom = addDays(joined, 365)
      const previousRate = Math.round(money(person.dayRate) * 0.92)
      await prisma.staffPayRate.create({
        data: {
          staffRef: person.ref,
          dayRatePence: previousRate,
          effectiveFrom: utcDate(joined),
          effectiveTo: utcDate(addDays(raiseFrom, -1)),
        },
      })
      await prisma.staffPayRate.create({
        data: {
          staffRef: person.ref,
          dayRatePence: money(person.dayRate),
          effectiveFrom: utcDate(raiseFrom),
        },
      })
    } else {
      await prisma.staffPayRate.create({
        data: {
          staffRef: person.ref,
          dayRatePence: money(person.dayRate),
          effectiveFrom: utcDate(joined),
        },
      })
    }
  }

  // Wire the circular references now everyone exists.
  for (const person of STAFF) {
    if (person.manager) {
      await prisma.staff.update({
        where: { ref: person.ref },
        data: { managerRef: person.manager },
      })
    }
  }
  for (const crew of CREWS) {
    if (crew.supervisor) {
      await prisma.crew.update({
        where: { id: crewIds.get(crew.name)! },
        data: { supervisorRef: crew.supervisor },
      })
    }
  }
  // Put the operating crews on their current jobs.
  for (const [crewName, jobRef] of [
    ['Track Renewals North', 'JOB-0041'],
    ['Signalling South', 'JOB-0042'],
    ['Overhead Line', 'JOB-0043'],
  ] as const) {
    await prisma.staff.updateMany({
      where: { crewId: crewIds.get(crewName)!, employmentStatus: 'active' },
      data: { currentJobId: jobIds.get(jobRef)! },
    })
  }
  console.log(`  Users + staff     ${STAFF.length}`)

  // --- Compliance documents ----------------------------------------------
  // Deliberately uneven: most people are cleared, one PTS has expired, one is
  // about to, one is awaiting review and one was rejected. WR-040 is
  // onboarding with nothing on file, so activation must be refused.
  type DocSeed = {
    ref: string
    kind: 'pts' | 'medical' | 'right_to_work' | 'contract' | 'certification'
    status: 'pending_review' | 'valid' | 'rejected'
    issued: number
    expires: number | null
    notes?: string
  }
  const docs: DocSeed[] = []
  for (const person of STAFF) {
    if (person.status === 'onboarding' || person.status === 'archived') continue
    const base = Math.min(person.joinedDaysAgo, 700)
    docs.push({ ref: person.ref, kind: 'right_to_work', status: 'valid', issued: -base, expires: null })
    docs.push({ ref: person.ref, kind: 'contract', status: 'valid', issued: -base, expires: null })
  }
  // Site-facing trades hold a PTS card.
  for (const ref of ['WR-004', 'WR-005', 'WR-010', 'WR-011', 'WR-012', 'WR-020', 'WR-021', 'WR-022', 'WR-030', 'WR-031', 'WR-041', 'WR-042']) {
    docs.push({ ref, kind: 'pts', status: 'valid', issued: -900, expires: 400 })
    docs.push({ ref, kind: 'medical', status: 'valid', issued: -700, expires: 500 })
  }
  // The awkward cases.
  docs.push({ ref: 'WR-012', kind: 'pts', status: 'valid', issued: -1100, expires: -20, notes: 'Renewal booked' })
  docs.push({ ref: 'WR-031', kind: 'pts', status: 'valid', issued: -1000, expires: 25, notes: 'Renewal due' })
  docs.push({ ref: 'WR-022', kind: 'certification', status: 'pending_review', issued: -5, expires: 720 })
  docs.push({ ref: 'WR-013', kind: 'certification', status: 'rejected', issued: -30, expires: 300, notes: 'Illegible scan — please re-upload' })

  for (const doc of docs) {
    await prisma.staffDocument.create({
      data: {
        staffRef: doc.ref,
        kind: doc.kind,
        reference:
          doc.kind === 'pts'
            ? `PTS-${100000 + Math.floor(rand() * 899999)}`
            : doc.kind === 'medical'
              ? `MED-${10000 + Math.floor(rand() * 89999)}`
              : null,
        status: doc.status,
        issuedOn: utcDate(addDays(TODAY, doc.issued)),
        expiresOn: doc.expires === null ? null : utcDate(addDays(TODAY, doc.expires)),
        notes: doc.notes ?? null,
      },
    })
  }
  console.log(`  Documents         ${docs.length}`)

  // --- Attendance and timesheets -----------------------------------------
  // Eight weeks back. Older weeks are approved and locked so they can feed
  // payroll; the most recent are submitted, rejected and draft respectively.
  const workingStaff = STAFF.filter(
    (s) => !['leaver', 'archived', 'onboarding'].includes(s.status)
  )

  let attendanceCount = 0
  let timesheetCount = 0

  for (let weeksAgo = 8; weeksAgo >= 0; weeksAgo--) {
    const monday = startOfWeek(addDays(TODAY, -weeksAgo * 7))
    // Approval state by age: settled history, then the live edge.
    const status: 'approved' | 'submitted' | 'rejected' | 'draft' =
      weeksAgo >= 3 ? 'approved' : weeksAgo === 2 ? 'submitted' : weeksAgo === 1 ? 'rejected' : 'draft'

    for (const person of workingStaff) {
      // Not employed yet that week.
      if (addDays(TODAY, -person.joinedDaysAgo) > monday) continue
      // Suspended staff stop filing once suspended.
      if (person.status === 'suspended' && weeksAgo < 2) continue

      const sheet = await prisma.timesheet.create({
        data: {
          staffRef: person.ref,
          weekStart: utcDate(monday),
          status,
          submittedAt:
            status === 'draft' ? null : utcDate(addDays(monday, 4)),
          decidedAt:
            status === 'approved' || status === 'rejected'
              ? utcDate(addDays(monday, 7))
              : null,
          rejectionReason:
            status === 'rejected'
              ? 'Friday shows as present but the site was stood down — please correct.'
              : null,
          lockedAt: status === 'approved' ? utcDate(addDays(monday, 7)) : null,
        },
      })
      timesheetCount += 1

      for (let d = 0; d < 5; d++) {
        const date = addDays(monday, d)
        if (date > TODAY) continue
        // Mostly present, with the occasional half day and absence.
        const roll = rand()
        const code = roll > 0.93 ? 'A' : roll > 0.86 ? 'H' : 'P'
        await prisma.attendance.create({
          data: {
            staffRef: person.ref,
            date: utcDate(date),
            code,
            hours: code === 'P' ? 9 : code === 'H' ? 4.5 : 0,
            jobId: person.crew
              ? (jobIds.get(
                  person.crew === 'Track Renewals North' ? 'JOB-0041'
                  : person.crew === 'Signalling South' ? 'JOB-0042'
                  : person.crew === 'Overhead Line' ? 'JOB-0043'
                  : 'JOB-0044'
                ) ?? null)
              : null,
            timesheetId: sheet.id,
            source: 'crew',
          },
        })
        attendanceCount += 1
      }
    }
  }
  console.log(`  Timesheets        ${timesheetCount}`)
  console.log(`  Attendance        ${attendanceCount}`)

  // --- Leave --------------------------------------------------------------
  const LEAVE = [
    { ref: 'WR-010', type: 'annual', from: -120, to: -114, days: 5, status: 'taken', deducts: true },
    { ref: 'WR-010', type: 'annual', from: 21, to: 25, days: 5, status: 'approved', deducts: true },
    { ref: 'WR-011', type: 'sick', from: -40, to: -39, days: 2, status: 'taken', deducts: false },
    { ref: 'WR-011', type: 'annual', from: 40, to: 44, days: 5, status: 'pending', deducts: true },
    { ref: 'WR-012', type: 'annual', from: 10, to: 10, days: 0.5, status: 'pending', deducts: true, startAt: 'afternoon' },
    { ref: 'WR-013', type: 'annual', from: -60, to: -58, days: 3, status: 'taken', deducts: true },
    { ref: 'WR-020', type: 'parental', from: -200, to: -180, days: 15, status: 'taken', deducts: false },
    { ref: 'WR-020', type: 'annual', from: 60, to: 67, days: 6, status: 'pending', deducts: true },
    { ref: 'WR-021', type: 'annual', from: -15, to: -11, days: 5, status: 'taken', deducts: true },
    { ref: 'WR-021', type: 'unpaid', from: 90, to: 104, days: 11, status: 'approved', deducts: false },
    { ref: 'WR-022', type: 'annual', from: 5, to: 9, days: 5, status: 'rejected', deducts: true },
    { ref: 'WR-030', type: 'compassionate', from: -30, to: -28, days: 3, status: 'taken', deducts: false },
    { ref: 'WR-030', type: 'annual', from: 30, to: 34, days: 5, status: 'cancelled', deducts: true },
    { ref: 'WR-031', type: 'annual', from: 3, to: 7, days: 5, status: 'approved', deducts: true },
    { ref: 'WR-042', type: 'annual', from: 14, to: 18, days: 5, status: 'pending', deducts: true },
    { ref: 'WR-004', type: 'annual', from: -90, to: -86, days: 5, status: 'taken', deducts: true },
    { ref: 'WR-005', type: 'annual', from: 45, to: 52, days: 6, status: 'approved', deducts: true },
    // Crosses the leave-year boundary: belongs wholly to the year it starts in.
    { ref: 'WR-020', type: 'annual', from: 0, to: 0, days: 1, status: 'draft', deducts: true },
  ] as const

  for (const [i, leave] of LEAVE.entries()) {
    const from = addDays(TODAY, leave.from)
    const to = addDays(TODAY, leave.to)
    const decided = leave.status !== 'pending' && leave.status !== 'draft'
    await prisma.leaveRequest.create({
      data: {
        id: `LV-${String(4100 + i).padStart(4, '0')}`,
        staffRef: leave.ref,
        type: leave.type,
        from: utcDate(from),
        to: utcDate(to),
        days: leave.days,
        startAt: 'startAt' in leave ? (leave.startAt as string) : 'morning',
        endAt: 'end_of_day',
        deducts: leave.deducts,
        reason: pick([
          'Family holiday', 'Booked break', 'Medical appointment',
          'Personal matters', 'Wedding', 'Moving house',
        ]),
        status: leave.status,
        submitted: utcDate(addDays(from, -21)),
        decidedAt: decided ? utcDate(addDays(from, -18)) : null,
        decisionNote:
          leave.status === 'rejected'
            ? 'Two of the crew are already off that week — please rebook.'
            : null,
        cancelledAt: leave.status === 'cancelled' ? utcDate(addDays(from, -5)) : null,
        leaveYear: Number(from.slice(0, 4)),
      },
    })
  }
  console.log(`  Leave requests    ${LEAVE.length}`)

  // --- Expenses -----------------------------------------------------------
  const EXPENSES = [
    { ref: 'WR-010', cat: 'travel', merchant: 'LNER', amount: 84.5, vat: 0, status: 'reimbursed', method: 'personal', days: -45 },
    { ref: 'WR-010', cat: 'meals', merchant: 'Greggs', amount: 12.4, vat: 0, status: 'reimbursed', method: 'personal', days: -30 },
    { ref: 'WR-011', cat: 'equipment', merchant: 'Screwfix', amount: 156.0, vat: 26.0, status: 'approved', method: 'company_card', days: -12 },
    { ref: 'WR-011', cat: 'travel', merchant: 'Shell', amount: 68.2, vat: 11.37, status: 'submitted', method: 'company_card', days: -4 },
    { ref: 'WR-012', cat: 'materials', merchant: 'Travis Perkins', amount: 342.9, vat: 57.15, status: 'approved', method: 'company_card', days: -18 },
    { ref: 'WR-013', cat: 'other', merchant: 'Royal Mail', amount: 9.6, vat: 0, status: 'rejected', method: 'personal', days: -22 },
    { ref: 'WR-020', cat: 'training', merchant: 'Rail Skills Academy', amount: 480.0, vat: 96.0, status: 'reimbursed', method: 'personal', days: -70 },
    { ref: 'WR-020', cat: 'travel', merchant: 'Trainline', amount: 121.3, vat: 0, status: 'submitted', method: 'personal', days: -2 },
    { ref: 'WR-021', cat: 'equipment', merchant: 'Arco Safety', amount: 210.0, vat: 35.0, status: 'reconciled', method: 'company_card', days: -95 },
    { ref: 'WR-022', cat: 'meals', merchant: 'Costa', amount: 7.85, vat: 0, status: 'submitted', method: 'personal', days: -1 },
    { ref: 'WR-030', cat: 'travel', merchant: 'Avanti West Coast', amount: 96.0, vat: 0, status: 'approved', method: 'personal', days: -9 },
    { ref: 'WR-031', cat: 'materials', merchant: 'RS Components', amount: 512.44, vat: 85.4, status: 'rejected', method: 'company_card', days: -25 },
    { ref: 'WR-004', cat: 'travel', merchant: 'Premier Inn', amount: 178.0, vat: 29.66, status: 'reimbursed', method: 'personal', days: -55 },
    { ref: 'WR-005', cat: 'training', merchant: 'Network Rail Training', amount: 650.0, vat: 130.0, status: 'approved', method: 'company_card', days: -33 },
    { ref: 'WR-042', cat: 'travel', merchant: 'Northern Rail', amount: 42.7, vat: 0, status: 'submitted', method: 'personal', days: -6 },
  ] as const

  for (const [i, e] of EXPENSES.entries()) {
    const settled = e.status === 'reimbursed' || e.status === 'reconciled'
    const approved = settled || e.status === 'approved'
    await prisma.expense.create({
      data: {
        id: `EX-${String(4200 + i).padStart(4, '0')}`,
        date: utcDate(addDays(TODAY, e.days)),
        category: e.cat,
        merchant: e.merchant,
        description: `${e.cat === 'travel' ? 'Travel to site' : e.cat === 'meals' ? 'Subsistence' : e.merchant} — ${e.ref}`,
        amountPence: money(e.amount),
        vatPence: money(e.vat),
        staffRef: e.ref,
        jobId: jobIds.get(pick(['JOB-0041', 'JOB-0042', 'JOB-0043'])) ?? null,
        method: e.method,
        status: e.status,
        // A reimbursed claim always carries its approval: the previous data
        // had four reimbursed claims with no approvedAt at all.
        approvedAt: approved ? utcDate(addDays(TODAY, e.days + 3)) : null,
        rejectionReason:
          e.status === 'rejected' ? 'No receipt attached — please resubmit with one.' : null,
        reimbursedAt: settled ? utcDate(addDays(TODAY, e.days + 10)) : null,
        paymentReference: settled ? `BACS-${20000 + i}` : null,
        reconciledAt: e.status === 'reconciled' ? utcDate(addDays(TODAY, e.days + 20)) : null,
      },
    })
  }
  console.log(`  Expenses          ${EXPENSES.length}`)

  // --- Invoices, line items and payments ----------------------------------
  const INVOICES = [
    { ref: 'INV-2041', client: 'Network Rail (Eastern)', job: 'JOB-0041', issued: -80, status: 'paid', lines: [['S&C renewal — weeks 1-4', 20, 2400], ['Plant hire', 8, 650]] },
    { ref: 'INV-2042', client: 'Network Rail (Eastern)', job: 'JOB-0041', issued: -45, status: 'paid', lines: [['S&C renewal — weeks 5-8', 20, 2400]] },
    { ref: 'INV-2043', client: 'Southern Signalling Ltd', job: 'JOB-0042', issued: -38, status: 'partially_paid', lines: [['Resignalling labour — September', 22, 2900], ['Testing & commissioning', 4, 1200]] },
    { ref: 'INV-2044', client: 'Crewe Depot Services', job: 'JOB-0043', issued: -20, status: 'pending', lines: [['OLE refurbishment — phase 1', 12, 3100]] },
    { ref: 'INV-2045', client: 'TransPennine Infrastructure', job: null, issued: -70, status: 'overdue', lines: [['Site survey and design review', 6, 1800]] },
    { ref: 'INV-2046', client: 'Southern Signalling Ltd', job: 'JOB-0042', issued: -5, status: 'pending', lines: [['Resignalling labour — October', 18, 2900]] },
    { ref: 'INV-2047', client: 'Network Rail (Eastern)', job: 'JOB-0041', issued: -1, status: 'draft', lines: [['S&C renewal — weeks 9-12', 20, 2400]] },
    { ref: 'INV-2048', client: 'Crewe Depot Services', job: 'JOB-0043', issued: -12, status: 'draft', lines: [['Additional OLE materials', 1, 4250]] },
    { ref: 'INV-2035', client: 'Midland Permanent Way', job: 'JOB-0039', issued: -380, status: 'written_off', lines: [['PW survey — Derby', 8, 1500]] },
    { ref: 'INV-2036', client: 'TransPennine Infrastructure', job: null, issued: -150, status: 'void', lines: [['Duplicate of INV-2035', 1, 1000]] },
    { ref: 'INV-2037', client: 'Network Rail (Eastern)', job: 'JOB-0038', issued: -170, status: 'paid', lines: [['Wakefield ballast drop', 15, 2100]] },
    { ref: 'INV-2039', client: 'Southern Signalling Ltd', job: null, issued: -110, status: 'overdue', lines: [['Emergency callout — Reading', 3, 2400]] },
  ] as const

  let paymentCount = 0
  let lineCount = 0

  for (const inv of INVOICES) {
    const client = CLIENTS.find((c) => c.name === inv.client)!
    const issued = addDays(TODAY, inv.issued)
    const due = addDays(issued, client.terms)

    const lineInputs = inv.lines.map(([description, qty, unit]) => ({
      description: description as string,
      quantity: qty as number,
      unitPricePence: money(unit as number),
      vatRateBasisPoints: client.vatNumber ? 2000 : 0,
    }))
    const totals = computeInvoiceTotals(lineInputs)

    const invoice = await prisma.invoice.create({
      data: {
        id: inv.ref,
        clientId: clientIds.get(inv.client)!,
        jobId: inv.job ? jobIds.get(inv.job)! : null,
        reference: inv.ref,
        netPence: totals.netPence,
        vatPence: totals.vatPence,
        amountPence: totals.grossPence,
        poNumber: `PO-${40000 + Math.floor(rand() * 9999)}`,
        notes: inv.status === 'written_off' ? 'Client entered administration.' : null,
        issued: utcDate(issued),
        due: utcDate(due),
        status: inv.status,
        // Anything past draft has been sent; this is the field nothing in the
        // application previously wrote, which left every invoice a draft.
        sentAt: inv.status === 'draft' ? null : utcDate(addDays(issued, 1)),
        paidAt: inv.status === 'paid' ? utcDate(addDays(due, -3)) : null,
        voidedAt: inv.status === 'void' ? utcDate(addDays(issued, 2)) : null,
        voidReason: inv.status === 'void' ? 'Raised in error — duplicate.' : null,
      },
    })

    for (const [position, line] of totals.lines.entries()) {
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          description: line.description,
          quantity: line.quantity,
          unitPricePence: line.unitPricePence,
          vatRateBasisPoints: line.vatRateBasisPoints,
          netPence: line.netPence,
          vatPence: line.vatPence,
          position,
        },
      })
      lineCount += 1
    }

    // A paid invoice always has a payment behind it, and a partially paid one
    // has a payment that does not cover the balance.
    if (inv.status === 'paid') {
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amountPence: totals.grossPence,
          receivedOn: utcDate(addDays(due, -3)),
          method: 'bank_transfer',
          reference: `BACS-${inv.ref}`,
        },
      })
      paymentCount += 1
    } else if (inv.status === 'partially_paid') {
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amountPence: Math.round(totals.grossPence * 0.6),
          receivedOn: utcDate(addDays(issued, 20)),
          method: 'bank_transfer',
          reference: `BACS-${inv.ref}-1`,
        },
      })
      paymentCount += 1
    }
  }
  console.log(`  Invoices          ${INVOICES.length} (${lineCount} lines, ${paymentCount} payments)`)

  // --- Payroll ------------------------------------------------------------
  // Three settled months plus the open draft, computed from the attendance
  // seeded above so the figures reconcile with the timesheets.
  const rates = {
    allowancePence: money(12570),
    taxPercent: 20,
    niPercent: 12,
    pensionPercent: 5,
  }

  let payrollCount = 0
  let adjustmentCount = 0

  // Chronological order is load-bearing now that PAYE is cumulative: each
  // period's tax depends on the year-to-date figures of the ones before it.
  // This array used to be [previous, the one before that, current], which was
  // harmless under flat percentages but made every seeded payslip compute its
  // tax from a future period's earnings.
  const oneBack = previousPeriod(THIS_YEAR, THIS_MONTH)
  const twoBack = previousPeriod(oneBack.year, oneBack.month)
  const periods = [
    twoBack,
    oneBack,
    { year: THIS_YEAR, month: THIS_MONTH, label: '' },
  ].sort((a, b) => a.year - b.year || a.month - b.month)

  // Carries cumulative figures forward between periods, keyed by employee and
  // tax year, so cumulative PAYE across the seeded months is consistent.
  const ytdByStaff = new Map<string, YearToDate>()

  for (const [index, period] of periods.entries()) {
    const isOpen = index === periods.length - 1
    const { from, to } = monthBounds(period.year, period.month)

    for (const person of workingStaff) {
      const attendance = await prisma.attendance.findMany({
        where: {
          staffRef: person.ref,
          date: { gte: utcDate(from), lt: utcDate(addDays(to, 1)) },
          timesheet: { status: { in: ['approved', 'locked'] } },
        },
        select: { date: true, code: true },
      })
      if (attendance.length === 0) continue

      const daysWorked = payableDaysFrom(
        attendance.map((a) => ({
          date: a.date.toISOString().slice(0, 10),
          code: a.code,
        }))
      )
      const dayRatePence = money(person.dayRate)
      const baseGrossPence = computeBaseGross(daysWorked, dayRatePence)

      // Historical payslips are produced by the real HMRC engine, using the
      // arrangement in force at the time, so seeded figures agree with what a
      // fresh run would compute. Employees with no code or no verified bank
      // account are skipped here exactly as payroll would skip them.
      const payDate = utcDate(to)
      const profile = await prisma.staffPayrollProfile.findFirst({
        where: {
          staffRef: person.ref,
          effectiveFrom: { lte: payDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: payDate } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      })
      const bankAccount = await prisma.staffBankAccount.findFirst({
        where: { staffRef: person.ref, isPrimary: true, verifiedAt: { not: null } },
        select: { id: true },
      })
      if (!profile || !bankAccount) continue

      const payFrequency = person.payFrequency ?? 'monthly'
      const taxYearStart = taxYearOfDate(payDate)
      const taxPeriod = taxPeriodOfDate(payDate, payFrequency)
      const ytd = ytdByStaff.get(`${person.ref}:${taxYearStart}`) ?? { ...ZERO_YTD }
      const pensionPence = Math.round(
        (baseGrossPence * Math.round(rates.pensionPercent * 100)) / 10000
      )

      const computed = calculatePay({
        grossPence: baseGrossPence,
        taxCode: profile.taxCode,
        basis: profile.basis,
        niCategory: profile.niCategory,
        payFrequency,
        taxYearStart,
        taxPeriod,
        ytd,
        pensionPence,
        studentLoanPlan: profile.studentLoanPlan,
        postgradLoan: profile.postgradLoan,
      })
      ytdByStaff.set(`${person.ref}:${taxYearStart}`, computed.ytd)

      const record = await prisma.payrollRecord.create({
        data: {
          staffRef: person.ref,
          year: period.year,
          month: period.month,
          baseGrossPence,
          grossPence: computed.grossPence,
          taxablePence: computed.taxablePence,
          taxPence: computed.taxPence,
          niPence: computed.niPence,
          pensionPence: computed.pensionPence,
          studentLoanPence: computed.studentLoanPence,
          postgradLoanPence: computed.postgradLoanPence,
          netPence: computed.netPence,
          taxCode: computed.taxCode,
          taxBasis: computed.basis,
          niCategory: computed.niCategory,
          payFrequency,
          taxYearStart,
          taxPeriod,
          ytdGrossPence: computed.ytd.grossPence,
          ytdTaxablePence: computed.ytd.taxablePence,
          ytdTaxPence: computed.ytd.taxPence,
          ytdNiPence: computed.ytd.niPence,
          ytdPensionPence: computed.ytd.pensionPence,
          bankAccountId: bankAccount.id,
          calculationVersion: computed.calculationVersion,
          dayRatePence,
          daysWorked,
          status: isOpen ? 'draft' : 'paid',
          approvedAt: isOpen ? null : utcDate(`${from.slice(0, 8)}26`),
          lockedAt: isOpen ? null : utcDate(`${from.slice(0, 8)}26`),
          paidOn: isOpen ? null : utcDate(`${from.slice(0, 8)}28`),
          reference: `PR-${period.year}${String(period.month).padStart(2, '0')}-${person.ref}`,
        },
      })
      payrollCount += 1

      // A couple of adjustments so the payslip breakdown has something in it.
      if (!isOpen && (person.ref === 'WR-011' || person.ref === 'WR-020')) {
        const amount = person.ref === 'WR-011' ? money(180) : money(-45)
        await prisma.payrollAdjustment.create({
          data: {
            payrollId: record.id,
            amountPence: amount,
            label: amount > 0 ? 'Standby allowance' : 'Uniform deduction',
            reason:
              amount > 0
                ? 'Two weekend standby call-outs at £90 each.'
                : 'Replacement PPE issued 14th, deducted by agreement.',
            taxable: amount > 0,
            effectiveDate: utcDate(to),
          },
        })
        adjustmentCount += 1

        // Recompute through the HMRC engine, not the old flat-percentage one.
        // Using the latter here overwrote the PAYE figures with approximations
        // and left the record unable to reproduce from its own inputs.
        const adjustedGross = Math.max(0, baseGrossPence + amount)
        const adjustedPension = Math.round(
          (adjustedGross * Math.round(rates.pensionPercent * 100)) / 10000
        )
        const recomputed = calculatePay({
          grossPence: adjustedGross,
          taxCode: profile.taxCode,
          basis: profile.basis,
          niCategory: profile.niCategory,
          payFrequency,
          taxYearStart,
          taxPeriod,
          ytd,
          pensionPence: adjustedPension,
          studentLoanPlan: profile.studentLoanPlan,
          postgradLoan: profile.postgradLoan,
        })
        // The carried-forward total must reflect the adjusted figures, or the
        // next period's cumulative tax starts from the wrong place.
        ytdByStaff.set(`${person.ref}:${taxYearStart}`, recomputed.ytd)

        await prisma.payrollRecord.update({
          where: { id: record.id },
          data: {
            grossPence: recomputed.grossPence,
            taxablePence: recomputed.taxablePence,
            taxPence: recomputed.taxPence,
            niPence: recomputed.niPence,
            pensionPence: recomputed.pensionPence,
            studentLoanPence: recomputed.studentLoanPence,
            postgradLoanPence: recomputed.postgradLoanPence,
            netPence: recomputed.netPence,
            ytdGrossPence: recomputed.ytd.grossPence,
            ytdTaxablePence: recomputed.ytd.taxablePence,
            ytdTaxPence: recomputed.ytd.taxPence,
            ytdNiPence: recomputed.ytd.niPence,
            ytdPensionPence: recomputed.ytd.pensionPence,
          },
        })
      }
    }
  }
  console.log(`  Payroll           ${payrollCount} records, ${adjustmentCount} adjustments`)

  // --- Notifications ------------------------------------------------------
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } })
  const byEmail = new Map(users.map((u) => [u.email, u]))

  const NOTIFICATIONS = [
    { email: 'gareth.lloyd@workarail.test', type: 'leave_submitted', title: 'Callum Fraser requested 5 days annual leave', body: 'Awaiting your approval.', url: '/admin/leaves', read: false, days: -2 },
    { email: 'gareth.lloyd@workarail.test', type: 'expense_submitted', title: 'Callum Fraser submitted a £68.20 claim', body: 'Fuel — Shell. Awaiting approval.', url: '/admin/expenses', read: false, days: -4 },
    { email: 'marta.kowalczyk@workarail.test', type: 'timesheet_submitted', title: 'Rhys Bevan submitted their timesheet', body: 'Week beginning Monday. Awaiting approval.', url: '/admin/timesheets', read: true, days: -6 },
    { email: 'tomasz.nowak@workarail.test', type: 'payslip_available', title: 'Your payslip is available', body: 'Your most recent payslip has been published.', url: '/crew/payslips', read: false, days: -3 },
    { email: 'chen.wei@workarail.test', type: 'leave_decided', title: 'Your leave request was approved', body: 'Unpaid leave approved.', url: '/crew/leave', read: true, days: -8 },
    { email: 'leah.donnelly@workarail.test', type: 'leave_decided', title: 'Your leave request was declined', body: 'Two of the crew are already off that week.', url: '/crew/leave', read: false, days: -5 },
    { email: 'ade.balogun@workarail.test', type: 'document_expiring', title: 'Your PTS card has expired', body: 'You cannot be booked onto site until it is renewed.', url: '/crew/documents', read: false, days: -20 },
    { email: 'kirsty.muir@workarail.test', type: 'document_expiring', title: 'PTS expires in 25 days', body: 'Please arrange renewal.', url: '/crew/documents', read: false, days: -1 },
    { email: 'daniel.okafor@workarail.test', type: 'payment_received', title: 'Payment received', body: '£57,600.00 received against invoice INV-2042.', url: '/finance/invoices', read: true, days: -14 },
    { email: 'daniel.okafor@workarail.test', type: 'invoice_overdue', title: 'Invoice INV-2045 is 25 days overdue', body: 'This invoice has passed its due date.', url: '/finance/invoices', read: false, days: -1 },
  ] as const

  for (const n of NOTIFICATIONS) {
    const user = byEmail.get(n.email)
    if (!user) continue
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: n.type,
        title: n.title,
        body: n.body,
        actionUrl: n.url,
        readAt: n.read ? utcDate(addDays(TODAY, n.days + 1)) : null,
        createdAt: utcDate(addDays(TODAY, n.days)),
      },
    })
  }
  console.log(`  Notifications     ${NOTIFICATIONS.length}`)

  // --- Audit trail --------------------------------------------------------
  const admin = byEmail.get('priya.raman@workarail.test')!
  const finance = byEmail.get('daniel.okafor@workarail.test')!

  const AUDIT = [
    { user: admin, action: 'login', entity: 'User', id: admin.id, summary: 'Signed in', days: -1 },
    { user: admin, action: 'create', entity: 'Staff', id: 'WR-040', summary: 'Created employee Jamie Iqbal (Track Operative)', days: -7 },
    { user: admin, action: 'suspend', entity: 'Staff', id: 'WR-041', summary: 'Suspended Dean Harper: Under investigation following a near-miss report', days: -12 },
    { user: admin, action: 'role_change', entity: 'User', id: byEmail.get('marta.kowalczyk@workarail.test')!.id, summary: 'marta.kowalczyk@workarail.test: CREW → MANAGER (promoted to supervisor)', days: -60 },
    { user: finance, action: 'payment', entity: 'Invoice', id: 'INV-2042', summary: 'Recorded £57,600.00 against INV-2042', days: -14 },
    { user: finance, action: 'write_off', entity: 'Invoice', id: 'INV-2035', summary: 'Wrote off INV-2035 — client entered administration', days: -30 },
    { user: finance, action: 'issue', entity: 'Invoice', id: 'INV-2046', summary: 'Issued INV-2046 to Southern Signalling Ltd', days: -5 },
    { user: admin, action: 'settings_change', entity: 'Setting', id: 'organisation', summary: 'Updated leaveDays, carryOver', days: -90 },
  ] as const

  for (const a of AUDIT) {
    await prisma.auditLog.create({
      data: {
        actorUserId: a.user.id,
        actorEmail: a.user.email,
        action: a.action,
        entity: a.entity,
        entityId: a.id,
        summary: a.summary,
        ipAddress: '127.0.0.1',
        createdAt: utcDate(addDays(TODAY, a.days)),
      },
    })
  }
  console.log(`  Audit entries     ${AUDIT.length}`)

  console.log('\nSeed complete.\n')
  console.log('  Sign in with any of these — all share the same password:\n')
  console.log(`    ADMIN     priya.raman@workarail.test`)
  console.log(`    FINANCE   daniel.okafor@workarail.test`)
  console.log(`    MANAGER   gareth.lloyd@workarail.test   (Track Renewals North)`)
  console.log(`    MANAGER   marta.kowalczyk@workarail.test (Signalling South)`)
  console.log(`    CREW      tomasz.nowak@workarail.test`)
  console.log(`\n    Password  ${DEV_PASSWORD}\n`)
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err.message ?? err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
