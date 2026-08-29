/**
 * Admin-only audit log reader. JSON, no UI.
 *
 * The audit trail answers "who changed what, when, and from what value to
 * what value" — it was being written diligently and had no reader at all
 * (`auditTrailFor` in app/lib/audit.ts has no caller). This route is that
 * reader: paste a URL in the browser and get the trail back.
 *
 * ADMIN only, deliberately. The trail spans every entity in the system
 * including payroll and settings changes, so it is not scoped to a crew and
 * is not offered to FINANCE or MANAGER.
 *
 *   GET /api/admin/audit
 *   GET /api/admin/audit?entity=Invoice&entityId=INV-0042
 *   GET /api/admin/audit?action=role_change&take=100
 *   GET /api/admin/audit?actor=someone@example.com&from=2026-08-01&to=2026-08-31
 *   GET /api/admin/audit?format=csv
 *
 * Query parameters
 *   entity    Model name, e.g. Invoice, Staff, PayrollRecord, Setting
 *   entityId  Specific record id; requires nothing else
 *   action    One of the AuditAction values
 *   actor     Actor email, exact match
 *   from,to   Business dates (YYYY-MM-DD), inclusive
 *   take      1..500, default 100
 *   cursor    Id of the last row from the previous page
 *   format    'json' (default) or 'csv'
 *
 * `before`/`after` payloads are already scrubbed of credentials and payroll
 * identity when they are written (see SENSITIVE_KEYS in app/lib/audit.ts), so
 * this route returns them as stored rather than re-filtering.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/app/lib/prisma'
import { requireAdmin } from '@/app/lib/authz'
import { errorResponse } from '@/app/lib/errors'
import { dayRange } from '@/app/lib/dates'
import type { AuditAction, Prisma } from '@/generated/prisma'

const AUDIT_ACTIONS = new Set<string>([
  'create', 'update', 'delete', 'approve', 'reject', 'cancel',
  'login', 'logout', 'login_failed', 'role_change', 'offboard',
  'suspend', 'reinstate', 'settings_change', 'payment', 'reimburse',
  'issue', 'lock', 'unlock', 'write_off',
])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin()

    const params = request.nextUrl.searchParams
    const take = Math.min(
      Math.max(Number(params.get('take') ?? 100) || 100, 1),
      500
    )

    const where: Prisma.AuditLogWhereInput = {}

    const entity = params.get('entity')
    if (entity) where.entity = entity

    const entityId = params.get('entityId')
    if (entityId) where.entityId = entityId

    const action = params.get('action')
    if (action) {
      if (!AUDIT_ACTIONS.has(action)) {
        return NextResponse.json(
          { error: `Unknown action '${action}'.`, allowed: [...AUDIT_ACTIONS].sort() },
          { status: 400 }
        )
      }
      where.action = action as AuditAction
    }

    const actorEmail = params.get('actor')
    if (actorEmail) where.actorEmail = actorEmail.toLowerCase()

    const from = params.get('from')
    const to = params.get('to')
    if (from || to) {
      if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
        return NextResponse.json(
          { error: 'Use YYYY-MM-DD for from and to.' },
          { status: 400 }
        )
      }
      // Business dates are inclusive of the whole final day.
      where.createdAt = dayRange(from ?? '2000-01-01', to ?? '2099-12-31')
    }

    const cursor = params.get('cursor')

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        actorEmail: true,
        actorUserId: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        before: true,
        after: true,
        ipAddress: true,
      },
    })

    const hasMore = rows.length > take
    const page = hasMore ? rows.slice(0, take) : rows

    if (params.get('format') === 'csv') {
      const header = [
        'createdAt', 'actorEmail', 'action', 'entity', 'entityId',
        'summary', 'before', 'after', 'ipAddress',
      ]
      const body = page.map((r) =>
        [
          r.createdAt.toISOString(), r.actorEmail, r.action, r.entity,
          r.entityId, r.summary, r.before, r.after, r.ipAddress,
        ].map(csvCell).join(',')
      )
      return new NextResponse([header.join(','), ...body].join('\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="audit.csv"',
          'Cache-Control': 'private, no-store',
        },
      })
    }

    return NextResponse.json(
      {
        count: page.length,
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]?.id : null,
        filters: {
          entity: entity ?? null,
          entityId: entityId ?? null,
          action: action ?? null,
          actor: actorEmail ?? null,
          from: from ?? null,
          to: to ?? null,
        },
        entries: page.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (err) {
    return errorResponse(err, 'GET /api/admin/audit')
  }
}
