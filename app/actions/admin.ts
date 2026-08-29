'use server'

/**
 * Administrative Server Actions.
 *
 * Every exported mutation in this file independently authenticates and
 * authorizes its caller. None of them relies on the /admin layout, on a
 * hidden button, or on a disabled control: those are presentation, and a
 * Server Action can be invoked directly regardless of what the UI renders.
 *
 * The shape of a privileged action here is always the same:
 *
 *   guard  ->  validate  ->  transaction (mutate + audit)  ->  notify  ->  revalidate
 *
 * Notifications are dispatched after the transaction commits, so nothing is
 * ever announced that later rolls back.
 */

import { revalidatePath } from 'next/cache'
import crypto from 'crypto'

import { prisma } from '@/app/lib/prisma'
import { onboardingStatus, canBecome } from '@/app/lib/onboarding'
import { prepareBankAccount } from '@/app/lib/bank'
import { auth } from '@/app/lib/auth'
import { headers } from 'next/headers'
import {
  requireActor,
  requireAdmin,
  requireApprover,
  requireFinance,
  requireStaffAccess,
  visibleStaffRefs,
} from '@/app/lib/authz'
import {
  businessToday,
  dayRange,
  fromStoredDate,
  currentPeriod,
  leaveYearBounds,
  leaveYearOf,
  startOfWeek,
  utcDate,
  weekDays,
} from '@/app/lib/dates'
import { recordAudit } from '@/app/lib/audit'
import { notify } from '@/app/lib/notifications'
import {
  actionFailed,
  actionOk,
  AppError,
  BadRequest,
  Conflict,
  NotFound,
  type ActionResult,
} from '@/app/lib/errors'
import {
  getSettings as readSettings,
  updateSettings,
  type AppSettings,
} from '@/app/lib/settings'
import {
  attendanceEntrySchema,
  createInvoiceSchema,
  createLeaveSchema,
  createStaffSchema,
  crewSchema,
  expenseDecisionSchema,
  expenseSchema,
  leaveDecisionSchema,
  offboardStaffSchema,
  parseOrThrow,
  payrollAdjustmentSchema,
  recordPaymentSchema,
  settingsPatchSchema,
  voidInvoiceSchema,
} from '@/app/lib/validation'
import {
  computeInvoiceTotals,
  deriveInvoiceStatus,
  formatMoney,
  summarisePayments,
} from '@/app/lib/invoices'
import { recomputeWithAdjustments, hoursFor } from '@/app/lib/payroll'
import {
  LEAVE_POLICY,
  computeLeave,
  entitlementFor,
  workingPatternFrom,
  type EndAt,
  type StartAt,
} from '@/app/lib/leave'
import { forRegion, getHolidays } from '@/app/lib/holidays'
import type {
  ActivityRow,
  DayHours,
  Expense,
  Invoice,
  LeaveRequest,
  MonthPoint,
  PayrollRecord,
  Stat,
  StaffMember,
} from '@/app/lib/admin-data'

/**
 * The holiday table leave deductions are measured against. The region matters:
 * most UK bank holidays are not nationwide, so filtering to global-only
 * holidays would silently charge staff for bank holidays.
 */
const LEAVE_HOLIDAY_COUNTRY = 'GB'
const LEAVE_HOLIDAY_REGION = 'GB-ENG'

// --- date helpers -----------------------------------------------------------
//
// The local copies that used to live here are gone. Date handling is now in
// app/lib/dates.ts, which resolves "today" in Europe/London rather than UTC —
// the source of a family of off-by-one-day bugs during British Summer Time.
// `toIsoDateString` is kept as a thin alias because it is used throughout
// this file to read a stored date-only column back out.

const toIsoDateString = fromStoredDate

/**
 * The full-time week entitlement is pro-rated against. Matches the schema
 * default for `Staff.weeklyHours`.
 */
const FULL_TIME_WEEKLY_HOURS = 37.5

/**
 * The pay period the office screens default to.
 *
 * Derived in business time. Reading `getUTCMonth()` meant that between
 * midnight and 01:00 on the 1st during BST the whole application reported the
 * *previous* month — and `PayrollRecord.reference` was built from it, so an
 * onboarding on that boundary produced a reference for the wrong period which
 * the `@@unique([staffRef, year, month])` constraint then made uncorrectable.
 */
export async function getRequestPayPeriod() {
  return currentPeriod()
}

/** Collision-resistant identifiers. Math.random() is not used for any id. */
function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

// --- settings ---------------------------------------------------------------

/**
 * Client-safe settings. Contains no secret values — the SMTP password is
 * never returned, only a flag saying whether one is stored.
 */
/**
 * Server Actions are callable by anyone who can reach the app, so this needs
 * its own check rather than relying on the admin page that renders it. The
 * settings include the SMTP host and username.
 *
 * Server-internal callers use `readSettings` from app/lib/settings directly and
 * deliberately do not go through here.
 */
export async function getSettings(): Promise<AppSettings> {
  await requireAdmin()
  return readSettings()
}

export async function saveSettings(
  patch: unknown
): Promise<ActionResult<AppSettings>> {
  try {
    const actor = await requireAdmin()
    const parsed = parseOrThrow(settingsPatchSchema, patch)

    const before = await readSettings()
    const after = await updateSettings(parsed, actor.user.id)

    await recordAudit({
      actor,
      action: 'settings_change',
      entity: 'Setting',
      entityId: 'organisation',
      summary: `Updated ${Object.keys(parsed).join(', ')}`,
      before,
      after,
    })

    revalidatePath('/admin/settings')
    return actionOk(after)
  } catch (err) {
    return actionFailed(err, 'saveSettings')
  }
}

async function payrollRates() {
  const s = await readSettings()
  return {
    allowancePence: s.allowancePence,
    taxPercent: s.tax,
    niPercent: s.ni,
    pensionPercent: s.pension,
  }
}

// --- staff ------------------------------------------------------------------

/**
 * Roster for the office screens.
 *
 * Sensitive payroll-identity fields are never included here; they are only
 * available through the individual employee record, to a caller entitled to
 * see them.
 */
export async function getStaff(week?: string[]): Promise<StaffMember[]> {
  const actor = await requireApprover()

  const activeWeek = week ?? weekDays(businessToday())
  const settings = await readSettings()

  // A MANAGER sees their own crew and reports, not the whole company. This
  // scope was applied in getLeaveRequests and getExpenses and nowhere else,
  // so the roster — with every employee's email and phone number — was
  // returned in full to any manager.
  const visible = await visibleStaffRefs(actor)

  const dbStaff = await prisma.staff.findMany({
    where: {
      deletedAt: null,
      employmentStatus: { notIn: ['archived'] },
      ...(visible === null ? {} : { ref: { in: visible } }),
    },
    select: {
      ref: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      availability: true,
      employmentStatus: true,
      joined: true,
      birthday: true,
      weeklyHours: true,
      crew: { select: { name: true } },
      currentJob: { select: { reference: true, title: true } },
      attendance: {
        where: { date: dayRange(activeWeek[0], activeWeek[6]) },
        select: { date: true, code: true, hours: true },
      },
    },
    orderBy: { ref: 'asc' },
  })

  return dbStaff.map((p) => {
    const hoursThisWeek = activeWeek.reduce((total, dayStr) => {
      const match = p.attendance.find((a) => toIsoDateString(a.date) === dayStr)
      if (!match) return total
      return total + (match.hours ?? hoursFor(match.code))
    }, 0)

    // Utilisation is measured against the employee's contracted hours rather
    // than a hardcoded 45-hour week, which was wrong for part-time staff.
    const target = p.weeklyHours || settings.standardDay * 5
    const utilization = target > 0 ? Math.round((hoursThisWeek / target) * 100) : 0

    return {
      ref: p.ref,
      name: p.name,
      email: p.email,
      phone: p.phone,
      role: p.role,
      crew: p.crew?.name ?? '',
      currentJob: p.currentJob
        ? `${p.currentJob.reference} · ${p.currentJob.title}`
        : null,
      status: p.availability.replace('_', '-') as StaffMember['status'],
      employmentStatus: p.employmentStatus,
      hoursThisWeek,
      utilization,
      joined: toIsoDateString(p.joined),
      birthday: p.birthday ?? '',
    } as StaffMember
  })
}

/**
 * Creates an employee and their login.
 *
 * All database writes are one transaction. Previously a failure part-way
 * through left an orphaned User and Account with no Staff row — which, under
 * the old "no staff row means administrator" rule, silently created an admin.
 * The invitation email is sent only after the transaction commits.
 */
export async function addStaffMember(input: unknown): Promise<ActionResult<{ ref: string }>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(createStaffSchema, input)

    if (data.crewId) {
      const crew = await prisma.crew.findUnique({ where: { id: data.crewId } })
      if (!crew) throw BadRequest('That crew no longer exists.')
    }

    const existingStaff = await prisma.staff.findFirst({
      where: { OR: [{ ref: data.ref }, { email: data.email }] },
      select: { ref: true },
    })
    if (existingStaff) {
      throw Conflict('An employee with that reference or email already exists.')
    }

    // An employee may not be created straight into `active` without the
    // evidence that makes employing them lawful. Previously any record could
    // be marked active immediately, which read as "checked and cleared" on
    // every screen while nothing had been checked at all.
    if (data.employmentStatus === 'active') {
      const documentKinds = (data.documents ?? []).map((d) => d.kind)
      const gate = canBecome(
        'active',
        onboardingStatus({
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          addressLine1: data.addressLine1 ?? null,
          addressPostcode: data.addressPostcode ?? null,
          emergencyContactName: data.emergencyContactName ?? null,
          emergencyContactPhone: data.emergencyContactPhone ?? null,
          niNumber: data.niNumber || null,
          dayRatePence: data.dayRatePence ?? null,
          hasTaxCode: Boolean(data.taxCode),
          hasVerifiedBankAccount: false,
          validDocumentKinds: documentKinds,
        })
      )
      if (!gate.allowed) throw BadRequest(gate.reason!)
    }

    // No pay period is resolved here any more: onboarding no longer writes an
    // opening payroll record, so there is nothing for it to belong to.
    const randomPassword = crypto.randomBytes(32).toString('base64url')
    const passwordHash = await hashPassword(randomPassword)

    const created = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: data.email } })

      if (!user) {
        user = await tx.user.create({
          data: {
            email: data.email,
            name: data.name,
            emailVerified: false,
            // Employees are the least-privileged role. Nothing about being a
            // staff member confers administrative access any more.
            role: 'CREW',
          },
        })
        await tx.account.create({
          data: {
            userId: user.id,
            accountId: user.id,
            providerId: 'credential',
            password: passwordHash,
          },
        })
      }

      const staff = await tx.staff.create({
        data: {
          ref: data.ref,
          name: data.name,
          email: data.email,
          phone: data.phone ?? '',
          role: data.role,
          crewId: data.crewId ?? null,
          availability: data.availability,
          employmentStatus: data.employmentStatus,
          contractType: data.contractType,
          jobTitle: data.jobTitle || null,
          joined: utcDate(data.joined),
          probationEndDate: data.probationEndDate
            ? utcDate(data.probationEndDate)
            : null,
          birthday: data.birthday ?? null,
          dateOfBirth: data.dateOfBirth ? utcDate(data.dateOfBirth) : null,
          preferredName: data.preferredName || null,
          personalEmail: data.personalEmail || null,
          personalPhone: data.personalPhone || null,
          gender: data.gender,
          nationality: data.nationality || null,
          addressCountry: data.addressCountry || 'United Kingdom',
          internalNotes: data.internalNotes || null,
          payFrequency: data.payFrequency,
          weeklyHours: data.weeklyHours,
          dayRatePence: data.dayRatePence ?? null,
          annualLeaveDays: data.annualLeaveDays ?? null,
          carryOverDays: data.carryOverDays,
          managerRef: data.managerRef ?? null,
          addressLine1: data.addressLine1 || null,
          addressLine2: data.addressLine2 || null,
          addressCity: data.addressCity || null,
          addressPostcode: data.addressPostcode || null,
          emergencyContactName: data.emergencyContactName || null,
          emergencyContactPhone: data.emergencyContactPhone || null,
          emergencyContactRelation: data.emergencyContactRelation || null,
          niNumber: data.niNumber ? data.niNumber.toUpperCase() : null,
          userId: user.id,
        },
      })

      // The PAYE arrangement is a dated record, not a column, so that a later
      // coding notice supersedes it instead of overwriting the basis an
      // already-issued payslip was calculated on. A starter without a P45 has
      // no code yet; payroll will refuse to pay them until one is entered,
      // which is the correct outcome rather than assuming 1257L.
      if (data.taxCode) {
        await tx.staffPayrollProfile.create({
          data: {
            staffRef: staff.ref,
            taxCode: data.taxCode.toUpperCase(),
            basis: data.taxBasis,
            niCategory: data.niCategory,
            studentLoanPlan: data.studentLoanPlan ?? null,
            postgradLoan: data.postgradLoan,
            effectiveFrom: utcDate(data.joined),
            source: 'onboarding',
            createdById: actor.user.id,
          },
        })
      }

      if (data.dayRatePence) {
        await tx.staffPayRate.create({
          data: {
            staffRef: staff.ref,
            dayRatePence: data.dayRatePence,
            effectiveFrom: utcDate(data.joined),
            createdById: actor.user.id,
          },
        })
      }

      // Bank details are always created unverified, whoever entered them.
      // Verification is a separate action by a different person — that
      // separation is the control against someone redirecting salary.
      if (data.bank) {
        const prepared = prepareBankAccount({
          method: data.bank.method,
          accountNumber: data.bank.accountNumber,
          sortCode: data.bank.sortCode,
          iban: data.bank.iban,
          bic: data.bank.bic,
        })
        await tx.staffBankAccount.create({
          data: {
            staffRef: staff.ref,
            accountHolderName: data.bank.accountHolderName,
            bankName: data.bank.bankName ?? null,
            method: data.bank.method,
            ...prepared,
            isPrimary: true,
            effectiveFrom: utcDate(data.joined),
            createdById: actor.user.id,
          },
        })
      }

      for (const doc of data.documents ?? []) {
        // The bytes are already stored; only the key travels with the form.
        // Upserting on the key means re-submitting the same file does not
        // orphan the previous Attachment row.
        const attachment = await tx.attachment.upsert({
          where: { storageKey: doc.attachment.storageKey },
          create: {
            name: doc.attachment.name,
            kind: doc.attachment.kind,
            mimeType: doc.attachment.mimeType,
            sizeBytes: doc.attachment.sizeBytes,
            storageKey: doc.attachment.storageKey,
            uploadedById: actor.user.id,
          },
          update: {},
        })
        await tx.staffDocument.create({
          data: {
            staffRef: staff.ref,
            kind: doc.kind,
            reference: doc.reference ?? null,
            // Uploaded, not yet checked. Someone has to look at it before it
            // counts as evidence of anything.
            status: 'pending_review',
            issuedOn: doc.issuedOn ? utcDate(doc.issuedOn) : null,
            expiresOn: doc.expiresOn ? utcDate(doc.expiresOn) : null,
            attachmentId: attachment.id,
            uploadedById: actor.user.id,
          },
        })
      }

      // No opening payroll record is created here any more. A zero-valued
      // draft row was written at onboarding and then never recalculated,
      // which is why every payroll figure in the product was structurally
      // zero. Payroll is now produced by `runPayroll`, from approved
      // attendance and the effective-dated rate.

      await recordAudit(
        {
          actor,
          action: 'create',
          entity: 'Staff',
          entityId: staff.ref,
          // Narrow snapshot. Passing the whole created row put the employee's
          // tax code, date of birth, home address and emergency contact
          // numbers into a JSON column queryable by anything with database
          // access. (recordAudit scrubs these too, but the audit payload
          // should not have contained them in the first place.)
          summary: `Created employee ${staff.name} (${staff.role})`,
          after: {
            ref: staff.ref,
            name: staff.name,
            email: staff.email,
            role: staff.role,
            employmentStatus: staff.employmentStatus,
            contractType: staff.contractType,
            crewId: staff.crewId,
            managerRef: staff.managerRef,
            joined: fromStoredDate(staff.joined),
          },
        },
        tx
      )

      return { staff, userId: user.id }
    })

    // External side effect, deliberately outside the transaction.
    try {
      await auth.api.requestPasswordReset({
        body: { email: data.email },
        headers: await headers(),
      })
    } catch (inviteErr) {
      console.error('[staff] invitation email could not be sent', {
        email: data.email,
        inviteErr,
      })
    }

    revalidatePath('/admin/crews')
    revalidatePath('/admin/dashboard')
    return actionOk({ ref: created.staff.ref })
  } catch (err) {
    return actionFailed(err, 'addStaffMember')
  }
}

/**
 * Offboards an employee.
 *
 * Deliberately not a delete: attendance, payroll, invoices and approvals must
 * survive somebody leaving. The record is marked as a leaver, unassigned from
 * live work, and their login is deactivated and its sessions revoked.
 */
export async function offboardStaff(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(offboardStaffSchema, input)

    const staff = await prisma.staff.findUnique({ where: { ref: data.ref } })
    if (!staff) throw NotFound('No such employee.')
    if (staff.employmentStatus === 'leaver' || staff.employmentStatus === 'archived') {
      throw Conflict('That employee has already been offboarded.')
    }

    const outstanding = await prisma.expense.count({
      where: { staffRef: data.ref, status: { in: ['submitted', 'approved'] } },
    })

    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { ref: data.ref },
        data: {
          employmentStatus: 'leaver',
          endDate: utcDate(data.endDate),
          leaverReason: data.reason,
          availability: 'off_shift',
          currentJobId: null,
        },
      })

      // Future-dated leave is cancelled; leave already taken is history.
      await tx.leaveRequest.updateMany({
        where: {
          staffRef: data.ref,
          status: { in: ['pending', 'approved'] },
          from: { gt: utcDate(data.endDate) },
        },
        data: { status: 'cancelled', cancelledAt: new Date() },
      })

      if (data.revokeAccess && staff.userId) {
        await tx.user.update({
          where: { id: staff.userId },
          data: { isActive: false },
        })
        await tx.session.deleteMany({ where: { userId: staff.userId } })
      }

      await recordAudit(
        {
          actor,
          action: 'offboard',
          entity: 'Staff',
          entityId: data.ref,
          summary: `Offboarded ${staff.name}, leaving ${data.endDate}: ${data.reason}`,
          before: staff,
          after: { employmentStatus: 'leaver', endDate: data.endDate },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return outstanding > 0
      ? actionOk(undefined)
      : actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'offboardStaff')
  }
}

export async function updateStaffDates(
  ref: string,
  birthday: string | null,
  joined: string | null
): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireAdmin()

    if (birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) {
      throw BadRequest('Enter the birthday as MM-DD.')
    }
    if (joined && !/^\d{4}-\d{2}-\d{2}$/.test(joined)) {
      throw BadRequest('Enter the start date as YYYY-MM-DD.')
    }

    const before = await prisma.staff.findUnique({ where: { ref } })
    if (!before) throw NotFound('No such employee.')

    // A cleared start date used to be stored as 1970-01-01, producing a
    // fifty-year work anniversary. Leaving it unchanged is the honest answer.
    await prisma.staff.update({
      where: { ref },
      data: {
        birthday: birthday || null,
        ...(joined ? { joined: utcDate(joined) } : {}),
      },
    })

    await recordAudit({
      actor,
      action: 'update',
      entity: 'Staff',
      entityId: ref,
      summary: 'Updated celebration dates',
      before: { birthday: before.birthday, joined: before.joined },
      after: { birthday, joined },
    })

    revalidatePath('/admin/celebrations')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'updateStaffDates')
  }
}

async function hashPassword(plain: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(plain, salt, 64, (err, derivedKey) => {
      if (err) return reject(err)
      resolve(`${salt}:${derivedKey.toString('hex')}`)
    })
  })
}

// --- crews ------------------------------------------------------------------

export async function getCrews() {
  await requireApprover()
  return prisma.crew.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, site: true },
  })
}

export async function addCrew(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireAdmin()
    const raw = typeof input === 'string' ? { name: input } : input
    const data = parseOrThrow(crewSchema, raw)

    const nameKey = data.name.toLowerCase()
    const clash = await prisma.crew.findUnique({ where: { nameKey } })
    if (clash) throw Conflict('A crew with that name already exists.')

    const crew = await prisma.crew.create({
      data: {
        name: data.name,
        nameKey,
        site: data.site || null,
        supervisorRef: data.supervisorRef ?? null,
      },
    })

    await recordAudit({
      actor,
      action: 'create',
      entity: 'Crew',
      entityId: crew.id,
      summary: `Created crew ${crew.name}`,
      after: crew,
    })

    revalidatePath('/admin/crews')
    return actionOk({ id: crew.id })
  } catch (err) {
    return actionFailed(err, 'addCrew')
  }
}

// --- attendance and timesheets ----------------------------------------------

export async function getTimesheetData(weekOf?: string) {
  await requireApprover()

  const today = businessToday()
  const week = weekDays(weekOf ?? today)
  // getStaff applies the caller's scope, so the roster here is already
  // limited to the people this actor may see; the attendance query below
  // must be limited to the same set rather than reading every row.
  const staffMembers = await getStaff(week)
  const refs = staffMembers.map((s) => s.ref)

  const dbAttendance = await prisma.attendance.findMany({
    where: { staffRef: { in: refs }, date: dayRange(week[0], week[6]) },
    select: { staffRef: true, date: true, code: true },
  })

  const timesheets = await prisma.timesheet.findMany({
    where: { staffRef: { in: refs }, weekStart: utcDate(week[0]) },
    select: {
      id: true,
      staffRef: true,
      status: true,
      submittedAt: true,
      rejectionReason: true,
    },
  })

  const byStaff = new Map<string, Map<string, string>>()
  for (const a of dbAttendance) {
    if (!byStaff.has(a.staffRef)) byStaff.set(a.staffRef, new Map())
    byStaff.get(a.staffRef)!.set(toIsoDateString(a.date), a.code)
  }

  const attendancePatterns: Record<string, string> = {}
  for (const p of staffMembers) {
    const days = byStaff.get(p.ref)
    attendancePatterns[p.ref] = week.map((d) => days?.get(d) ?? '-').join('')
  }

  return {
    staff: staffMembers,
    attendancePatterns,
    week,
    today,
    /**
     * Approval state per employee for this week. The admin timesheet screen
     * previously rendered a read-only grid with no way to see or action a
     * submitted week, so `decideTimesheet` existed with no caller and
     * TimesheetStatus.approved was unreachable.
     */
    timesheets: timesheets.map((t) => ({
      id: t.id,
      staffRef: t.staffRef,
      status: t.status,
      submittedAt: t.submittedAt?.toISOString() ?? null,
      rejectionReason: t.rejectionReason,
    })),
  }
}

/** Guards against a fat-fingered date range writing thousands of rows. */
const MAX_ATTENDANCE_WRITES = 500

function daysBetweenInclusive(from: string, to: string): Date[] {
  const days: Date[] = []
  const end = utcDate(to).getTime()
  for (let t = utcDate(from).getTime(); t <= end; t += 86_400_000) {
    days.push(new Date(t))
  }
  return days
}

export type AttendanceEntryInput = {
  staffRefs: string[]
  from: string
  to: string
  code: string
  includeWeekends?: boolean
  overwrite?: boolean
}

/**
 * Records attendance for any number of people over a day or a range.
 *
 * Refuses to touch weeks whose timesheet has been approved and locked, so a
 * bulk edit cannot silently rewrite figures payroll has already consumed.
 */
export async function saveAttendanceEntries(input: AttendanceEntryInput) {
  try {
    const actor = await requireApprover()
    const data = parseOrThrow(attendanceEntrySchema, input)

    const refs = Array.from(new Set(data.staffRefs))

    // A manager may only record attendance for people they are responsible for.
    for (const ref of refs) {
      await requireStaffAccess(ref, actor)
    }

    const known = await prisma.staff.findMany({
      where: { ref: { in: refs }, deletedAt: null },
      select: { ref: true },
    })
    if (known.length !== refs.length) {
      const missing = refs.filter((r) => !known.some((s) => s.ref === r))
      return { error: `No such employee: ${missing.join(', ')}.` }
    }

    const allDays = daysBetweenInclusive(data.from, data.to)
    const days = data.includeWeekends
      ? allDays
      : allDays.filter((d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6)

    if (days.length === 0) {
      return {
        error: 'That range only covers a weekend. Tick “include weekends” to record it.',
      }
    }
    if (days.length * refs.length > MAX_ATTENDANCE_WRITES) {
      return {
        error: `That would write ${days.length * refs.length} entries — narrow the range or pick fewer people.`,
      }
    }

    // Which *weeks* the edited days fall in. The previous predicate filtered
    // `weekStart: dayRange(from, to)`, i.e. it only found timesheets whose
    // Monday fell inside the edited range — so editing Wednesday to Thursday
    // of a locked week matched nothing and silently overwrote attendance that
    // had already been approved and consumed by payroll.
    const affectedWeekStarts = Array.from(
      new Set(days.map((d) => startOfWeek(fromStoredDate(d))))
    ).map(utcDate)

    const locked = await prisma.timesheet.findMany({
      where: {
        staffRef: { in: refs },
        status: { in: ['approved', 'locked'] },
        weekStart: { in: affectedWeekStarts },
      },
      select: { staffRef: true, weekStart: true },
    })
    if (locked.length > 0) {
      const week = fromStoredDate(locked[0].weekStart)
      return {
        error: `The week beginning ${week} is approved and locked for ${locked[0].staffRef}. Reopen that timesheet before editing it.`,
      }
    }

    const existing = await prisma.attendance.findMany({
      where: { staffRef: { in: refs }, date: { in: days } },
      select: { staffRef: true, date: true },
    })
    const taken = new Set(
      existing.map((e) => `${e.staffRef}|${toIsoDateString(e.date)}`)
    )

    let created = 0
    let updated = 0
    let skipped = 0
    const writes = []

    for (const staffRef of refs) {
      for (const date of days) {
        const isTaken = taken.has(`${staffRef}|${toIsoDateString(date)}`)
        if (isTaken && !data.overwrite) {
          skipped += 1
          continue
        }
        if (isTaken) updated += 1
        else created += 1
        writes.push(
          prisma.attendance.upsert({
            where: { staffRef_date: { staffRef, date } },
            update: { code: data.code, source: 'admin' },
            create: { staffRef, date, code: data.code, source: 'admin' },
          })
        )
      }
    }

    await prisma.$transaction(writes)

    await recordAudit({
      actor,
      action: 'update',
      entity: 'Attendance',
      entityId: `${data.from}..${data.to}`,
      summary: `Recorded '${data.code}' for ${refs.length} people over ${days.length} days`,
      after: { refs, from: data.from, to: data.to, code: data.code, created, updated, skipped },
    })

    revalidatePath('/admin/timesheets')
    revalidatePath('/admin/dashboard')

    return {
      ok: true as const,
      created,
      updated,
      skipped,
      days: days.length,
      people: refs.length,
    }
  } catch (err) {
    const failed = actionFailed(err, 'saveAttendanceEntries')
    return { error: failed.error }
  }
}

/** Approve or return a submitted timesheet. Approval locks the week. */
export async function decideTimesheet(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireApprover()
    const { timesheetId, decision, reason } = parseOrThrow(
      (await import('@/app/lib/validation')).timesheetDecisionSchema,
      input
    )

    const sheet = await prisma.timesheet.findUnique({ where: { id: timesheetId } })
    if (!sheet) throw NotFound('That timesheet no longer exists.')
    await requireStaffAccess(sheet.staffRef, actor)

    if (sheet.status !== 'submitted') {
      throw Conflict(`A timesheet can only be decided while submitted (it is ${sheet.status}).`)
    }
    if (decision === 'rejected' && !reason?.trim()) {
      throw BadRequest('Give a reason when returning a timesheet.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.timesheet.update({
        where: { id: timesheetId },
        data: {
          // `approved` was previously unreachable because this wrote `locked`
          // directly, so every consumer had to test for both and one of them
          // (saveAttendanceEntries) tested only for `locked`. Approval and
          // locking are recorded as the distinct facts they are: the sheet is
          // approved, and `lockedAt` says it is closed to editing.
          status: decision === 'approved' ? 'approved' : 'rejected',
          decidedAt: new Date(),
          decidedById: actor.user.id,
          rejectionReason: decision === 'rejected' ? reason!.trim() : null,
          lockedAt: decision === 'approved' ? new Date() : null,
        },
      })
      await recordAudit(
        {
          actor,
          action: decision === 'approved' ? 'approve' : 'reject',
          entity: 'Timesheet',
          entityId: timesheetId,
          summary: `Timesheet for ${sheet.staffRef} ${decision}`,
          before: { status: sheet.status },
          after: { status: decision },
        },
        tx
      )
    })

    await notify.timesheetDecided(
      sheet.staffRef,
      timesheetId,
      decision === 'approved',
      reason
    )

    revalidatePath('/admin/timesheets')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'decideTimesheet')
  }
}

/**
 * Reopens an approved timesheet so a correction can be made.
 *
 * `locked` was previously terminal — the error message in
 * `saveAttendanceEntries` told the operator to "unlock it before editing"
 * and there was no way to do so. Reopening is refused once the week has been
 * consumed by an approved payroll run, because that would change the hours
 * behind a payslip that has already been issued.
 */
export async function reopenTimesheet(
  timesheetId: string,
  reason: string
): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireApprover()
    const trimmed = String(reason ?? '').trim()
    if (trimmed.length < 4) {
      return actionFailed(
        BadRequest('Give a reason for reopening this timesheet.'),
        'reopenTimesheet'
      )
    }

    const sheet = await prisma.timesheet.findUnique({
      where: { id: timesheetId },
      select: { id: true, staffRef: true, status: true, weekStart: true },
    })
    if (!sheet) throw NotFound('That timesheet no longer exists.')
    await requireStaffAccess(sheet.staffRef, actor)

    if (sheet.status !== 'approved' && sheet.status !== 'locked') {
      throw Conflict('Only an approved timesheet can be reopened.')
    }

    // If payroll has already been approved for the month this week falls in,
    // the hours are settled and must not move.
    const weekIso = fromStoredDate(sheet.weekStart)
    const period = { year: Number(weekIso.slice(0, 4)), month: Number(weekIso.slice(5, 7)) }
    const settled = await prisma.payrollRecord.findFirst({
      where: {
        staffRef: sheet.staffRef,
        year: period.year,
        month: period.month,
        status: { in: ['approved', 'paid'] },
      },
      select: { reference: true },
    })
    if (settled) {
      throw Conflict(
        `Payroll run ${settled.reference} has already been approved from this week. Correct it with a payroll adjustment instead.`
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.timesheet.update({
        where: { id: timesheetId },
        data: {
          status: 'submitted',
          lockedAt: null,
          decidedAt: null,
          decidedById: null,
        },
      })
      await recordAudit(
        {
          actor,
          action: 'unlock',
          entity: 'Timesheet',
          entityId: timesheetId,
          summary: `Reopened ${sheet.staffRef}'s week of ${weekIso}: ${trimmed}`,
          before: { status: sheet.status },
          after: { status: 'submitted', reason: trimmed },
        },
        tx
      )
    })

    revalidatePath('/admin/timesheets')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'reopenTimesheet')
  }
}

// --- leave ------------------------------------------------------------------

export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  const actor = await requireApprover()

  // A manager sees only their own crew's requests.
  const scope =
    actor.user.role === 'MANAGER' && actor.staff
      ? {
          staff: {
            OR: [
              { managerRef: actor.staff.ref },
              ...(actor.staff.crewId ? [{ crewId: actor.staff.crewId }] : []),
            ],
          },
        }
      : {}

  const rows = await prisma.leaveRequest.findMany({
    where: scope,
    orderBy: { submitted: 'desc' },
    take: 500,
  })

  return rows.map((r) => ({
    id: r.id,
    staffRef: r.staffRef,
    type: r.type,
    from: toIsoDateString(r.from),
    to: toIsoDateString(r.to),
    days: r.days,
    startAt: r.startAt as 'morning' | 'afternoon',
    endAt: r.endAt as 'lunchtime' | 'end_of_day',
    deducts: r.deducts,
    reason: r.reason,
    status: r.status,
    submitted: toIsoDateString(r.submitted),
  })) as LeaveRequest[]
}

/**
 * Everything the leave dialog needs to price a request before it is sent.
 * Shared by the admin dialog, the crew form and both server paths, so the
 * preview and the stored deduction cannot disagree.
 */
export async function getLeaveContext(forLeaveYear?: number) {
  const actor = await requireActor()

  const settings = await readSettings()
  // The leave year the request belongs to, not "the current calendar year".
  // The balance check previously always read the current year while the
  // request was filed under the year taken from its start date, so a request
  // dated into next January was checked against this year's consumption and
  // then stored against next year — an employee could book their whole next
  // year allowance in December with no balance enforcement at all.
  const year = forLeaveYear ?? leaveYearOf(businessToday())
  const bounds = leaveYearBounds(year)

  const table = (await getHolidays(year, LEAVE_HOLIDAY_COUNTRY)) ?? []
  const next = (await getHolidays(year + 1, LEAVE_HOLIDAY_COUNTRY)) ?? []
  const holidays: Record<string, string> = {}
  for (const h of forRegion([...table, ...next], LEAVE_HOLIDAY_REGION)) {
    holidays[h.date] = h.localName || h.name
  }

  // Balances are personal data, so a manager sees their crew and a crew
  // member sees only themselves. This action was previously guarded only by
  // requireActor and returned every employee's balances and booked dates to
  // anyone signed in.
  const visible = await visibleStaffRefs(actor)
  const staffFilter = visible === null ? {} : { staffRef: { in: visible } }

  const rows = await prisma.leaveRequest.findMany({
    where: {
      status: { in: ['pending', 'approved', 'taken'] },
      leaveYear: year,
      ...staffFilter,
    },
    select: {
      id: true, staffRef: true, days: true, status: true,
      deducts: true, from: true, to: true, type: true,
    },
  })

  const balances: Record<string, { taken: number; pending: number }> = {}
  for (const row of rows) {
    if (!row.deducts) continue
    const entry = (balances[row.staffRef] ??= { taken: 0, pending: 0 })
    if (row.status === 'pending') entry.pending += row.days
    else entry.taken += row.days
  }

  // Entitlement is per employee: pro-rated for part-time hours and for a
  // partial year, with that person's own carry-over.
  const people = await prisma.staff.findMany({
    where: { deletedAt: null, ...(visible === null ? {} : { ref: { in: visible } }) },
    select: {
      ref: true, joined: true, endDate: true, weeklyHours: true,
      annualLeaveDays: true, carryOverDays: true,
    },
  })

  const entitlements: Record<string, number> = {}
  for (const person of people) {
    entitlements[person.ref] = entitlementFor(
      {
        joined: fromStoredDate(person.joined),
        endDate: person.endDate ? fromStoredDate(person.endDate) : null,
        weeklyHours: person.weeklyHours,
        annualLeaveDays: person.annualLeaveDays,
        carryOverDays: person.carryOverDays,
      },
      bounds,
      { leaveDays: settings.leaveDays, fullTimeWeeklyHours: FULL_TIME_WEEKLY_HOURS }
    ).entitlement
  }

  return {
    holidays,
    leaveYear: year,
    leaveYearFrom: bounds.from,
    leaveYearTo: bounds.to,
    workingDaysSetting: settings.workingDays,
    /** Per-employee entitlement. Prefer this over the org default. */
    entitlements,
    /** Organisation default, for an employee with no record of their own. */
    entitlement: settings.leaveDays + settings.carryOver,
    leaveDays: settings.leaveDays,
    carryOver: settings.carryOver,
    balances,
    booked: rows.map((r) => ({
      id: r.id,
      staffRef: r.staffRef,
      type: r.type,
      status: r.status,
      from: toIsoDateString(r.from),
      to: toIsoDateString(r.to),
    })),
  }
}

type CreateLeaveResult =
  | { error: string }
  | { ok: true; id: string; days: number; approved: boolean; name: string }

/**
 * Creates a leave request.
 *
 * The day count is always recalculated here from the dates, the working
 * pattern and the holiday table — the browser's figure is a preview and is
 * never trusted. This is the single authoritative path: the crew form calls
 * it too, so the two can no longer compute different answers.
 */
export async function createLeaveRequest(input: unknown): Promise<CreateLeaveResult> {
  try {
    const actor = await requireActor()
    const data = parseOrThrow(createLeaveSchema, input)

    // Booking on someone else's behalf is an approver action; booking for
    // yourself only requires being an employee.
    const targetRef = data.staffRef ?? actor.staff?.ref
    if (!targetRef) return { error: 'Select an employee.' }

    const bookingForSelf = actor.staff?.ref === targetRef
    if (!bookingForSelf) {
      await requireApprover()
      await requireStaffAccess(targetRef, actor)
    }

    // Only an approver may skip the pending step.
    const approveNow =
      data.approveNow &&
      ['ADMIN', 'FINANCE', 'MANAGER'].includes(actor.user.role) &&
      !bookingForSelf

    const policy = LEAVE_POLICY[data.type]
    if (!policy) return { error: `Unknown leave type "${data.type}".` }

    const staff = await prisma.staff.findUnique({
      where: { ref: targetRef },
      select: { ref: true, name: true, employmentStatus: true },
    })
    if (!staff) return { error: 'Select an employee.' }
    if (staff.employmentStatus === 'leaver' || staff.employmentStatus === 'archived') {
      return { error: `${staff.name} is no longer employed.` }
    }

    // The leave year the request falls in, so the balance is checked against
    // the year the deduction will actually be filed under.
    const leaveYear = leaveYearOf(data.from)
    const context = await getLeaveContext(leaveYear)
    const pattern = workingPatternFrom(context.workingDaysSetting)

    const startAt = policy.halfDays ? (data.startAt as StartAt) : 'morning'
    const endAt = policy.halfDays ? (data.endAt as EndAt) : 'end_of_day'

    const breakdown = computeLeave({
      from: data.from,
      to: data.to,
      startAt,
      endAt,
      pattern,
      holidays: context.holidays,
      allowHalfDays: policy.halfDays,
    })

    if (breakdown.error) return { error: breakdown.error }
    if (breakdown.days <= 0) {
      return { error: 'That request does not cover any working time.' }
    }

    if (policy.deducts) {
      const balance = context.balances[targetRef] ?? { taken: 0, pending: 0 }
      // This employee's own entitlement, pro-rated for their hours and their
      // part of the leave year — not the flat organisation default.
      const entitlement = context.entitlements[targetRef] ?? context.entitlement
      const remaining = entitlement - balance.taken - balance.pending
      if (breakdown.days > remaining) {
        return {
          error: `That is ${breakdown.days} days but only ${remaining} remain of ${staff.name}'s ${leaveYear} allowance.`,
        }
      }
    }

    const id = makeId('LV')

    try {
      await prisma.$transaction(async (tx) => {
        await tx.leaveRequest.create({
          data: {
            id,
            staffRef: targetRef,
            type: data.type,
            from: utcDate(data.from),
            to: utcDate(data.to),
            days: breakdown.days,
            startAt,
            endAt,
            deducts: policy.deducts,
            reason: data.reason?.trim() || policy.label,
            status: approveNow ? 'approved' : 'pending',
            submitted: new Date(),
            decidedAt: approveNow ? new Date() : null,
            decidedById: approveNow ? actor.user.id : null,
            leaveYear,
          },
        })
        await recordAudit(
          {
            actor,
            action: 'create',
            entity: 'LeaveRequest',
            entityId: id,
            summary: `${breakdown.days} day(s) ${data.type} leave for ${staff.name}`,
            after: { from: data.from, to: data.to, days: breakdown.days, approveNow },
          },
          tx
        )
      })
    } catch (dbErr) {
      // The database enforces non-overlap with an exclusion constraint, so
      // two concurrent requests cannot both slip through the check above.
      const code = (dbErr as { code?: string }).code
      if (code === '23P01' || String(dbErr).includes('exclusion constraint')) {
        return { error: `${staff.name} already has leave booked over those dates.` }
      }
      throw dbErr
    }

    if (!approveNow) {
      await notify.leaveSubmitted(targetRef, staff.name, id, breakdown.days)
    }

    revalidatePath('/admin/leaves')
    revalidatePath('/crew/leave')
    revalidatePath('/admin/dashboard')

    return { ok: true, id, days: breakdown.days, approved: approveNow, name: staff.name }
  } catch (err) {
    const failed = actionFailed(err, 'createLeaveRequest')
    return { error: failed.error }
  }
}

/**
 * Approves or rejects a leave request.
 *
 * Enforces the state machine (only a pending request can be decided), records
 * who decided it, and tells the employee — none of which happened before.
 */
export async function decideLeaveRequest(
  id: string,
  decision: 'approved' | 'rejected',
  note?: string
): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireApprover()
    const data = parseOrThrow(leaveDecisionSchema, { id, decision, note })

    const request = await prisma.leaveRequest.findUnique({
      where: { id: data.id },
      include: { staff: { select: { name: true, ref: true } } },
    })
    if (!request) throw NotFound('That leave request no longer exists.')

    await requireStaffAccess(request.staffRef, actor)

    if (request.status !== 'pending') {
      throw Conflict(
        `That request has already been ${request.status} and cannot be changed.`
      )
    }
    // Nobody signs off their own absence.
    if (actor.staff?.ref === request.staffRef) {
      throw new AppError('You cannot decide your own leave request.', 403, 'forbidden')
    }

    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id: data.id },
        data: {
          status: data.decision,
          decidedAt: new Date(),
          decidedById: actor.user.id,
          decisionNote: data.note?.trim() || null,
        },
      })
      await recordAudit(
        {
          actor,
          action: data.decision === 'approved' ? 'approve' : 'reject',
          entity: 'LeaveRequest',
          entityId: data.id,
          summary: `${data.decision} ${request.days} day(s) for ${request.staff.name}`,
          before: { status: request.status },
          after: { status: data.decision, note: data.note },
        },
        tx
      )
    })

    await notify.leaveDecided(
      request.staffRef,
      data.id,
      data.decision === 'approved',
      data.note
    )

    revalidatePath('/admin/leaves')
    revalidatePath('/admin/dashboard')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'decideLeaveRequest')
  }
}

/** Cancels a request. Employees may withdraw their own before it starts. */
export async function cancelLeaveRequest(id: string): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireActor()
    const request = await prisma.leaveRequest.findUnique({ where: { id } })
    if (!request) throw NotFound('That leave request no longer exists.')

    const isOwner = actor.staff?.ref === request.staffRef
    if (!isOwner) {
      await requireApprover()
      await requireStaffAccess(request.staffRef, actor)
    }

    if (!['pending', 'approved'].includes(request.status)) {
      throw Conflict(`A ${request.status} request cannot be cancelled.`)
    }
    // Compared as business dates. Against `new Date()` the self-cancellation
    // window opened and closed an hour early or late during BST, because
    // `from` is a UTC midnight and `now` is a real instant.
    if (isOwner && fromStoredDate(request.from) <= businessToday()) {
      throw Conflict('Leave that has already started must be cancelled by an approver.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      })
      await recordAudit(
        {
          actor,
          action: 'cancel',
          entity: 'LeaveRequest',
          entityId: id,
          before: { status: request.status },
          after: { status: 'cancelled' },
        },
        tx
      )
    })

    revalidatePath('/admin/leaves')
    revalidatePath('/crew/leave')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'cancelLeaveRequest')
  }
}

// --- expenses ---------------------------------------------------------------

export async function getExpenses(): Promise<Expense[]> {
  const actor = await requireApprover()

  const scope =
    actor.user.role === 'MANAGER' && actor.staff
      ? {
          staff: {
            OR: [
              { managerRef: actor.staff.ref },
              ...(actor.staff.crewId ? [{ crewId: actor.staff.crewId }] : []),
            ],
          },
        }
      : {}

  const rows = await prisma.expense.findMany({
    where: scope,
    include: { receipt: true },
    orderBy: { date: 'desc' },
    take: 500,
  })

  return rows.map(toExpenseDto)
}

function toExpenseDto(e: {
  id: string; date: Date; category: string; merchant: string; description: string
  amountPence: number; staffRef: string; method: string; status: string
  receipt: { name: string; kind: string; storageKey: string; sizeBytes: number } | null
}): Expense {
  return {
    id: e.id,
    date: toIsoDateString(e.date),
    category: e.category,
    merchant: e.merchant,
    description: e.description,
    amountPence: e.amountPence,
    staffRef: e.staffRef,
    method: e.method,
    status: e.status,
    receipt: e.receipt ? toAttachmentDto(e.receipt) : null,
  } as Expense
}

/**
 * Attachment view model. `quarantined:` keys are historical rows whose URL was
 * a browser blob or an inline data URL; they are reported as unavailable
 * rather than rendered as a link that cannot resolve or, worse, executes.
 */
function toAttachmentDto(a: {
  name: string; kind: string; storageKey: string; sizeBytes: number
}) {
  const unavailable = a.storageKey.startsWith('quarantined:')
  return {
    name: a.name,
    kind: a.kind,
    size: formatBytes(a.sizeBytes),
    url: unavailable ? null : `/api/files/${a.storageKey}`,
    unavailable,
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Moves an expense claim through its state machine.
 *
 * Previously any status could be set from any other, so a rejected claim
 * could be replayed as reimbursed. Transitions are now explicit, the approver
 * is recorded, rejections require a reason and reimbursements a payment
 * reference.
 */
const EXPENSE_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['reimbursed', 'rejected'],
  rejected: [],
  reimbursed: ['reconciled'],
  reconciled: [],
}

export async function decideExpense(
  id: string,
  decision: 'approved' | 'rejected' | 'reimbursed' | 'reconciled',
  extra?: { reason?: string; paymentReference?: string }
): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireApprover()
    const data = parseOrThrow(expenseDecisionSchema, { id, decision, ...extra })

    const expense = await prisma.expense.findUnique({
      where: { id: data.id },
      include: { staff: { select: { name: true } } },
    })
    if (!expense) throw NotFound('That expense claim no longer exists.')

    await requireStaffAccess(expense.staffRef, actor)

    if (!EXPENSE_TRANSITIONS[expense.status]?.includes(data.decision)) {
      throw Conflict(
        `An expense that is ${expense.status} cannot be marked ${data.decision}.`
      )
    }
    if (actor.staff?.ref === expense.staffRef) {
      throw new AppError('You cannot approve your own expense claim.', 403, 'forbidden')
    }
    // Reimbursement moves money and is a finance decision.
    if (data.decision === 'reimbursed' || data.decision === 'reconciled') {
      await requireFinance()
    }

    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: data.id },
        data: {
          status: data.decision,
          ...(data.decision === 'approved'
            ? { approvedById: actor.user.id, approvedAt: new Date() }
            : {}),
          ...(data.decision === 'rejected'
            ? { rejectionReason: data.reason!.trim() }
            : {}),
          ...(data.decision === 'reimbursed'
            ? {
                reimbursedAt: new Date(),
                paymentReference: data.paymentReference!.trim(),
              }
            : {}),
          ...(data.decision === 'reconciled' ? { reconciledAt: new Date() } : {}),
        },
      })
      await recordAudit(
        {
          actor,
          action: data.decision === 'rejected' ? 'reject' : 'approve',
          entity: 'Expense',
          entityId: data.id,
          summary: `${expense.staff.name}'s claim marked ${data.decision}`,
          before: { status: expense.status },
          after: { status: data.decision, reason: data.reason },
        },
        tx
      )
    })

    await notify.expenseDecided(expense.staffRef, data.id, data.decision, data.reason)

    revalidatePath('/admin/expenses')
    revalidatePath('/crew/expenses')
    revalidatePath('/admin/dashboard')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'decideExpense')
  }
}

/** Records a claim on an employee's behalf. */
export async function addExpense(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireApprover()
    const data = parseOrThrow(expenseSchema, input)

    if (!data.staffRef) throw BadRequest('Choose whose claim this is.')
    await requireStaffAccess(data.staffRef, actor)

    if (data.date > businessToday()) {
      throw BadRequest('An expense cannot be dated in the future.')
    }

    const id = makeId('EX')

    await prisma.$transaction(async (tx) => {
      let receiptId: string | undefined
      if (data.receipt) {
        const attachment = await tx.attachment.create({
          data: {
            name: data.receipt.name,
            kind: data.receipt.kind,
            mimeType: data.receipt.mimeType,
            sizeBytes: data.receipt.sizeBytes,
            storageKey: data.receipt.storageKey,
            uploadedById: actor.user.id,
          },
        })
        receiptId = attachment.id
      }

      await tx.expense.create({
        data: {
          id,
          date: utcDate(data.date),
          category: data.category,
          merchant: data.merchant,
          description: data.description,
          amountPence: data.amountPence,
          vatPence: data.vatPence,
          staffRef: data.staffRef!,
          method: data.method,
          status: 'submitted',
          receiptId,
        },
      })

      await recordAudit(
        {
          actor,
          action: 'create',
          entity: 'Expense',
          entityId: id,
          summary: `Recorded ${formatMoney(data.amountPence)} for ${data.staffRef}`,
          after: data,
        },
        tx
      )
    })

    revalidatePath('/admin/expenses')
    return actionOk({ id })
  } catch (err) {
    return actionFailed(err, 'addExpense')
  }
}

// --- clients and invoices ---------------------------------------------------

export async function getClients() {
  await requireFinance()
  return prisma.client.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, paymentTermsDays: true },
  })
}

export async function getInvoices(): Promise<Invoice[]> {
  await requireFinance()

  const rows = await prisma.invoice.findMany({
    include: {
      client: { select: { name: true } },
      document: true,
      proof: true,
      payments: { select: { amountPence: true } },
    },
    orderBy: { issued: 'desc' },
    take: 500,
  })

  return rows.map((inv) => {
    const { paidPence, balancePence } = summarisePayments(inv.amountPence, inv.payments)
    return {
      id: inv.id,
      client: inv.client.name,
      reference: inv.reference,
      amountPence: inv.amountPence,
      netPence: inv.netPence,
      vatPence: inv.vatPence,
      paidPence,
      balancePence,
      issued: toIsoDateString(inv.issued),
      due: toIsoDateString(inv.due),
      // Recomputed on read so an invoice that has quietly gone past its due
      // date shows as overdue without waiting for a nightly job.
      status: deriveInvoiceStatus({
        stored: inv.status,
        grossPence: inv.amountPence,
        paidPence,
        due: inv.due,
        sentAt: inv.sentAt,
      }),
      document: inv.document ? toAttachmentDto(inv.document) : null,
      proof: inv.proof ? toAttachmentDto(inv.proof) : null,
    } as unknown as Invoice
  })
}

/**
 * Creates an invoice from line items.
 *
 * Totals are computed server-side from the lines, and the invoice always
 * starts as a draft: paid is a state reached by recording a payment, never a
 * value chosen in a dropdown.
 */
export async function addInvoice(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(createInvoiceSchema, input)

    const totals = computeInvoiceTotals(data.lineItems)
    if (totals.grossPence <= 0) {
      throw BadRequest('An invoice must be for more than zero.')
    }

    const id = makeId('INV')

    await prisma.$transaction(async (tx) => {
      // Resolve or create the client atomically, matching case-insensitively
      // so "Network Rail" and "network rail" cannot become two customers.
      let clientId = data.clientId
      if (!clientId) {
        const nameKey = data.clientName!.trim().toLowerCase()
        const existing = await tx.client.findUnique({ where: { nameKey } })
        clientId = existing
          ? existing.id
          : (
              await tx.client.create({
                data: { name: data.clientName!.trim(), nameKey },
              })
            ).id
      }

      const clash = await tx.invoice.findUnique({
        where: { clientId_reference: { clientId, reference: data.reference } },
      })
      if (clash) {
        throw Conflict('That reference has already been used for this client.')
      }

      await tx.invoice.create({
        data: {
          id,
          clientId,
          jobId: data.jobId ?? null,
          reference: data.reference,
          netPence: totals.netPence,
          vatPence: totals.vatPence,
          amountPence: totals.grossPence,
          issued: utcDate(data.issued),
          due: utcDate(data.due),
          poNumber: data.poNumber || null,
          notes: data.notes || null,
          status: 'draft',
          createdById: actor.user.id,
          lineItems: {
            create: totals.lines.map((l, i) => ({
              description: l.description,
              quantity: l.quantity,
              unitPricePence: l.unitPricePence,
              vatRateBasisPoints: l.vatRateBasisPoints,
              netPence: l.netPence,
              vatPence: l.vatPence,
              position: i,
            })),
          },
        },
      })

      await recordAudit(
        {
          actor,
          action: 'create',
          entity: 'Invoice',
          entityId: id,
          summary: `Raised ${data.reference} for ${formatMoney(totals.grossPence)}`,
          after: { reference: data.reference, ...totals },
        },
        tx
      )
    })

    revalidatePath('/admin/invoices')
    revalidatePath('/finance/invoices')
    return actionOk({ id })
  } catch (err) {
    return actionFailed(err, 'addInvoice')
  }
}

/**
 * Records a payment against an invoice.
 *
 * `reference` is the idempotency key: replaying the same submission is a
 * no-op rather than double-crediting the customer.
 */
export async function recordPayment(input: unknown): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(recordPaymentSchema, input)

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        include: { payments: true },
      })
      if (!invoice) throw NotFound('That invoice no longer exists.')
      if (invoice.status === 'void' || invoice.status === 'written_off') {
        throw Conflict(`A ${invoice.status} invoice cannot take payments.`)
      }

      const duplicate = await tx.payment.findUnique({
        where: { reference: data.reference },
      })
      if (duplicate) {
        // Idempotent: the same reference is treated as already recorded.
        return { status: invoice.status, duplicate: true }
      }

      const { paidPence } = summarisePayments(invoice.amountPence, invoice.payments)
      if (paidPence + data.amountPence > invoice.amountPence) {
        throw BadRequest(
          `That would overpay the invoice — ${formatMoney(invoice.amountPence - paidPence)} is outstanding.`
        )
      }

      await tx.payment.create({
        data: {
          invoiceId: data.invoiceId,
          amountPence: data.amountPence,
          receivedOn: utcDate(data.receivedOn),
          method: data.method,
          reference: data.reference,
          notes: data.notes || null,
          recordedById: actor.user.id,
        },
      })

      const newPaid = paidPence + data.amountPence
      const status = deriveInvoiceStatus({
        stored: invoice.status,
        grossPence: invoice.amountPence,
        paidPence: newPaid,
        due: invoice.due,
        sentAt: invoice.sentAt,
      })

      await tx.invoice.update({
        where: { id: data.invoiceId },
        data: {
          status,
          paidAt: status === 'paid' ? utcDate(data.receivedOn) : null,
        },
      })

      await recordAudit(
        {
          actor,
          action: 'payment',
          entity: 'Invoice',
          entityId: data.invoiceId,
          summary: `Recorded ${formatMoney(data.amountPence)} against ${invoice.reference}`,
          before: { status: invoice.status, paidPence },
          after: { status, paidPence: newPaid, reference: data.reference },
        },
        tx
      )

      return { status, duplicate: false, reference: invoice.reference }
    })

    if (!result.duplicate) {
      await notify.paymentReceived(
        data.invoiceId,
        result.reference ?? data.invoiceId,
        formatMoney(data.amountPence)
      )
    }

    revalidatePath('/admin/invoices')
    revalidatePath('/finance/invoices')
    return actionOk({ status: result.status })
  } catch (err) {
    return actionFailed(err, 'recordPayment')
  }
}

export async function voidInvoice(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(voidInvoiceSchema, input)

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      include: { payments: true },
    })
    if (!invoice) throw NotFound('That invoice no longer exists.')
    if (invoice.payments.length > 0) {
      throw Conflict(
        'An invoice with payments against it cannot be voided. Write it off or refund the payments first.'
      )
    }
    if (invoice.status === 'void') throw Conflict('That invoice is already void.')

    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { status: 'void', voidedAt: new Date(), voidReason: data.reason },
      })
      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'Invoice',
          entityId: data.invoiceId,
          summary: `Voided ${invoice.reference}: ${data.reason}`,
          before: { status: invoice.status },
          after: { status: 'void' },
        },
        tx
      )
    })

    revalidatePath('/admin/invoices')
    revalidatePath('/finance/invoices')
    return actionOk(undefined)
  } catch (err) {
    return actionFailed(err, 'voidInvoice')
  }
}

// --- payroll ----------------------------------------------------------------

export async function getPayrollRecords(): Promise<PayrollRecord[]> {
  await requireFinance()
  const period = await getRequestPayPeriod()

  const rows = await prisma.payrollRecord.findMany({
    where: { year: period.year, month: period.month },
    orderBy: [{ staffRef: 'asc' }],
    include: { adjustments: true },
  })

  return rows.map((p) => ({
    staffRef: p.staffRef,
    grossPence: p.grossPence,
    taxPence: p.taxPence,
    niPence: p.niPence,
    pensionPence: p.pensionPence,
    netPence: p.netPence,
    status: p.status,
    paidOn: p.paidOn ? toIsoDateString(p.paidOn) : null,
    reference: p.reference,
    adjustmentCount: p.adjustments.length,
  })) as unknown as PayrollRecord[]
}

/**
 * Adds a payroll adjustment.
 *
 * The adjustment is stored as its own record — including the reason the
 * operator typed, which the previous implementation collected and discarded —
 * and the payroll figures are recomputed from base pay plus every adjustment
 * rather than by mutating gross in place.
 */
export async function addPayrollAdjustment(
  input: unknown
): Promise<ActionResult<{ grossPence: number; netPence: number }>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(payrollAdjustmentSchema, input)
    const rates = await payrollRates()

    const result = await prisma.$transaction(async (tx) => {
      const payroll = await tx.payrollRecord.findUnique({
        where: {
          staffRef_year_month: {
            staffRef: data.staffRef,
            year: data.year,
            month: data.month,
          },
        },
        include: { adjustments: true },
      })
      if (!payroll) {
        throw NotFound(
          `There is no payroll record for ${data.staffRef} in ${data.month}/${data.year}.`
        )
      }
      if (payroll.status === 'paid' || payroll.lockedAt) {
        throw Conflict('That payroll run has been paid and can no longer be adjusted.')
      }

      await tx.payrollAdjustment.create({
        data: {
          payrollId: payroll.id,
          amountPence: data.amountPence,
          label: data.label,
          reason: data.reason,
          taxable: data.taxable,
          effectiveDate: utcDate(data.effectiveDate),
          createdById: actor.user.id,
        },
      })

      const all = [
        ...payroll.adjustments.map((a) => ({
          amountPence: a.amountPence,
          taxable: a.taxable,
        })),
        { amountPence: data.amountPence, taxable: data.taxable },
      ]
      const recomputed = recomputeWithAdjustments(payroll.baseGrossPence, all, rates)

      const updated = await tx.payrollRecord.update({
        where: { id: payroll.id },
        data: {
          grossPence: recomputed.grossPence,
          taxPence: recomputed.taxPence,
          niPence: recomputed.niPence,
          pensionPence: recomputed.pensionPence,
          netPence: recomputed.netPence,
          calculationVersion: recomputed.calculationVersion,
        },
      })

      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'PayrollRecord',
          entityId: payroll.id,
          summary: `${data.label}: ${formatMoney(data.amountPence)} — ${data.reason}`,
          before: { grossPence: payroll.grossPence, netPence: payroll.netPence },
          after: { grossPence: updated.grossPence, netPence: updated.netPence },
        },
        tx
      )

      return updated
    })

    revalidatePath('/admin/payroll')
    revalidatePath('/finance/payroll')
    return actionOk({ grossPence: result.grossPence, netPence: result.netPence })
  } catch (err) {
    return actionFailed(err, 'addPayrollAdjustment')
  }
}

// --- dashboard and analytics ------------------------------------------------

export async function getDashboardStats(): Promise<Stat[]> {
  const actor = await requireApprover()

  const todayStr = businessToday()
  const period = await getRequestPayPeriod()
  const prevMonth = period.month === 1 ? 12 : period.month - 1
  const prevYear = period.month === 1 ? period.year - 1 : period.year
  const monthStart = utcDate(`${todayStr.slice(0, 7)}-01`)

  // Every figure on this dashboard is scoped to the people the caller may
  // see. A MANAGER previously received org-wide headcount, attendance and
  // approval queues, including approvals they have no authority to action.
  const visible = await visibleStaffRefs(actor)
  const staffScope = visible === null ? {} : { ref: { in: visible } }
  const recordScope = visible === null ? {} : { staffRef: { in: visible } }

  // Independent reads, issued together rather than one after another.
  const [
    headcount,
    hiredThisMonth,
    todayAttendance,
    pendingLeave,
    pendingExpenses,
    currentPayroll,
    prevPayroll,
  ] = await Promise.all([
    prisma.staff.count({
      where: {
        deletedAt: null,
        employmentStatus: { in: ['active', 'onboarding', 'notice'] },
        ...staffScope,
      },
    }),
    prisma.staff.count({
      where: { joined: { gte: monthStart }, deletedAt: null, ...staffScope },
    }),
    prisma.attendance.groupBy({
      by: ['code'],
      where: { date: dayRange(todayStr, todayStr), ...recordScope },
      _count: { _all: true },
    }),
    prisma.leaveRequest.count({ where: { status: 'pending', ...recordScope } }),
    prisma.expense.count({ where: { status: 'submitted', ...recordScope } }),
    prisma.payrollRecord.aggregate({
      where: { year: period.year, month: period.month, ...recordScope },
      _sum: { netPence: true },
    }),
    prisma.payrollRecord.aggregate({
      where: { year: prevYear, month: prevMonth, ...recordScope },
      _sum: { netPence: true },
    }),
  ])

  const countFor = (codes: string[]) =>
    todayAttendance
      .filter((a) => codes.includes(a.code))
      .reduce((n, a) => n + a._count._all, 0)

  const inToday = countFor(['P', 'H'])
  const away = countFor(['L', 'A'])
  const netPay = currentPayroll._sum.netPence ?? 0
  const prevNetPay = prevPayroll._sum.netPence ?? 0

  let payrollDelta = '0%'
  let payrollTrend: 'up' | 'down' | 'flat' = 'flat'
  if (prevNetPay > 0) {
    const pct = ((netPay - prevNetPay) / prevNetPay) * 100
    payrollDelta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    payrollTrend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  } else if (netPay > 0) {
    payrollDelta = '+100%'
    payrollTrend = 'up'
  }

  return [
    {
      label: 'Headcount',
      value: String(headcount),
      delta: hiredThisMonth > 0 ? `+${hiredThisMonth}` : '0',
      trend: hiredThisMonth > 0 ? 'up' : 'flat',
      positive: true,
      hint: 'joined this month',
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
      delta: `${pendingLeave} leave · ${pendingExpenses} expenses`,
      trend: 'flat',
      positive: pendingLeave + pendingExpenses === 0,
      hint: 'items in your queue',
    },
    {
      label: 'Net payroll',
      value: formatMoney(netPay),
      delta: payrollDelta,
      trend: payrollTrend,
      positive: payrollTrend !== 'up',
      hint: period.label,
    },
  ]
}

export async function getRecentActivity(): Promise<ActivityRow[]> {
  const actor = await requireApprover()

  // Named leave and expense activity is personal data, and invoice values are
  // commercial. A MANAGER previously saw both for the whole organisation.
  const visible = await visibleStaffRefs(actor)
  const recordScope = visible === null ? {} : { staffRef: { in: visible } }
  const seesFinance = actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE'

  const [leaves, expenses, invoices] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: recordScope,
      orderBy: { submitted: 'desc' },
      take: 6,
      include: { staff: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where: recordScope,
      orderBy: { date: 'desc' },
      take: 6,
      include: { staff: { select: { name: true } } },
    }),
    seesFinance
      ? prisma.invoice.findMany({
          orderBy: { issued: 'desc' },
          take: 6,
          include: { client: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ])

  const rows: ActivityRow[] = [
    ...leaves.map((r) => ({
      ref: r.id,
      title: `${r.days} day${r.days === 1 ? '' : 's'} ${r.type} leave`,
      who: r.staff.name,
      amount: '—',
      kind: 'leave' as const,
      status: r.status,
      date: toIsoDateString(r.submitted),
    })),
    ...expenses.map((e) => ({
      ref: e.id,
      title: e.merchant,
      who: e.staff.name,
      amount: formatMoney(e.amountPence),
      kind: 'expense' as const,
      status: e.status,
      date: toIsoDateString(e.date),
    })),
    ...invoices.map((i) => ({
      ref: i.id,
      title: i.reference,
      who: i.client.name,
      amount: formatMoney(i.amountPence),
      kind: 'invoice' as const,
      status: i.status,
      date: toIsoDateString(i.issued),
    })),
  ]

  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
}

export async function getWeeklyHours(week?: string[]): Promise<DayHours[]> {
  const actor = await requireApprover()

  const activeWeek = week ?? weekDays(businessToday())
  // Scoped: a manager's chart covers their own crew, not the whole company.
  const visible = await visibleStaffRefs(actor)

  const rows = await prisma.attendance.findMany({
    where: {
      date: dayRange(activeWeek[0], activeWeek[6]),
      ...(visible === null ? {} : { staffRef: { in: visible } }),
    },
    select: { date: true, code: true, hours: true },
  })

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return activeWeek.map((iso, i) => {
    const onDay = rows.filter((r) => toIsoDateString(r.date) === iso)
    // Prefer hours actually recorded over the code's nominal value, matching
    // getStaff. The two previously disagreed whenever real hours were entered.
    const sum = (code: string) =>
      onDay
        .filter((r) => r.code === code)
        .reduce((total, r) => total + (r.hours ?? hoursFor(code)), 0)
    return {
      day: DOW[i],
      date: iso,
      full: sum('P'),
      half: sum('H'),
    }
  })
}

export async function getMonthlyFinance(): Promise<MonthPoint[]> {
  await requireFinance()

  const now = new Date()
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const months = Array.from({ length: 6 }, (_, idx) => {
    const i = 5 - idx
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const y = d.getUTCFullYear()
    const mNum = d.getUTCMonth() + 1
    return {
      month: `${y}-${String(mNum).padStart(2, '0')}`,
      label: labels[d.getUTCMonth()],
      start: d,
      end: new Date(Date.UTC(y, d.getUTCMonth() + 1, 1)),
      year: y,
      monthNum: mNum,
    }
  })

  // One aggregate per month per source, issued in parallel rather than in a
  // sequential loop of full-table reads.
  return Promise.all(
    months.map(async (m) => {
      const [invoices, expenses, payroll] = await Promise.all([
        prisma.invoice.aggregate({
          where: {
            issued: { gte: m.start, lt: m.end },
            status: { notIn: ['draft', 'void'] },
          },
          _sum: { amountPence: true },
        }),
        prisma.expense.aggregate({
          where: { date: { gte: m.start, lt: m.end }, status: { not: 'rejected' } },
          _sum: { amountPence: true },
        }),
        prisma.payrollRecord.aggregate({
          where: { year: m.year, month: m.monthNum },
          _sum: { grossPence: true },
        }),
      ])

      return {
        month: m.month,
        label: m.label,
        earnedPence: invoices._sum.amountPence ?? 0,
        spentPence:
          (expenses._sum.amountPence ?? 0) + (payroll._sum.grossPence ?? 0),
      }
    })
  )
}

/**
 * Sidebar approval badges.
 *
 * Scoped to the caller's own queue. These were org-wide counts, so a manager
 * saw a badge for approvals that `getLeaveRequests` would then not show them
 * and `decideLeaveRequest` would refuse.
 */
export async function getPendingCounts() {
  const actor = await requireActor()
  if (!['ADMIN', 'FINANCE', 'MANAGER'].includes(actor.user.role)) {
    return { pendingLeaves: 0, pendingExpenses: 0 }
  }
  const visible = await visibleStaffRefs(actor)
  const scope = visible === null ? {} : { staffRef: { in: visible } }

  const [pendingLeaves, pendingExpenses] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'pending', ...scope } }),
    prisma.expense.count({ where: { status: 'submitted', ...scope } }),
  ])
  return { pendingLeaves, pendingExpenses }
}
