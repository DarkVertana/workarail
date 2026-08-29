/**
 * Application settings — one authoritative store.
 *
 * Replaces the previous three-way split between app/lib/settings.json (written
 * into the source tree with fs.writeFileSync, so it diverged per replica and
 * never survived a deploy), the SmtpSettings table, and environment fallbacks.
 *
 * Two invariants:
 *  - Updates are a validated patch merged onto the current values, so posting
 *    one field can no longer erase every other setting.
 *  - Secrets are sealed with AES-256-GCM and are never returned to a caller.
 *    `getSettings()` is safe to send to a client; `getSmtpCredentials()` is
 *    the only way to open the password and is used solely by the mailer.
 */

import 'server-only'

import { prisma } from '@/app/lib/prisma'
import { decryptSecret, encryptSecret } from '@/app/lib/secrets'
import type { Prisma } from '@/generated/prisma'

export type AppSettings = {
  company: string
  email: string
  timezone: string
  currency: string
  payday: string
  /** Personal allowance used by the simplified payroll engine, in pence. */
  allowancePence: number
  tax: number
  ni: number
  pension: number
  leaveDays: number
  carryOver: number
  workingDays: 'Monday to Friday' | 'Monday to Saturday'
  standardDay: number
  notifyLeave: boolean
  notifyExpenses: boolean
  notifyPayroll: boolean
  notifyCelebrations: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpFrom: string
  /** Never the password itself — only whether one is configured. */
  smtpPasswordSet: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: 'Work à Rail',
  email: 'admin@workarail.com',
  timezone: 'Europe/London',
  currency: 'GBP',
  payday: 'Last working day',
  allowancePence: 104750,
  tax: 20,
  ni: 8,
  pension: 5,
  leaveDays: 28,
  carryOver: 5,
  workingDays: 'Monday to Friday',
  standardDay: 8,
  notifyLeave: true,
  notifyExpenses: true,
  notifyPayroll: true,
  notifyCelebrations: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpFrom: '',
  smtpPasswordSet: false,
}

/** Maps the flat settings object onto namespaced storage keys. */
const KEY_MAP: Record<keyof Omit<AppSettings, 'smtpPasswordSet'>, string> = {
  company: 'org.company',
  email: 'org.email',
  timezone: 'org.timezone',
  currency: 'org.currency',
  payday: 'payroll.payday',
  allowancePence: 'payroll.allowancePence',
  tax: 'payroll.taxPercent',
  ni: 'payroll.niPercent',
  pension: 'payroll.pensionPercent',
  leaveDays: 'leave.days',
  carryOver: 'leave.carryOver',
  workingDays: 'leave.workingDays',
  standardDay: 'leave.standardDay',
  notifyLeave: 'notify.leave',
  notifyExpenses: 'notify.expenses',
  notifyPayroll: 'notify.payroll',
  notifyCelebrations: 'notify.celebrations',
  smtpHost: 'smtp.host',
  smtpPort: 'smtp.port',
  smtpSecure: 'smtp.secure',
  smtpUser: 'smtp.user',
  smtpFrom: 'smtp.from',
}

/**
 * Settings change rarely and are read on nearly every request, so they are
 * cached in process with a short TTL. Writes clear the cache immediately.
 */
let cache: { value: AppSettings; at: number } | null = null
const TTL_MS = 30_000

export function invalidateSettingsCache() {
  cache = null
}

/** Client-safe settings. Contains no secret values, by construction. */
export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  let rows: Array<{ key: string; value: Prisma.JsonValue }> = []
  try {
    rows = await prisma.setting.findMany({
      where: { isSecret: false },
      select: { key: true, value: true },
    })
  } catch (err) {
    // A settings read must never take a page down; fall back to defaults.
    console.error('[settings] read failed, using defaults', err)
    return { ...DEFAULT_SETTINGS }
  }

  const stored = new Map(rows.map((r) => [r.key, r.value]))
  const result = { ...DEFAULT_SETTINGS }

  for (const [field, key] of Object.entries(KEY_MAP) as Array<
    [keyof Omit<AppSettings, 'smtpPasswordSet'>, string]
  >) {
    const raw = stored.get(key)
    if (raw !== undefined && raw !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(result as any)[field] = raw
    }
  }

  const secretRow = await prisma.setting
    .findUnique({ where: { key: 'smtp.pass' }, select: { key: true } })
    .catch(() => null)
  result.smtpPasswordSet = Boolean(secretRow)

  cache = { value: result, at: Date.now() }
  return result
}

/**
 * Applies a validated patch. Only the keys present are written; everything
 * else is left exactly as it was.
 *
 * `smtpPass` is write-only: omitted means "leave unchanged", empty string
 * means "remove the stored password", any other value is sealed and stored.
 */
export async function updateSettings(
  patch: Partial<Record<keyof AppSettings, unknown>> & { smtpPass?: string },
  actorUserId: string | null
): Promise<AppSettings> {
  const writes: Prisma.PrismaPromise<unknown>[] = []

  for (const [field, key] of Object.entries(KEY_MAP) as Array<
    [keyof Omit<AppSettings, 'smtpPasswordSet'>, string]
  >) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (value === undefined) continue
    writes.push(
      prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value: value as Prisma.InputJsonValue,
          isSecret: false,
          updatedById: actorUserId,
        },
        update: { value: value as Prisma.InputJsonValue, updatedById: actorUserId },
      })
    )
  }

  if (patch.smtpPass !== undefined) {
    if (patch.smtpPass === '') {
      writes.push(
        prisma.setting.deleteMany({ where: { key: 'smtp.pass' } })
      )
    } else {
      const sealed = encryptSecret(patch.smtpPass)
      writes.push(
        prisma.setting.upsert({
          where: { key: 'smtp.pass' },
          create: {
            key: 'smtp.pass',
            value: sealed,
            isSecret: true,
            updatedById: actorUserId,
          },
          update: { value: sealed, updatedById: actorUserId },
        })
      )
    }
  }

  if (writes.length > 0) {
    // All-or-nothing: settings must never be left half-applied.
    await prisma.$transaction(writes)
  }

  invalidateSettingsCache()
  return getSettings()
}

/**
 * Opens the SMTP credentials for the mailer. The only place a stored secret
 * is decrypted, and it never returns to a caller outside the server.
 */
export async function getSmtpCredentials(): Promise<{
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
} | null> {
  const settings = await getSettings()
  if (!settings.smtpHost || !settings.smtpUser) return null

  const row = await prisma.setting.findUnique({ where: { key: 'smtp.pass' } })
  if (!row) return null

  let pass: string
  try {
    pass = decryptSecret(String(row.value))
  } catch (err) {
    console.error('[settings] could not open the SMTP password', err)
    return null
  }

  return {
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    user: settings.smtpUser,
    pass,
    from: settings.smtpFrom || 'noreply@workarail.com',
  }
}
