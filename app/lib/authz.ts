/**
 * Centralised authentication and authorization.
 *
 * The previous model inferred administrator rights from the *absence* of a
 * Staff row, which failed open: any account without a staff record — including
 * one created by the sign-in fallthrough — was treated as an administrator.
 * Authorization is now read from an explicit `User.role` column and enforced
 * here, in one place, by both Server Actions and API routes.
 *
 * Every privileged operation must call one of these guards. Layout checks and
 * hidden buttons are presentation, not authorization.
 */

import 'server-only'

import { headers } from 'next/headers'
import { auth } from '@/app/lib/auth'
import { prisma } from '@/app/lib/prisma'
import type { Staff, User, UserRole } from '@/generated/prisma'

export class AuthError extends Error {
  constructor(
    message: string,
    /** HTTP status an API route should map this to. */
    readonly status: 401 | 403 | 404,
    readonly code: 'unauthenticated' | 'forbidden' | 'not_found'
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export const Unauthenticated = () =>
  new AuthError('You are not signed in.', 401, 'unauthenticated')

export const Forbidden = (what = 'You do not have access to this.') =>
  new AuthError(what, 403, 'forbidden')

/** Role hierarchy for coarse checks. Higher grants everything lower grants. */
const RANK: Record<UserRole, number> = {
  CREW: 0,
  MANAGER: 1,
  FINANCE: 2,
  ADMIN: 3,
}

export type Actor = {
  user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'isActive'>
  /** The staff record this user owns, when they are also an employee. */
  staff: Staff | null
  ip: string | null
  userAgent: string | null
}

/**
 * Resolves the caller from the session cookie. Returns null when there is no
 * valid session, so callers can decide between redirecting and 401-ing.
 */
export async function getActor(): Promise<Actor | null> {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  if (!session?.user?.email) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null

  const staff = await prisma.staff.findFirst({
    where: { userId: user.id, deletedAt: null },
  })

  return {
    user,
    staff,
    ip:
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      h.get('x-real-ip') ??
      null,
    userAgent: h.get('user-agent'),
  }
}

/** Any signed-in, active user. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw Unauthenticated()
  return actor
}

/** Caller must hold one of the listed roles exactly. */
export async function requireRole(...roles: UserRole[]): Promise<Actor> {
  const actor = await requireActor()
  if (!roles.includes(actor.user.role)) {
    throw Forbidden(
      `This action requires the ${roles.join(' or ')} role.`
    )
  }
  return actor
}

/** Caller must hold at least the given role in the hierarchy. */
export async function requireAtLeast(role: UserRole): Promise<Actor> {
  const actor = await requireActor()
  if (RANK[actor.user.role] < RANK[role]) {
    throw Forbidden(`This action requires at least the ${role} role.`)
  }
  return actor
}

/** Administrative operations: staff records, settings, roles. */
export const requireAdmin = () => requireRole('ADMIN')

/** Money operations: invoices, payments, payroll, expense reimbursement. */
export const requireFinance = () => requireRole('ADMIN', 'FINANCE')

/** Approval operations: leave, timesheets, expenses. */
export const requireApprover = () =>
  requireRole('ADMIN', 'FINANCE', 'MANAGER')

/**
 * Caller must be an employee. Returns the actor together with a non-null
 * staff record, so self-service actions can derive the subject from the
 * session instead of trusting a client-supplied reference.
 */
export async function requireStaff(): Promise<Actor & { staff: Staff }> {
  const actor = await requireActor()
  if (!actor.staff) {
    throw Forbidden('This area is for employees only.')
  }
  // `suspended` was previously absent from this list, so a suspended employee
  // kept full self-service access — submitting timesheets and claiming
  // expenses throughout their suspension.
  if (
    actor.staff.employmentStatus === 'leaver' ||
    actor.staff.employmentStatus === 'archived' ||
    actor.staff.employmentStatus === 'suspended'
  ) {
    throw Forbidden('This employee record is not currently active.')
  }
  return actor as Actor & { staff: Staff }
}

/**
 * Resource-level authorization for anything scoped to one employee.
 *
 * Role alone is not sufficient: a MANAGER may only reach their own crew, and
 * a CREW member may only ever reach themselves. This is the check that closes
 * the payslip IDOR — a crew member passing another employee's reference is
 * rejected here rather than being trusted.
 */
export async function requireStaffAccess(
  staffRef: string,
  actorOverride?: Actor
): Promise<Actor> {
  const actor = actorOverride ?? (await requireActor())

  // Admin and finance see the whole organisation.
  if (actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE') {
    return actor
  }

  // Everyone else can always reach their own record.
  if (actor.staff && actor.staff.ref === staffRef) return actor

  // A manager reaches their direct reports and their own crew.
  if (actor.user.role === 'MANAGER' && actor.staff) {
    const subject = await prisma.staff.findUnique({
      where: { ref: staffRef },
      select: { managerRef: true, crewId: true },
    })
    if (!subject) throw Forbidden('No such employee.')
    const sameCrew =
      subject.crewId !== null && subject.crewId === actor.staff.crewId
    if (subject.managerRef === actor.staff.ref || sameCrew) return actor
  }

  throw Forbidden("You do not have access to this employee's records.")
}

/**
 * Resolves the concrete staff references an actor may see.
 *
 * This predicate previously lived inline in `getLeaveRequests` and
 * `getExpenses` and nowhere else, so six other list actions carrying the same
 * `requireApprover` guard returned the whole organisation to a MANAGER — the
 * roster with contact details, org-wide attendance, and every recent leave,
 * expense and invoice. Defining it once is the fix; every list of people or
 * of records belonging to people must apply it.
 *
 * A MANAGER reaches their direct reports and their own crew, plus themselves.
 * A CREW member reaches only themselves. Returns null when the actor sees
 * everything, so callers can omit the filter entirely rather than building a
 * list of every employee.
 */
export async function visibleStaffRefs(actor: Actor): Promise<string[] | null> {
  if (actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE') return null

  const self = actor.staff?.ref
  if (actor.user.role !== 'MANAGER') return self ? [self] : []

  if (!actor.staff) return []
  const team = await prisma.staff.findMany({
    where: {
      deletedAt: null,
      OR: [
        { managerRef: actor.staff.ref },
        ...(actor.staff.crewId ? [{ crewId: actor.staff.crewId }] : []),
      ],
    },
    select: { ref: true },
  })

  return Array.from(new Set([...team.map((s) => s.ref), ...(self ? [self] : [])]))
}

/**
 * Convenience wrapper: a `staffRef` filter for the actor, or `{}` when they
 * see everything. Spread it into a Prisma `where`.
 */
export async function staffRefFilter(
  actor: Actor
): Promise<{ staffRef?: { in: string[] } }> {
  const refs = await visibleStaffRefs(actor)
  return refs === null ? {} : { staffRef: { in: refs } }
}

/** True when the actor may see money-sensitive fields on a staff record. */
export function canSeeSensitiveStaffFields(actor: Actor): boolean {
  return actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE'
}

/**
 * Payroll-identity fields. These never travel to a browser except on the
 * dedicated admin/finance staff record, and never appear in an audit snapshot.
 */
export const SENSITIVE_STAFF_FIELDS = [
  'niNumber',
  // Retained so that any legacy shape still carrying these keys is scrubbed
  // even though they no longer exist as columns. The tax code and NI category
  // now live on StaffPayrollProfile and bank details on StaffBankAccount, both
  // of which are guarded at the query level rather than by redaction.
  'taxCode',
  'niCategory',
  'bankSortCode',
  'bankAccountLast4',
  'internalNotes',
] as const

/**
 * True when the actor may see an employee's bank details.
 *
 * Deliberately narrower than `canSeeSensitiveStaffFields`: a manager may need
 * an NI number for a compliance check but never needs payment details, and
 * only finance and admin can operate a pay run. An employee's access to their
 * *own* account is handled separately, and even then only the masked form is
 * returned.
 */
export function canSeeBankDetails(actor: Actor): boolean {
  return actor.user.role === 'ADMIN' || actor.user.role === 'FINANCE'
}

/**
 * Strips payroll-identity fields for callers not entitled to them.
 *
 * This existed but was called from nowhere, so `getCrewSession` was returning
 * the raw Staff row — NI number, tax code, sort code, date of birth and home
 * address — into the page payload of every crew request. Keys are deleted
 * rather than set to `undefined` so the values cannot survive serialisation.
 */
export function redactStaff<T extends Partial<Staff>>(staff: T, actor: Actor): T {
  if (canSeeSensitiveStaffFields(actor)) return staff
  const copy: Record<string, unknown> = { ...staff }
  for (const field of SENSITIVE_STAFF_FIELDS) delete copy[field]
  return copy as T
}

/**
 * The projection a self-service page may receive about its own employee.
 *
 * An employee legitimately sees their own address and emergency contact — they
 * need to be able to check and correct them — but their NI number, tax code
 * and bank details are only ever needed by payroll, so they stay server-side.
 */
export const SELF_STAFF_SELECT = {
  ref: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  jobTitle: true,
  employmentStatus: true,
  availability: true,
  contractType: true,
  joined: true,
  endDate: true,
  weeklyHours: true,
  crewId: true,
  currentJobId: true,
  managerRef: true,
  birthday: true,
  dateOfBirth: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressPostcode: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  annualLeaveDays: true,
  carryOverDays: true,
} as const
