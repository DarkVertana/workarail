'use server'

/**
 * Employee bank details and PAYE profile.
 *
 * Both are treated as payroll-sensitive: every read is authorised server-side
 * rather than by hiding a button, and no action here ever returns a decrypted
 * account number. The only exception is `resolvePaymentInstruction`, which is
 * not exported to the client and exists solely so a pay run can produce a BACS
 * file.
 */

import { prisma } from '@/app/lib/prisma'
import {
  requireActor,
  requireFinance,
  requireAdmin,
  canSeeBankDetails,
  type Actor,
} from '@/app/lib/authz'
import { recordAudit } from '@/app/lib/audit'
import { actionFailed, type ActionResult, AppError } from '@/app/lib/errors'
import { parseOrThrow } from '@/app/lib/validation'
import { bankAccountSchema, payrollProfileSchema } from '@/app/lib/validation'
import {
  prepareBankAccount,
  toDisplay,
  decryptBankValue,
  type BankAccountDisplay,
} from '@/app/lib/bank'
import { parseTaxCode } from '@/app/lib/hmrc'
import { utcDate, businessToday } from '@/app/lib/dates'

/**
 * Whether the actor may read this employee's bank details.
 *
 * Finance and admin may read anyone's. An employee may read their own, because
 * they need to confirm where their wages are going — but they receive the same
 * masked projection as everyone else, never the digits.
 */
async function assertCanReadBank(actor: Actor, staffRef: string) {
  if (canSeeBankDetails(actor)) return
  if (actor.staff && actor.staff.ref === staffRef) return
  throw new AppError('You do not have access to these bank details.', 403)
}

/**
 * Only finance and admin may write bank details, including an employee's own.
 *
 * Self-service editing is deliberately excluded: redirecting salary by
 * changing your own payment details is a classic payroll fraud, and the
 * control against it is that a second person makes the change and a third
 * verifies it.
 */
async function assertCanWriteBank() {
  return requireFinance()
}

export async function getBankAccounts(
  staffRef: string
): Promise<BankAccountDisplay[]> {
  const actor = await requireActor()
  await assertCanReadBank(actor, staffRef)

  const rows = await prisma.staffBankAccount.findMany({
    where: { staffRef },
    orderBy: [{ isPrimary: 'desc' }, { effectiveFrom: 'desc' }],
  })
  return rows.map(toDisplay)
}

/** The current employee's own accounts, masked. */
export async function getMyBankAccounts(): Promise<BankAccountDisplay[]> {
  const actor = await requireActor()
  if (!actor.staff) return []
  return getBankAccounts(actor.staff.ref)
}

/**
 * Adds a bank account, superseding the existing primary one.
 *
 * The previous primary is closed off rather than overwritten so that a payslip
 * already issued still points at the account it was actually paid into.
 */
export async function addBankAccount(
  input: unknown
): Promise<ActionResult<{ id: string; accountMask: string }>> {
  try {
    const actor = await assertCanWriteBank()
    const data = parseOrThrow(bankAccountSchema, input)

    const staff = await prisma.staff.findUnique({
      where: { ref: data.staffRef },
      select: { ref: true, name: true },
    })
    if (!staff) throw new AppError('That employee does not exist.', 404)

    const prepared = prepareBankAccount({
      method: data.method,
      accountNumber: data.accountNumber,
      sortCode: data.sortCode,
      iban: data.iban,
      bic: data.bic,
    })

    const effectiveFrom = utcDate(data.effectiveFrom)

    const created = await prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        // Close the outgoing primary. The partial unique index would reject a
        // second primary row, so this must happen first and in the same
        // transaction.
        await tx.staffBankAccount.updateMany({
          where: { staffRef: data.staffRef, isPrimary: true },
          data: { isPrimary: false, effectiveTo: effectiveFrom },
        })
      }

      return tx.staffBankAccount.create({
        data: {
          staffRef: data.staffRef,
          accountHolderName: data.accountHolderName,
          bankName: data.bankName ?? null,
          method: data.method,
          ...prepared,
          isPrimary: data.isPrimary,
          effectiveFrom,
          createdById: actor.user.id,
        },
      })
    })

    // The audit records the mask and never the digits: enough to prove which
    // account was set and by whom, without turning the log into a target.
    await recordAudit({
      actor,
      action: 'update',
      entity: 'StaffBankAccount',
      entityId: created.id,
      summary: `Set bank details for ${staff.name}`,
      after: {
        staffRef: data.staffRef,
        accountHolderName: data.accountHolderName,
        method: data.method,
        accountMask: `****${prepared.accountLast4}`,
        sortCodeMask: `**-**-${prepared.sortCodeLast2}`,
        isPrimary: data.isPrimary,
      },
    })

    return {
      ok: true,
      data: { id: created.id, accountMask: `****${prepared.accountLast4}` },
    }
  } catch (error) {
    return actionFailed(error, 'bank.add')
  }
}

/**
 * Marks an account as checked against evidence.
 *
 * Separated from creation so that the person who enters the details is not
 * necessarily the person who approves them — payroll refuses to pay an
 * unverified account.
 */
export async function verifyBankAccount(
  id: string
): Promise<ActionResult<{ verified: true }>> {
  try {
    const actor = await requireFinance()

    const account = await prisma.staffBankAccount.findUnique({
      where: { id },
      select: { id: true, staffRef: true, createdById: true, verifiedAt: true },
    })
    if (!account) throw new AppError('That bank account does not exist.', 404)
    if (account.verifiedAt) {
      throw new AppError('Those details have already been verified.', 409)
    }
    if (account.createdById === actor.user.id) {
      throw new AppError(
        'Bank details must be verified by someone other than the person who entered them.',
        403
      )
    }

    await prisma.staffBankAccount.update({
      where: { id },
      data: { verifiedAt: new Date(), verifiedById: actor.user.id },
    })

    await recordAudit({
      actor,
      action: 'approve',
      entity: 'StaffBankAccount',
      entityId: id,
      summary: `Verified bank details for ${account.staffRef}`,
    })

    return { ok: true, data: { verified: true } }
  } catch (error) {
    return actionFailed(error, 'bank.verify')
  }
}

/**
 * Decrypts an employee's primary account for a payment run.
 *
 * Admin-only, audited on every call, and never reachable from the browser —
 * it exists so a BACS file can be produced. Returns null when the employee
 * has no verified primary account, which is what stops payroll paying into
 * details nobody has checked.
 */
export async function resolvePaymentInstruction(
  staffRef: string,
  reason: string
): Promise<ActionResult<{ accountNumber: string; sortCode: string } | null>> {
  try {
    const actor = await requireAdmin()
    if (!reason?.trim()) {
      throw new AppError('A reason is required to read payment details.', 400)
    }

    const account = await prisma.staffBankAccount.findFirst({
      where: { staffRef, isPrimary: true, verifiedAt: { not: null } },
    })
    if (!account) return { ok: true, data: null }

    await recordAudit({
      actor,
      action: 'view_sensitive',
      entity: 'StaffBankAccount',
      entityId: account.id,
      summary: `Read payment details for ${staffRef}`,
      after: { reason: reason.trim() },
    })

    return {
      ok: true,
      data: {
        accountNumber: decryptBankValue(account.accountNumberEnc),
        sortCode: decryptBankValue(account.sortCodeEnc),
      },
    }
  } catch (error) {
    return actionFailed(error, 'bank.resolve')
  }
}

// ---------------------------------------------------------------------------
// PAYE profile
// ---------------------------------------------------------------------------

export type PayrollProfileView = {
  id: string
  taxCode: string
  basis: 'cumulative' | 'week1_month1'
  niCategory: string
  studentLoanPlan: number | null
  postgradLoan: boolean
  effectiveFrom: string
  effectiveTo: string | null
  source: string | null
}

/** Full tax code history for an employee. Finance/admin, or the employee. */
export async function getPayrollProfiles(
  staffRef: string
): Promise<PayrollProfileView[]> {
  const actor = await requireActor()
  await assertCanReadBank(actor, staffRef)

  const rows = await prisma.staffPayrollProfile.findMany({
    where: { staffRef },
    orderBy: { effectiveFrom: 'desc' },
  })

  return rows.map((r) => ({
    id: r.id,
    taxCode: r.taxCode,
    basis: r.basis,
    niCategory: r.niCategory,
    studentLoanPlan: r.studentLoanPlan,
    postgradLoan: r.postgradLoan,
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
    source: r.source,
  }))
}

/**
 * Records a new PAYE arrangement from a given date.
 *
 * Supersedes rather than mutates. A tax code change part-way through a year is
 * routine, and the previous code must remain readable so an already-issued
 * payslip continues to explain itself.
 */
export async function setPayrollProfile(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireFinance()
    const data = parseOrThrow(payrollProfileSchema, input)

    // Rejects an unusable code before it can reach a pay run.
    parseTaxCode(data.taxCode)

    const staff = await prisma.staff.findUnique({
      where: { ref: data.staffRef },
      select: { ref: true, name: true },
    })
    if (!staff) throw new AppError('That employee does not exist.', 404)

    const effectiveFrom = utcDate(data.effectiveFrom)

    const previous = await prisma.staffPayrollProfile.findFirst({
      where: { staffRef: data.staffRef, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    })

    const created = await prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.staffPayrollProfile.update({
          where: { id: previous.id },
          data: { effectiveTo: effectiveFrom },
        })
      }
      return tx.staffPayrollProfile.create({
        data: {
          staffRef: data.staffRef,
          taxCode: data.taxCode.toUpperCase(),
          basis: data.basis,
          niCategory: data.niCategory.toUpperCase(),
          studentLoanPlan: data.studentLoanPlan ?? null,
          postgradLoan: data.postgradLoan,
          effectiveFrom,
          source: data.source ?? 'manual',
          createdById: actor.user.id,
        },
      })
    })

    await recordAudit({
      actor,
      action: 'update',
      entity: 'StaffPayrollProfile',
      entityId: created.id,
      summary: `Tax code for ${staff.name} set to ${data.taxCode.toUpperCase()}`,
      before: previous
        ? { taxCode: previous.taxCode, basis: previous.basis, niCategory: previous.niCategory }
        : undefined,
      after: {
        taxCode: data.taxCode.toUpperCase(),
        basis: data.basis,
        niCategory: data.niCategory.toUpperCase(),
        effectiveFrom: data.effectiveFrom,
        source: data.source ?? 'manual',
      },
    })

    return { ok: true, data: { id: created.id } }
  } catch (error) {
    return actionFailed(error, 'payrollProfile.set')
  }
}

/**
 * The PAYE arrangement in force on a given date.
 *
 * Payroll calls this with the pay date rather than reading "the current
 * profile", so recalculating an old period uses the code that actually applied
 * at the time.
 */
export async function payrollProfileOn(staffRef: string, on: Date) {
  return prisma.staffPayrollProfile.findFirst({
    where: {
      staffRef,
      effectiveFrom: { lte: on },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  })
}

/** Whether payroll has everything it needs to pay this employee. */
export async function payrollReadiness(staffRef: string) {
  const today = utcDate(businessToday())
  const [profile, account] = await Promise.all([
    payrollProfileOn(staffRef, today),
    prisma.staffBankAccount.findFirst({
      where: { staffRef, isPrimary: true },
      select: { id: true, verifiedAt: true },
    }),
  ])

  const blockers: string[] = []
  if (!profile) blockers.push('No tax code on record')
  else if (!profile.taxCode) blockers.push('Tax code is empty')
  if (!account) blockers.push('No bank details on record')
  else if (!account.verifiedAt) blockers.push('Bank details are not verified')

  return { ready: blockers.length === 0, blockers, profile, account }
}
