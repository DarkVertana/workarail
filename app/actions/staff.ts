'use server'

/**
 * Employee lifecycle beyond creation and offboarding.
 *
 * `EmploymentStatus` has six values and only two were reachable: an admin
 * could *create* someone in any status, but the only transition action was
 * `offboardStaff`, which writes `leaver`. There was no suspend, no notice
 * period, no reinstate, no archive, and no general staff update action at all
 * — `updateStaffDates` touched only the birthday and join date. So
 * `Staff.noticeDate` was never written, an employee's address or bank details
 * could never be corrected after creation, and a suspended employee was a
 * concept the database could hold but the product could not produce.
 *
 * The lifecycle this implements:
 *
 *     onboarding --activate--> active <--reinstate--+
 *                                |  |               |
 *                       suspend  |  |  notice       |
 *                                v  v               |
 *                          suspended  notice -------+
 *                                |       |
 *                                +--> leaver --archive--> archived
 *
 * Nothing here deletes. Employment history is evidence behind approved
 * timesheets, payroll and compliance records, and the foreign keys are now
 * `Restrict` precisely so it cannot be destroyed.
 */

import { revalidatePath } from 'next/cache'

import { prisma } from '@/app/lib/prisma'
import { recordAudit } from '@/app/lib/audit'
import { requireAdmin, requireStaffAccess, requireActor } from '@/app/lib/authz'
import {
  actionFailed,
  actionOk,
  Conflict,
  NotFound,
  type ActionResult,
} from '@/app/lib/errors'
import { notify } from '@/app/lib/notifications'
import { businessToday, fromStoredDate, utcDate } from '@/app/lib/dates'
import {
  noticeStaffSchema,
  parseOrThrow,
  roleChangeSchema,
  suspendStaffSchema,
  updateStaffSchema,
} from '@/app/lib/validation'
import type { EmploymentStatus } from '@/generated/prisma'

/** Transitions the product allows, as an explicit table. */
const ALLOWED: Record<EmploymentStatus, EmploymentStatus[]> = {
  onboarding: ['active', 'leaver', 'archived'],
  active: ['suspended', 'notice', 'leaver'],
  suspended: ['active', 'notice', 'leaver'],
  notice: ['leaver', 'active'],
  leaver: ['archived', 'active'],
  archived: [],
}

function assertTransition(from: EmploymentStatus, to: EmploymentStatus) {
  if (!ALLOWED[from].includes(to)) {
    throw Conflict(`An employee cannot go from ${from} to ${to}.`)
  }
}

/**
 * Suspends an employee: access is withdrawn, the employment continues.
 *
 * `requireStaff` previously blocked `leaver` and `archived` but not
 * `suspended`, so a suspended employee kept full self-service access —
 * submitting timesheets and claiming expenses while suspended. That guard is
 * fixed in authz; this is the action that produces the state.
 */
export async function suspendStaff(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(suspendStaffSchema, input)

    await prisma.$transaction(async (tx) => {
      const person = await tx.staff.findUnique({
        where: { ref: data.ref },
        select: { ref: true, name: true, employmentStatus: true, userId: true },
      })
      if (!person) throw NotFound('No such employee.')
      assertTransition(person.employmentStatus, 'suspended')

      await tx.staff.update({
        where: { ref: data.ref },
        data: {
          employmentStatus: 'suspended',
          suspendedAt: new Date(),
          suspensionReason: data.reason,
        },
      })

      // Withdraw the login too. Suspension that leaves the account usable is
      // not a suspension.
      if (person.userId) {
        await tx.user.update({ where: { id: person.userId }, data: { isActive: false } })
        await tx.session.deleteMany({ where: { userId: person.userId } })
      }

      await recordAudit(
        {
          actor,
          action: 'suspend',
          entity: 'Staff',
          entityId: data.ref,
          summary: `Suspended ${person.name}: ${data.reason}`,
          before: { employmentStatus: person.employmentStatus },
          after: { employmentStatus: 'suspended', reason: data.reason },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'suspendStaff')
  }
}

/** Lifts a suspension and restores the login. */
export async function reinstateStaff(
  ref: string,
  reason: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    const trimmed = String(reason ?? '').trim()
    if (trimmed.length < 3) throw Conflict('Give a reason for reinstating.')

    await prisma.$transaction(async (tx) => {
      const person = await tx.staff.findUnique({
        where: { ref },
        select: { ref: true, name: true, employmentStatus: true, userId: true },
      })
      if (!person) throw NotFound('No such employee.')
      assertTransition(person.employmentStatus, 'active')

      await tx.staff.update({
        where: { ref },
        data: {
          employmentStatus: 'active',
          suspendedAt: null,
          suspensionReason: null,
          endDate: null,
          noticeDate: null,
          leaverReason: null,
        },
      })

      if (person.userId) {
        await tx.user.update({ where: { id: person.userId }, data: { isActive: true } })
      }

      await recordAudit(
        {
          actor,
          action: 'reinstate',
          entity: 'Staff',
          entityId: ref,
          summary: `Reinstated ${person.name}: ${trimmed}`,
          before: { employmentStatus: person.employmentStatus },
          after: { employmentStatus: 'active', reason: trimmed },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'reinstateStaff')
  }
}

/**
 * Puts an employee on notice with a known leaving date.
 *
 * Distinct from offboarding: the person is still employed and still working,
 * so their access continues, but the roster and payroll now know when they
 * finish. `Staff.noticeDate` existed and nothing ever wrote it.
 */
export async function placeOnNotice(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(noticeStaffSchema, input)

    if (data.endDate < data.noticeDate) {
      throw Conflict('The leaving date is before notice was given.')
    }

    await prisma.$transaction(async (tx) => {
      const person = await tx.staff.findUnique({
        where: { ref: data.ref },
        select: { ref: true, name: true, employmentStatus: true, joined: true },
      })
      if (!person) throw NotFound('No such employee.')
      assertTransition(person.employmentStatus, 'notice')

      if (data.endDate < fromStoredDate(person.joined)) {
        throw Conflict('The leaving date is before the employee joined.')
      }

      await tx.staff.update({
        where: { ref: data.ref },
        data: {
          employmentStatus: 'notice',
          noticeDate: utcDate(data.noticeDate),
          endDate: utcDate(data.endDate),
          leaverReason: data.reason,
        },
      })

      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'Staff',
          entityId: data.ref,
          summary: `${person.name} on notice from ${data.noticeDate}, leaving ${data.endDate}`,
          before: { employmentStatus: person.employmentStatus },
          after: {
            employmentStatus: 'notice',
            noticeDate: data.noticeDate,
            endDate: data.endDate,
            reason: data.reason,
          },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'placeOnNotice')
  }
}

/**
 * Archives a leaver, removing them from operational lists.
 *
 * Refused while anything is still outstanding, because archiving is what
 * makes a record stop appearing in the places someone would notice a problem.
 */
export async function archiveStaff(ref: string): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()

    await prisma.$transaction(async (tx) => {
      const person = await tx.staff.findUnique({
        where: { ref },
        select: { ref: true, name: true, employmentStatus: true, endDate: true },
      })
      if (!person) throw NotFound('No such employee.')
      assertTransition(person.employmentStatus, 'archived')

      const [openExpenses, openLeave, unpaidPayroll] = await Promise.all([
        tx.expense.count({
          where: { staffRef: ref, status: { in: ['submitted', 'approved'] } },
        }),
        tx.leaveRequest.count({ where: { staffRef: ref, status: 'pending' } }),
        tx.payrollRecord.count({
          where: { staffRef: ref, status: { in: ['draft', 'approved'] } },
        }),
      ])

      const blockers: string[] = []
      if (openExpenses) blockers.push(`${openExpenses} unsettled expense claim(s)`)
      if (openLeave) blockers.push(`${openLeave} pending leave request(s)`)
      if (unpaidPayroll) blockers.push(`${unpaidPayroll} unpaid payroll run(s)`)
      if (blockers.length) {
        throw Conflict(`Settle ${blockers.join(', ')} before archiving ${person.name}.`)
      }

      await tx.staff.update({ where: { ref }, data: { employmentStatus: 'archived' } })

      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'Staff',
          entityId: ref,
          summary: `Archived ${person.name}`,
          before: { employmentStatus: person.employmentStatus },
          after: { employmentStatus: 'archived' },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'archiveStaff')
  }
}

/** Completes onboarding, once the required documents are held. */
export async function activateStaff(ref: string): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    const { REQUIRED_DOCUMENT_KINDS } = await import('@/app/actions/documents')

    await prisma.$transaction(async (tx) => {
      const person = await tx.staff.findUnique({
        where: { ref },
        select: {
          ref: true, name: true, employmentStatus: true, dayRatePence: true,
          documents: { select: { kind: true, status: true, expiresOn: true } },
        },
      })
      if (!person) throw NotFound('No such employee.')
      assertTransition(person.employmentStatus, 'active')

      // An employee marked active without the paperwork behind them is the
      // exact semantic inconsistency this check exists to prevent: the roster
      // would show someone cleared for site who has no right-to-work record.
      const today = businessToday()
      const missing = REQUIRED_DOCUMENT_KINDS.filter(
        (kind) =>
          !person.documents.some(
            (d) =>
              d.kind === kind &&
              d.status === 'valid' &&
              (!d.expiresOn || fromStoredDate(d.expiresOn) >= today)
          )
      )
      if (missing.length) {
        throw Conflict(
          `${person.name} cannot be activated without a valid ${missing.map((k) => k.replace(/_/g, ' ')).join(' and ')} record.`
        )
      }
      if (person.dayRatePence === null) {
        throw Conflict(`Set ${person.name}'s day rate before activating them.`)
      }

      await tx.staff.update({ where: { ref }, data: { employmentStatus: 'active' } })

      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'Staff',
          entityId: ref,
          summary: `Activated ${person.name}`,
          before: { employmentStatus: person.employmentStatus },
          after: { employmentStatus: 'active' },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'activateStaff')
  }
}

/**
 * Updates an employee record.
 *
 * There was no general update action at all, so nothing collected at
 * onboarding could ever be corrected. Pay is deliberately excluded: a rate
 * change is effective-dated through `StaffPayRate` so historical payroll
 * stays reproducible, rather than being overwritten in place.
 */
export async function updateStaff(
  ref: string,
  input: unknown
): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(updateStaffSchema, input)

    await prisma.$transaction(async (tx) => {
      const before = await tx.staff.findUnique({
        where: { ref },
        select: {
          name: true, phone: true, role: true, jobTitle: true, crewId: true,
          managerRef: true, weeklyHours: true, contractType: true,
          annualLeaveDays: true, carryOverDays: true,
        },
      })
      if (!before) throw NotFound('No such employee.')

      if (data.managerRef === ref) {
        throw Conflict('An employee cannot be their own manager.')
      }

      await tx.staff.update({
        where: { ref },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle || null } : {}),
          ...(data.crewId !== undefined ? { crewId: data.crewId } : {}),
          ...(data.managerRef !== undefined ? { managerRef: data.managerRef } : {}),
          ...(data.weeklyHours !== undefined ? { weeklyHours: data.weeklyHours } : {}),
          ...(data.contractType !== undefined ? { contractType: data.contractType } : {}),
          ...(data.annualLeaveDays !== undefined
            ? { annualLeaveDays: data.annualLeaveDays }
            : {}),
          ...(data.carryOverDays !== undefined
            ? { carryOverDays: data.carryOverDays }
            : {}),
          ...(data.probationEndDate !== undefined
            ? {
                probationEndDate: data.probationEndDate
                  ? utcDate(data.probationEndDate)
                  : null,
              }
            : {}),
          ...(data.addressLine1 !== undefined ? { addressLine1: data.addressLine1 } : {}),
          ...(data.addressLine2 !== undefined ? { addressLine2: data.addressLine2 } : {}),
          ...(data.addressCity !== undefined ? { addressCity: data.addressCity } : {}),
          ...(data.addressPostcode !== undefined
            ? { addressPostcode: data.addressPostcode }
            : {}),
          ...(data.emergencyContactName !== undefined
            ? { emergencyContactName: data.emergencyContactName }
            : {}),
          ...(data.emergencyContactPhone !== undefined
            ? { emergencyContactPhone: data.emergencyContactPhone }
            : {}),
          ...(data.emergencyContactRelation !== undefined
            ? { emergencyContactRelation: data.emergencyContactRelation }
            : {}),
          ...(data.niNumber ? { niNumber: data.niNumber.toUpperCase() } : {}),
          ...(data.dateOfBirth !== undefined
            ? { dateOfBirth: data.dateOfBirth ? utcDate(data.dateOfBirth) : null }
            : {}),
          ...(data.preferredName !== undefined
            ? { preferredName: data.preferredName || null }
            : {}),
          ...(data.personalEmail !== undefined
            ? { personalEmail: data.personalEmail || null }
            : {}),
          ...(data.personalPhone !== undefined
            ? { personalPhone: data.personalPhone || null }
            : {}),
          ...(data.gender !== undefined ? { gender: data.gender } : {}),
          ...(data.nationality !== undefined
            ? { nationality: data.nationality || null }
            : {}),
          ...(data.addressCountry !== undefined
            ? { addressCountry: data.addressCountry || null }
            : {}),
          ...(data.internalNotes !== undefined
            ? { internalNotes: data.internalNotes || null }
            : {}),
          ...(data.payFrequency !== undefined
            ? { payFrequency: data.payFrequency }
            : {}),
          // Tax code, NI category and bank details are deliberately NOT
          // editable here. They are effective-dated records with their own
          // authorisation and audit path (`setPayrollProfile`, `addBankAccount`),
          // because overwriting them in place would silently change the basis
          // of payslips that have already been issued.
        },
      })

      // `before`/`after` carry only the non-sensitive fields; payroll identity
      // and home address are scrubbed by recordAudit in any case.
      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'Staff',
          entityId: ref,
          summary: `Updated ${Object.keys(data).join(', ')} for ${ref}`,
          before,
          after: {
            name: data.name ?? before.name,
            role: data.role ?? before.role,
            jobTitle: data.jobTitle ?? before.jobTitle,
            crewId: data.crewId ?? before.crewId,
            managerRef: data.managerRef ?? before.managerRef,
            weeklyHours: data.weeklyHours ?? before.weeklyHours,
          },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'updateStaff')
  }
}

/**
 * Records a new pay rate, effective from a date.
 *
 * Closes the previous rate rather than overwriting it, so a payroll run for a
 * past month still reads the rate that was in force then.
 */
export async function setPayRate(
  ref: string,
  dayRatePence: number,
  effectiveFrom: string
): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    if (!Number.isInteger(dayRatePence) || dayRatePence < 0) {
      throw Conflict('Enter a whole number of pence.')
    }

    await prisma.$transaction(async (tx) => {
      const person = await tx.staff.findUnique({
        where: { ref },
        select: { ref: true, name: true },
      })
      if (!person) throw NotFound('No such employee.')

      const effective = utcDate(effectiveFrom)
      const dayBefore = new Date(effective.getTime() - 86_400_000)

      await tx.staffPayRate.updateMany({
        where: { staffRef: ref, effectiveTo: null },
        data: { effectiveTo: dayBefore },
      })

      await tx.staffPayRate.create({
        data: {
          staffRef: ref,
          dayRatePence,
          effectiveFrom: effective,
          createdById: actor.user.id,
        },
      })

      // The staff record carries the *current* rate for convenience; the
      // history is the source of truth for any dated calculation.
      await tx.staff.update({ where: { ref }, data: { dayRatePence } })

      await recordAudit(
        {
          actor,
          action: 'update',
          entity: 'StaffPayRate',
          entityId: ref,
          summary: `Pay rate for ${person.name} set to ${dayRatePence}p/day from ${effectiveFrom}`,
          after: { dayRatePence, effectiveFrom },
        },
        tx
      )
    })

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'setPayRate')
  }
}

/**
 * Changes a user's access level.
 *
 * `AuditAction.role_change` and `notify.roleChanged` were both built for this
 * and had no producer — there was no way to promote anyone, so the only
 * ADMIN was whoever the bootstrap script created. Self-demotion is refused so
 * an organisation cannot lock itself out of its own administration.
 */
export async function changeUserRole(input: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requireAdmin()
    const data = parseOrThrow(roleChangeSchema, input)

    if (data.userId === actor.user.id) {
      throw Conflict('You cannot change your own role.')
    }

    const target = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: data.userId },
        select: { id: true, name: true, email: true, role: true },
      })
      if (!user) throw NotFound('No such user.')
      if (user.role === data.role) {
        throw Conflict(`${user.name} already has the ${data.role} role.`)
      }

      // Never remove the last administrator.
      if (user.role === 'ADMIN' && data.role !== 'ADMIN') {
        const admins = await tx.user.count({ where: { role: 'ADMIN', isActive: true } })
        if (admins <= 1) {
          throw Conflict('This is the only administrator; promote someone else first.')
        }
      }

      await tx.user.update({ where: { id: data.userId }, data: { role: data.role } })

      // A role change must not leave an elevated session running.
      await tx.session.deleteMany({ where: { userId: data.userId } })

      await recordAudit(
        {
          actor,
          action: 'role_change',
          entity: 'User',
          entityId: data.userId,
          summary: `${user.email}: ${user.role} → ${data.role} (${data.reason})`,
          before: { role: user.role },
          after: { role: data.role, reason: data.reason },
        },
        tx
      )

      return user
    })

    await notify.roleChanged(target.id, target.email, target.name, data.role)

    revalidatePath('/admin/crews')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'changeUserRole')
  }
}

/** The full employee record, for the admin detail view. */
export async function getStaffRecord(ref: string) {
  const actor = await requireActor()
  await requireStaffAccess(ref, actor)

  const sensitive = actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE'

  const person = await prisma.staff.findUnique({
    where: { ref },
    select: {
      ref: true, name: true, email: true, phone: true, role: true, jobTitle: true,
      employmentStatus: true, availability: true, contractType: true,
      joined: true, probationEndDate: true, noticeDate: true, endDate: true,
      leaverReason: true, suspendedAt: true, suspensionReason: true,
      weeklyHours: true, dayRatePence: true, annualLeaveDays: true, carryOverDays: true,
      birthday: true, dateOfBirth: true,
      addressLine1: true, addressLine2: true, addressCity: true, addressPostcode: true,
      emergencyContactName: true, emergencyContactPhone: true,
      emergencyContactRelation: true,
      crew: { select: { id: true, name: true } },
      manager: { select: { ref: true, name: true } },
      currentJob: { select: { id: true, reference: true, title: true } },
      user: { select: { id: true, role: true, isActive: true, lastLoginAt: true } },
      // Payroll identity only for those entitled to it.
      ...(sensitive
        ? {
            niNumber: true as const,
            taxCode: true as const,
            niCategory: true as const,
            bankSortCode: true as const,
            bankAccountLast4: true as const,
          }
        : {}),
    },
  })
  if (!person) throw NotFound('No such employee.')
  return person
}
