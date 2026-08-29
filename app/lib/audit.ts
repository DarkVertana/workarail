/**
 * Audit trail.
 *
 * The settings screen has always carried an "audit log" switch with nothing
 * behind it. This is the subsystem it now refers to: an append-only record of
 * who changed what, kept outside the reach of ordinary users.
 *
 * Audit writes participate in the caller's transaction where one is supplied,
 * so an audited mutation and its record commit or roll back together.
 */

import 'server-only'

import { prisma } from '@/app/lib/prisma'
import type { Actor } from '@/app/lib/authz'
import type { AuditAction, Prisma } from '@/generated/prisma'

/**
 * Fields that must never be copied into an audit payload.
 *
 * The list previously stopped at NI number and sort code, so a new-starter
 * entry — which passed the whole created row as `after` — stored the
 * employee's tax code, date of birth, home address and emergency contact
 * numbers in a JSON column readable by anything that can query AuditLog.
 * It also named `bankAccountNumber`, which is not a column; the real field is
 * `bankAccountLast4`.
 */
const SENSITIVE_KEYS = new Set([
  // Credentials
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'smtpPass',
  'smtp.pass',
  // Payroll identity
  'niNumber',
  'niCategory',
  'taxCode',
  'bankSortCode',
  'bankAccountNumber',
  'bankAccountLast4',
  // Personal data that an audit trail does not need to reproduce
  'dateOfBirth',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressPostcode',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
])

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'object') return value as Prisma.InputJsonValue

  if (Array.isArray(value)) {
    return value.map((v) => scrub(v)) as Prisma.InputJsonValue
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[redacted]'
      continue
    }
    if (v instanceof Date) {
      out[k] = v.toISOString()
      continue
    }
    out[k] = typeof v === 'object' && v !== null ? scrub(v) : v
  }
  return out as Prisma.InputJsonValue
}

export type AuditInput = {
  actor: Actor | null
  action: AuditAction
  entity: string
  entityId: string
  summary?: string
  before?: unknown
  after?: unknown
}

/**
 * Records one audited change.
 *
 * Pass `tx` when the mutation runs inside a transaction so the audit entry is
 * atomic with it. Audit failures never mask the underlying operation, but they
 * are logged loudly because a silent gap in the trail is itself an incident.
 */
export async function recordAudit(
  input: AuditInput,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? prisma
  try {
    await client.auditLog.create({
      data: {
        actorUserId: input.actor?.user.id ?? null,
        actorEmail: input.actor?.user.email ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        summary: input.summary ?? null,
        before: scrub(input.before),
        after: scrub(input.after),
        ipAddress: input.actor?.ip ?? null,
        userAgent: input.actor?.userAgent ?? null,
      },
    })
  } catch (err) {
    if (tx) throw err // inside a transaction the caller decides
    console.error('[audit] failed to record audit entry', {
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      err,
    })
  }
}

/** Reads the trail for one entity. Admin-only; enforced by the caller. */
export async function auditTrailFor(entity: string, entityId: string, take = 50) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      summary: true,
      actorEmail: true,
      before: true,
      after: true,
      createdAt: true,
    },
  })
}
