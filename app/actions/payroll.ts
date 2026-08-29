'use server'

/**
 * Payroll run lifecycle.
 *
 * Before this module existed, `PayrollStatus.approved` and `.paid` were
 * unreachable: the only writes to `PayrollRecord` were a zero-valued row
 * created during onboarding and the adjustment recompute, neither of which
 * touched `status`. Because `getPayslips` filters on `approved | paid`, **no
 * employee could ever see a payslip**, `latestPayPence` was always null, and
 * every payroll figure on the dashboards was structurally zero.
 *
 * The run is a state machine:
 *
 *     (none) --run--> draft --approve--> approved --pay--> paid
 *                       ^                    |
 *                       +------- reopen -----+
 *
 *   - `run` is idempotent for a period: re-running recomputes every draft
 *     record from current attendance and rates, and refuses to touch a record
 *     that is already approved or paid.
 *   - `approve` locks the record. Adjustments are refused after this point.
 *   - `pay` records the payment date and notifies the employee that a payslip
 *     is available. It is terminal.
 *   - `reopen` unlocks an approved-but-unpaid run so a correction can be made,
 *     and is audited as such. A paid run can never be reopened.
 *
 * Pay is derived from *approved* attendance only. Basing a run on a timesheet
 * the employee could still edit would let someone change the hours behind a
 * payslip that had already been issued.
 */

import { revalidatePath } from 'next/cache'

import { prisma } from '@/app/lib/prisma'
import { recordAudit } from '@/app/lib/audit'
import { requireFinance, requireStaffAccess } from '@/app/lib/authz'
import {
  actionFailed,
  actionOk,
  Conflict,
  NotFound,
  type ActionResult,
} from '@/app/lib/errors'
import { getSettings as readSettings } from '@/app/lib/settings'
import { notify } from '@/app/lib/notifications'
import {
  computeBaseGross,
  payableDaysFrom,
  type PayrollRates,
} from '@/app/lib/payroll'
import {
  calculatePay,
  taxYearOfDate,
  taxPeriodOfDate,
  ZERO_YTD,
  type YearToDate,
} from '@/app/lib/hmrc'
import {
  currentPeriod,
  businessToday,
  dayRange,
  fromStoredDate,
  monthBounds,
  periodLabel,
  utcDate,
} from '@/app/lib/dates'
import { parseOrThrow, payrollRunSchema } from '@/app/lib/validation'

async function payrollRates(): Promise<PayrollRates> {
  const s = await readSettings()
  return {
    allowancePence: s.allowancePence,
    taxPercent: s.tax,
    niPercent: s.ni,
    pensionPercent: s.pension,
  }
}

/**
 * The day rate in force for an employee on a given date.
 *
 * Reads the effective-dated `StaffPayRate` history so a historical run stays
 * reproducible after someone's rate changes, falling back to the current rate
 * on the staff record when no history exists.
 */
function rateOn(
  rates: Array<{ dayRatePence: number; effectiveFrom: Date; effectiveTo: Date | null }>,
  onIso: string,
  fallback: number | null
): number | null {
  const on = utcDate(onIso)
  const applicable = rates
    .filter((r) => r.effectiveFrom <= on && (r.effectiveTo === null || r.effectiveTo >= on))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
  return applicable?.dayRatePence ?? fallback
}

export type PayrollRunSummary = {
  year: number
  month: number
  label: string
  created: number
  updated: number
  skipped: number
  /** Employees who could not be run, with the reason. */
  problems: Array<{ staffRef: string; name: string; reason: string }>
}

/**
 * Cumulative figures for the tax year up to, but not including, a period.
 *
 * Reads the stored year-to-date totals of the most recent earlier period
 * rather than summing every period. The stored figures are the ones the
 * earlier payslips were actually issued on, so carrying them forward keeps a
 * later period consistent with what the employee has already been told — even
 * if an earlier record were somehow corrected afterwards.
 *
 * Only approved and paid records count. Including drafts would let an
 * unapproved run distort the tax of the period after it.
 */
async function yearToDateBefore(
  staffRef: string,
  taxYearStart: number,
  taxPeriod: number
): Promise<YearToDate> {
  const previous = await prisma.payrollRecord.findFirst({
    where: {
      staffRef,
      taxYearStart,
      taxPeriod: { lt: taxPeriod },
      status: { in: ['approved', 'paid'] },
    },
    orderBy: { taxPeriod: 'desc' },
    select: {
      ytdGrossPence: true,
      ytdTaxablePence: true,
      ytdTaxPence: true,
      ytdNiPence: true,
      ytdPensionPence: true,
    },
  })

  if (!previous) return { ...ZERO_YTD }

  return {
    grossPence: previous.ytdGrossPence,
    taxablePence: previous.ytdTaxablePence,
    taxPence: previous.ytdTaxPence,
    niPence: previous.ytdNiPence,
    pensionPence: previous.ytdPensionPence,
  }
}

/**
 * Builds or rebuilds the draft payroll for a period.
 *
 * Only `draft` records are touched. Approved and paid records are reported as
 * skipped rather than silently recalculated, so a run cannot rewrite a payslip
 * that has already been issued.
 */
export async function runPayroll(input: unknown): Promise<ActionResult<PayrollRunSummary>> {
  try {
    const actor = await requireFinance()
    const { year, month } = parseOrThrow(payrollRunSchema, input)
    const { from, to } = monthBounds(year, month)
    const rates = await payrollRates()
    const label = periodLabel(year, month)

    // Everyone employed for any part of the period. Leavers are included so a
    // final month is paid; archived records are not.
    const staff = await prisma.staff.findMany({
      where: {
        deletedAt: null,
        employmentStatus: { notIn: ['archived', 'onboarding'] },
        joined: { lte: utcDate(to) },
        OR: [{ endDate: null }, { endDate: { gte: utcDate(from) } }],
      },
      select: {
        ref: true,
        name: true,
        dayRatePence: true,
        payFrequency: true,
        payRates: {
          select: { dayRatePence: true, effectiveFrom: true, effectiveTo: true },
        },
        // The PAYE arrangement in force at the end of the period, and the
        // account to be paid. Both are effective-dated, so a code or account
        // changed later cannot retrospectively alter this run.
        payrollProfiles: {
          where: {
            effectiveFrom: { lte: utcDate(to) },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: utcDate(to) } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        bankAccounts: {
          where: { isPrimary: true },
          select: { id: true, verifiedAt: true },
          take: 1,
        },
      },
      orderBy: { ref: 'asc' },
    })

    const summary: PayrollRunSummary = {
      year, month, label, created: 0, updated: 0, skipped: 0, problems: [],
    }

    for (const person of staff) {
      const existing = await prisma.payrollRecord.findUnique({
        where: { staffRef_year_month: { staffRef: person.ref, year, month } },
        include: { adjustments: true },
      })

      if (existing && existing.status !== 'draft') {
        summary.skipped += 1
        continue
      }

      const dayRate = rateOn(person.payRates, to, person.dayRatePence)
      if (dayRate === null) {
        summary.problems.push({
          staffRef: person.ref,
          name: person.name,
          reason: 'No day rate is recorded, so pay cannot be calculated.',
        })
        continue
      }

      // Only attendance on an approved or locked timesheet counts. Unapproved
      // weeks are excluded rather than assumed present, so payroll can never
      // be generated from data the employee could still change.
      const attendance = await prisma.attendance.findMany({
        where: {
          staffRef: person.ref,
          date: dayRange(from, to),
          timesheet: { status: { in: ['approved', 'locked'] } },
        },
        select: { date: true, code: true },
      })

      // Days covered by unpaid leave never pay, whatever the roster says.
      const unpaid = await prisma.leaveRequest.findMany({
        where: {
          staffRef: person.ref,
          status: { in: ['approved', 'taken'] },
          type: 'unpaid',
          from: { lte: utcDate(to) },
          to: { gte: utcDate(from) },
        },
        select: { from: true, to: true },
      })
      const unpaidDates = new Set<string>()
      for (const leave of unpaid) {
        for (
          let d = leave.from.getTime();
          d <= leave.to.getTime();
          d += 86_400_000
        ) {
          unpaidDates.add(new Date(d).toISOString().slice(0, 10))
        }
      }

      const daysWorked = payableDaysFrom(
        attendance.map((a) => ({ date: fromStoredDate(a.date), code: a.code })),
        unpaidDates
      )
      // An employee with no tax code cannot be paid. Guessing 1257L, as the
      // previous version did, silently under-deducts tax for anyone who should
      // be on BR — and hands the employee an unexpected bill from HMRC.
      const profile = person.payrollProfiles[0]
      if (!profile) {
        summary.problems.push({
          staffRef: person.ref,
          name: person.name,
          reason: 'No tax code is on record, so PAYE cannot be calculated.',
        })
        continue
      }

      const bank = person.bankAccounts[0]
      if (!bank || !bank.verifiedAt) {
        summary.problems.push({
          staffRef: person.ref,
          name: person.name,
          reason: bank
            ? 'Bank details have not been verified, so net pay cannot be sent.'
            : 'No bank details are on record, so net pay cannot be sent.',
        })
        continue
      }

      const baseGrossPence = computeBaseGross(daysWorked, dayRate)
      const adjustments = existing?.adjustments ?? []
      // Adjustments still decide the gross; the HMRC engine then decides the
      // deductions from it.
      const grossPence = Math.max(
        0,
        baseGrossPence + adjustments.reduce((n, a) => n + a.amountPence, 0)
      )

      // Pay date is the last day of the period, which fixes both the tax year
      // and the tax period the payment falls in.
      const payDate = utcDate(to)
      const taxYearStart = taxYearOfDate(payDate)
      const taxPeriod = taxPeriodOfDate(payDate, person.payFrequency)

      // Cumulative PAYE needs everything already paid in this tax year. Read
      // from the stored year-to-date figures of earlier periods rather than
      // replaying them, so a single source of truth carries forward.
      const ytd = await yearToDateBefore(person.ref, taxYearStart, taxPeriod)

      const pensionPence = Math.round(
        (grossPence * Math.round(rates.pensionPercent * 100)) / 10000
      )

      let computed
      try {
        computed = calculatePay({
          grossPence,
          taxCode: profile.taxCode,
          basis: profile.basis,
          niCategory: profile.niCategory,
          payFrequency: person.payFrequency,
          taxYearStart,
          taxPeriod,
          ytd,
          pensionPence,
          studentLoanPlan: profile.studentLoanPlan,
          postgradLoan: profile.postgradLoan,
        })
      } catch (err) {
        // A bad tax code or unsupported tax year stops this employee, not the
        // whole run — the rest of the payroll still needs to go out.
        summary.problems.push({
          staffRef: person.ref,
          name: person.name,
          reason: err instanceof Error ? err.message : 'PAYE calculation failed.',
        })
        continue
      }

      const figures = {
        baseGrossPence,
        grossPence: computed.grossPence,
        taxablePence: computed.taxablePence,
        taxPence: computed.taxPence,
        niPence: computed.niPence,
        pensionPence: computed.pensionPence,
        studentLoanPence: computed.studentLoanPence,
        postgradLoanPence: computed.postgradLoanPence,
        netPence: computed.netPence,
        // Provenance: the exact PAYE inputs used, so the payslip keeps
        // explaining itself after the employee's code or bank details change.
        taxCode: computed.taxCode,
        taxBasis: computed.basis,
        niCategory: computed.niCategory,
        payFrequency: person.payFrequency,
        taxYearStart,
        taxPeriod,
        ytdGrossPence: computed.ytd.grossPence,
        ytdTaxablePence: computed.ytd.taxablePence,
        ytdTaxPence: computed.ytd.taxPence,
        ytdNiPence: computed.ytd.niPence,
        ytdPensionPence: computed.ytd.pensionPence,
        bankAccountId: bank.id,
        dayRatePence: dayRate,
        daysWorked,
        calculationVersion: computed.calculationVersion,
      }

      if (existing) {
        await prisma.payrollRecord.update({ where: { id: existing.id }, data: figures })
        summary.updated += 1
      } else {
        await prisma.payrollRecord.create({
          data: {
            staffRef: person.ref,
            year,
            month,
            status: 'draft',
            reference: `PR-${year}${String(month).padStart(2, '0')}-${person.ref}`,
            ...figures,
          },
        })
        summary.created += 1
      }
    }

    await recordAudit({
      actor,
      action: 'create',
      entity: 'PayrollRun',
      entityId: `${year}-${String(month).padStart(2, '0')}`,
      summary: `Ran payroll for ${label}: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} already approved`,
      after: { created: summary.created, updated: summary.updated, skipped: summary.skipped },
    })

    revalidatePath('/admin/payroll')
    revalidatePath('/finance/payroll')
    return actionOk(summary)
  } catch (err) {
    return actionFailed(err, 'runPayroll')
  }
}

/**
 * Approves and locks one payroll record.
 *
 * Approval is what makes the payslip visible to the employee, so it refuses a
 * zero-day record: a payslip for nothing is far more likely to be a missing
 * timesheet than a genuine month of no work, and issuing it silently is worse
 * than refusing it.
 */
export async function approvePayrollRecord(
  payrollId: string
): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireFinance()

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({ where: { id: payrollId } })
      if (!record) throw NotFound('That payroll record no longer exists.')
      if (record.status !== 'draft') {
        throw Conflict(
          `That run is already ${record.status} and cannot be approved again.`
        )
      }
      if (record.daysWorked <= 0) {
        throw Conflict(
          'This run has no approved attendance, so there is nothing to pay. Approve the timesheets first, or add an adjustment if the pay is genuine.'
        )
      }

      const row = await tx.payrollRecord.update({
        where: { id: payrollId },
        data: {
          status: 'approved',
          approvedById: actor.user.id,
          approvedAt: new Date(),
          lockedAt: new Date(),
        },
      })

      await recordAudit(
        {
          actor,
          action: 'approve',
          entity: 'PayrollRecord',
          entityId: payrollId,
          summary: `Approved ${row.reference} — net ${row.netPence}p`,
          before: { status: record.status },
          after: { status: row.status, netPence: row.netPence },
        },
        tx
      )

      return row
    })

    revalidatePath('/admin/payroll')
    revalidatePath('/finance/payroll')
    return actionOk({ status: updated.status })
  } catch (err) {
    return actionFailed(err, 'approvePayrollRecord')
  }
}

/** Reopens an approved run so it can be corrected. A paid run is final. */
export async function reopenPayrollRecord(
  payrollId: string,
  reason: string
): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireFinance()
    const trimmed = String(reason ?? '').trim()
    if (trimmed.length < 4) {
      throw Conflict('Give a reason for reopening this run.')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({ where: { id: payrollId } })
      if (!record) throw NotFound('That payroll record no longer exists.')
      if (record.status === 'paid') {
        throw Conflict(
          'That run has been paid. Correct it with an adjustment in the next period rather than reopening it.'
        )
      }
      if (record.status !== 'approved') {
        throw Conflict('Only an approved run can be reopened.')
      }

      const row = await tx.payrollRecord.update({
        where: { id: payrollId },
        data: { status: 'draft', approvedAt: null, approvedById: null, lockedAt: null },
      })

      await recordAudit(
        {
          actor,
          action: 'unlock',
          entity: 'PayrollRecord',
          entityId: payrollId,
          summary: `Reopened ${row.reference}: ${trimmed}`,
          before: { status: 'approved' },
          after: { status: 'draft', reason: trimmed },
        },
        tx
      )

      return row
    })

    revalidatePath('/admin/payroll')
    revalidatePath('/finance/payroll')
    return actionOk({ status: updated.status })
  } catch (err) {
    return actionFailed(err, 'reopenPayrollRecord')
  }
}

/** Marks an approved run paid and tells the employee their payslip is ready. */
export async function markPayrollPaid(
  payrollId: string,
  paidOn?: string
): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireFinance()
    const payDate = paidOn ?? businessToday()

    const { record, staffRef } = await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollRecord.findUnique({ where: { id: payrollId } })
      if (!existing) throw NotFound('That payroll record no longer exists.')
      if (existing.status === 'paid') {
        throw Conflict('That run has already been paid.')
      }
      if (existing.status !== 'approved') {
        throw Conflict('Approve the run before marking it paid.')
      }

      const row = await tx.payrollRecord.update({
        where: { id: payrollId },
        data: { status: 'paid', paidOn: utcDate(payDate), lockedAt: existing.lockedAt ?? new Date() },
      })

      await recordAudit(
        {
          actor,
          action: 'payment',
          entity: 'PayrollRecord',
          entityId: payrollId,
          summary: `Paid ${row.reference} — net ${row.netPence}p on ${payDate}`,
          before: { status: 'approved' },
          after: { status: 'paid', paidOn: payDate, netPence: row.netPence },
        },
        tx
      )

      return { record: row, staffRef: row.staffRef }
    })

    // Outside the transaction: a notification failure must not roll back pay.
    await notify.payslipAvailable(
      staffRef,
      record.id,
      periodLabel(record.year, record.month)
    )

    revalidatePath('/admin/payroll')
    revalidatePath('/finance/payroll')
    revalidatePath('/crew/payslips')
    return actionOk({ status: record.status })
  } catch (err) {
    return actionFailed(err, 'markPayrollPaid')
  }
}

/** Approves every draft record in a period in one step. */
export async function approvePayrollPeriod(
  input: unknown
): Promise<ActionResult<{ approved: number; failed: Array<{ staffRef: string; reason: string }> }>> {
  try {
    await requireFinance()
    const { year, month } = parseOrThrow(payrollRunSchema, input)

    const drafts = await prisma.payrollRecord.findMany({
      where: { year, month, status: 'draft' },
      select: { id: true, staffRef: true },
    })

    let approved = 0
    const failed: Array<{ staffRef: string; reason: string }> = []
    for (const draft of drafts) {
      const result = await approvePayrollRecord(draft.id)
      if (result.ok) approved += 1
      else failed.push({ staffRef: draft.staffRef, reason: result.error })
    }

    revalidatePath('/admin/payroll')
    revalidatePath('/finance/payroll')
    return actionOk({ approved, failed })
  } catch (err) {
    return actionFailed(err, 'approvePayrollPeriod')
  }
}

export type PayslipDetail = {
  id: string
  reference: string
  year: number
  month: number
  label: string
  status: string
  baseGrossPence: number
  grossPence: number
  taxPence: number
  niPence: number
  pensionPence: number
  netPence: number
  taxCode: string
  niCategory: string
  daysWorked: number
  dayRatePence: number | null
  paidOn: string | null
  adjustments: Array<{ label: string; amountPence: number; taxable: boolean }>
}

/**
 * Payslip history for an employee, newest first.
 *
 * Replaces the single-record `getCrewLatestPayslip` the crew page used, which
 * discarded every other record and left the page computing year-to-date by
 * multiplying one month by a hardcoded `periods = 1`.
 */
export async function getPayslipHistory(
  staffRef?: string,
  taxYearStart?: number
): Promise<PayslipDetail[]> {
  const actor = await requireStaffAccessFor(staffRef)
  const ref = staffRef ?? actor.staff!.ref

  const rows = await prisma.payrollRecord.findMany({
    where: {
      staffRef: ref,
      status: { in: ['approved', 'paid'] },
      ...(taxYearStart === undefined
        ? {}
        : {
            OR: [
              { year: taxYearStart, month: { gte: 4 } },
              { year: taxYearStart + 1, month: { lte: 3 } },
            ],
          }),
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: { adjustments: { select: { label: true, amountPence: true, taxable: true } } },
  })

  return rows.map((p) => ({
    id: p.id,
    reference: p.reference,
    year: p.year,
    month: p.month,
    label: periodLabel(p.year, p.month),
    status: p.status,
    baseGrossPence: p.baseGrossPence,
    grossPence: p.grossPence,
    taxPence: p.taxPence,
    niPence: p.niPence,
    pensionPence: p.pensionPence,
    netPence: p.netPence,
    taxCode: p.taxCode,
    niCategory: p.niCategory,
    daysWorked: p.daysWorked,
    dayRatePence: p.dayRatePence,
    paidOn: p.paidOn ? fromStoredDate(p.paidOn) : null,
    adjustments: p.adjustments,
  }))
}

async function requireStaffAccessFor(staffRef?: string) {
  const { requireStaff } = await import('@/app/lib/authz')
  if (!staffRef) return requireStaff()
  const actor = await requireStaffAccess(staffRef)
  return actor
}

/** The period the payroll screens default to. */
export async function getPayrollPeriod() {
  return currentPeriod()
}
