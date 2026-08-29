'use server'

/**
 * Employee self-service Server Actions.
 *
 * Every action here derives its subject from the session, never from an
 * argument. A crew member cannot pass somebody else's reference to read their
 * payslip or submit against their record.
 */

import { revalidatePath } from 'next/cache'

import { prisma } from '@/app/lib/prisma'
import {
  requireStaff,
  requireStaffAccess,
  requireActor,
  SELF_STAFF_SELECT,
} from '@/app/lib/authz'
import {
  businessToday,
  dayRange,
  fromStoredDate,
  leaveYearBounds,
  leaveYearOf,
  periodLabel,
  utcDate,
  weekDays,
} from '@/app/lib/dates'
import { entitlementFor } from '@/app/lib/leave'
import { getSettings } from '@/app/lib/settings'
import { recordAudit } from '@/app/lib/audit'
import { notify } from '@/app/lib/notifications'
import {
  actionFailed,
  actionOk,
  Conflict,
  BadRequest,
  NotFound,
  type ActionResult,
} from '@/app/lib/errors'
import {
  crewTimesheetSchema,
  expenseSchema,
  parseOrThrow,
} from '@/app/lib/validation'
import { hoursFor } from '@/app/lib/payroll'
import { formatMoney } from '@/app/lib/invoices'
import { createLeaveRequest } from '@/app/actions/admin'
import type { AttendanceCode } from '@/app/lib/admin-data'

// Date handling comes from app/lib/dates.ts. The local copies that used to
// live here resolved "today" in UTC, so during British Summer Time the hour
// after local midnight belonged to the previous day — which rejected an
// expense legitimately dated today and refused a timesheet for the current
// week as being in the future.
const toIsoDateString = fromStoredDate

/**
 * The signed-in employee.
 *
 * Performs no writes — it used to backfill `userId` during a read, which made
 * every dashboard load a non-idempotent GET.
 *
 * The projection matters as much as the guard: this previously returned the
 * whole `Staff` row, so the employee's NI number, tax code, sort code and
 * date of birth were serialised into the page payload of every crew request.
 * They are their own data, so it was not a cross-user breach, but payroll
 * identity has no business reaching a browser at all.
 */
export async function getCrewSession() {
  const { staff } = await requireStaff()
  return prisma.staff.findUniqueOrThrow({
    where: { ref: staff.ref },
    select: SELF_STAFF_SELECT,
  })
}

export async function getCrewDashboardData() {
  const { staff: me } = await requireStaff()
  const today = businessToday()
  const week = weekDays(today)
  // The leave year, which is what LeaveRequest.leaveYear stores. Filtering on
  // the calendar year made leave booked into next January invisible on the
  // employee's own balance while still being deducted from that year.
  const year = leaveYearOf(today)

  const [attendance, myLeaves, settings, expenses, latestPayroll, celebrations, timesheet] =
    await Promise.all([
      prisma.attendance.findMany({
        where: { staffRef: me.ref, date: dayRange(week[0], week[6]) },
        select: { date: true, code: true, hours: true },
      }),
      prisma.leaveRequest.findMany({
        where: { staffRef: me.ref },
        orderBy: { submitted: 'desc' },
        take: 50,
      }),
      getSettings(),
      prisma.expense.findMany({
        where: { staffRef: me.ref },
        orderBy: { date: 'desc' },
        take: 50,
        include: { receipt: true },
      }),
      prisma.payrollRecord.findFirst({
        where: { staffRef: me.ref, status: { in: ['approved', 'paid'] } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      // Only the fields the celebrations strip needs, not the whole roster.
      prisma.staff.findMany({
        where: { deletedAt: null, employmentStatus: 'active' },
        select: { name: true, joined: true, birthday: true },
        take: 500,
      }),
      prisma.timesheet.findUnique({
        where: { staffRef_weekStart: { staffRef: me.ref, weekStart: utcDate(week[0]) } },
      }),
    ])

  const codes = week.map((dayStr) => {
    const match = attendance.find((a) => toIsoDateString(a.date) === dayStr)
    return (match?.code ?? '-') as AttendanceCode
  })

  // Unknown codes contribute zero rather than turning the total into NaN.
  const hours = week.reduce((total, dayStr) => {
    const match = attendance.find((a) => toIsoDateString(a.date) === dayStr)
    if (!match) return total
    return total + (match.hours ?? hoursFor(match.code))
  }, 0)

  // Allowance accounting mirrors the server-side leave engine: only leave
  // that deducts counts, and only for the current leave year.
  const deducting = myLeaves.filter((r) => r.deducts && r.leaveYear === year)
  const taken = deducting
    .filter((r) => r.status === 'approved' || r.status === 'taken')
    .reduce((n, r) => n + r.days, 0)
  const pending = deducting
    .filter((r) => r.status === 'pending')
    .reduce((n, r) => n + r.days, 0)

  // This employee's own entitlement, pro-rated for contracted hours and for
  // the part of the leave year they are employed, plus their own carry-over.
  // It was previously `settings.leaveDays + settings.carryOver` for everyone,
  // which gave a part-timer and a mid-year joiner a full-time allowance.
  const totalLeaveDays = entitlementFor(
    {
      joined: toIsoDateString(me.joined),
      endDate: me.endDate ? toIsoDateString(me.endDate) : null,
      weeklyHours: me.weeklyHours,
      annualLeaveDays: me.annualLeaveDays,
      carryOverDays: me.carryOverDays,
    },
    leaveYearBounds(year),
    { leaveDays: settings.leaveDays, fullTimeWeeklyHours: 37.5 }
  ).entitlement
  const myExpenses = expenses.map((e) => ({
    id: e.id,
    date: toIsoDateString(e.date),
    category: e.category,
    merchant: e.merchant,
    description: e.description,
    amountPence: e.amountPence,
    staffRef: e.staffRef,
    method: e.method,
    status: e.status,
    receipt: e.receipt
      ? {
          name: e.receipt.name,
          kind: e.receipt.kind,
          size: `${Math.max(1, Math.round(e.receipt.sizeBytes / 1024))} KB`,
          url: e.receipt.storageKey.startsWith('quarantined:')
            ? null
            : `/api/files/${e.receipt.storageKey}`,
        }
      : null,
  }))

  return {
    me: { ref: me.ref, name: me.name, role: me.role, email: me.email },
    today,
    attendanceWeek: week,
    codes,
    hours,
    taken,
    remaining: totalLeaveDays - taken - pending,
    totalLeaveDays,
    timesheetStatus: timesheet?.status ?? 'draft',
    openClaimsCount: myExpenses.filter(
      (e) => e.status === 'submitted' || e.status === 'approved'
    ).length,
    latestPayPence: latestPayroll ? latestPayroll.netPence : null,
    payPeriodLabel: latestPayroll
      ? periodLabel(latestPayroll.year, latestPayroll.month)
      : periodLabel(Number(today.slice(0, 4)), Number(today.slice(5, 7))),
    myLeaveRequests: myLeaves.map((r) => ({
      id: r.id,
      staffRef: r.staffRef,
      type: r.type,
      from: toIsoDateString(r.from),
      to: toIsoDateString(r.to),
      days: r.days,
      reason: r.reason,
      status: r.status,
      submitted: toIsoDateString(r.submitted),
    })),
    myExpenses,
    staffListForCelebrations: celebrations.map((s) => ({
      name: s.name,
      joined: toIsoDateString(s.joined),
      birthday: s.birthday ?? '',
    })),
  }
}

/**
 * Submits the employee's own week.
 *
 * All seven upserts and the timesheet record are one transaction, so a
 * failure part-way through can no longer leave a half-written week. Once the
 * week is approved and locked it cannot be resubmitted.
 */
export async function saveCrewTimesheet(
  codes: AttendanceCode[],
  weekStart?: string
): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireStaff()
    const me = actor.staff
    const data = parseOrThrow(crewTimesheetSchema, { codes, weekStart })

    const today = businessToday()
    const week = weekDays(data.weekStart ?? today)
    const monday = utcDate(week[0])

    // A submission is always for a week that has started. Compared as
    // business dates: `monday > new Date()` mixed a UTC-midnight timestamp
    // with a real instant, so on a Monday morning during BST the current week
    // read as being in the future and submission was refused.
    if (week[0] > today) {
      throw BadRequest('You cannot submit a timesheet for a future week.')
    }

    const existing = await prisma.timesheet.findUnique({
      where: { staffRef_weekStart: { staffRef: me.ref, weekStart: monday } },
    })
    if (existing && (existing.status === 'locked' || existing.status === 'approved')) {
      throw Conflict('That week has been approved and can no longer be changed.')
    }

    const sheet = await prisma.$transaction(async (tx) => {
      const timesheet = await tx.timesheet.upsert({
        where: { staffRef_weekStart: { staffRef: me.ref, weekStart: monday } },
        create: {
          staffRef: me.ref,
          weekStart: monday,
          status: 'submitted',
          submittedAt: new Date(),
        },
        update: {
          status: 'submitted',
          submittedAt: new Date(),
          rejectionReason: null,
        },
      })

      for (let i = 0; i < 7; i++) {
        const date = utcDate(week[i])
        await tx.attendance.upsert({
          where: { staffRef_date: { staffRef: me.ref, date } },
          update: {
            code: data.codes[i],
            source: 'crew',
            timesheetId: timesheet.id,
          },
          create: {
            staffRef: me.ref,
            date,
            code: data.codes[i],
            source: 'crew',
            timesheetId: timesheet.id,
          },
        })
      }

      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'Timesheet',
          entityId: timesheet.id,
          summary: `Submitted timesheet for week of ${week[0]}`,
          after: { week: week[0], codes: data.codes },
        },
        tx
      )

      return timesheet
    })

    await notify.timesheetSubmitted(me.ref, me.name, sheet.id, week[0])

    revalidatePath('/crew')
    revalidatePath('/crew/timesheet')
    revalidatePath('/admin/timesheets')
    return actionOk({ status: sheet.status })
  } catch (err) {
    return actionFailed(err, 'saveCrewTimesheet')
  }
}

/**
 * Submits leave for the signed-in employee.
 *
 * Delegates to the one authoritative implementation, which recomputes the day
 * count from the working pattern and holiday table and enforces the allowance
 * and overlap rules. The browser's `days` figure is not accepted at all.
 */
export async function submitCrewLeaveRequest(data: {
  type: string
  from: string
  to: string
  reason?: string
  startAt?: string
  endAt?: string
}) {
  await requireStaff()
  return createLeaveRequest({
    type: data.type,
    from: data.from,
    to: data.to,
    reason: data.reason,
    startAt: data.startAt,
    endAt: data.endAt,
    approveNow: false,
  })
}

/** Withdraws the employee's own request before it starts. */
export async function cancelMyLeaveRequest(id: string): Promise<ActionResult<undefined>> {
  const { cancelLeaveRequest } = await import('@/app/actions/admin')
  return cancelLeaveRequest(id)
}

export async function submitCrewExpense(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireStaff()
    const me = actor.staff
    const data = parseOrThrow(expenseSchema, input)

    if (data.date > businessToday()) {
      throw BadRequest('An expense cannot be dated in the future.')
    }

    const crypto = await import('crypto')
    const id = `EX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`

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
          // Always the session's own reference, never a client-supplied one.
          staffRef: me.ref,
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
          summary: `Claimed ${formatMoney(data.amountPence)} for ${data.merchant}`,
          after: { ...data, receipt: undefined },
        },
        tx
      )
    })

    await notify.expenseSubmitted(me.ref, me.name, id, formatMoney(data.amountPence))

    revalidatePath('/crew')
    revalidatePath('/crew/expenses')
    revalidatePath('/admin/expenses')
    return actionOk({ id })
  } catch (err) {
    return actionFailed(err, 'submitCrewExpense')
  }
}

/**
 * Payslips for one employee.
 *
 * The subject is resolved through `requireStaffAccess`, so an employee reaches
 * only their own record while an administrator or the employee's manager can
 * look one up. Passing an arbitrary reference as a crew member — the previous
 * behaviour, which had no authentication at all — is rejected.
 */
export async function getPayslips(staffRef?: string) {
  const actor = await requireActor()
  const targetRef = staffRef ?? actor.staff?.ref
  if (!targetRef) throw NotFound('No employee record is linked to your account.')

  await requireStaffAccess(targetRef, actor)

  const records = await prisma.payrollRecord.findMany({
    where: { staffRef: targetRef, status: { in: ['approved', 'paid'] } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 36,
  })

  return records.map((r) => ({
    id: r.id,
    staffRef: r.staffRef,
    month: r.month,
    year: r.year,
    grossPence: r.grossPence,
    taxPence: r.taxPence,
    niPence: r.niPence,
    pensionPence: r.pensionPence,
    netPence: r.netPence,
    paidOn: r.paidOn ? toIsoDateString(r.paidOn) : null,
    reference: r.reference,
    status: r.status,
  }))
}

/** The most recent published payslip for the signed-in employee. */
export async function getCrewLatestPayslip(staffRef?: string) {
  const all = await getPayslips(staffRef)
  return all[0] ?? null
}
