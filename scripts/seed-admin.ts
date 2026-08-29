/**
 * Creates or promotes the first administrator.
 *
 * Public sign-up is disabled, so this is the supported way to bootstrap
 * access to a fresh environment. It replaces a version that hardcoded the
 * password "Pass1234" and connected with ssl:true regardless of the target.
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com npx tsx scripts/seed-admin.ts
 *
 * The password is read from ADMIN_PASSWORD, or generated and printed once if
 * that is not set. It is never written to a file or committed.
 */

import 'dotenv/config'
import crypto from 'crypto'
// Reuse the application's client: this Prisma version needs a driver adapter,
// and the SSL decision depends on the connection string.
import { prisma } from '../app/lib/prisma'

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = crypto.scryptSync(password, salt, 64)
  return `${salt}:${derivedKey.toString('hex')}`
}

function assertStrong(password: string) {
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error(
      'ADMIN_PASSWORD must contain upper and lower case letters and a number.'
    )
  }
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  if (!email) {
    throw new Error('Set ADMIN_EMAIL to the address that should own this environment.')
  }

  const generated = !process.env.ADMIN_PASSWORD
  const password =
    process.env.ADMIN_PASSWORD ?? `${crypto.randomBytes(12).toString('base64url')}Aa1`
  assertStrong(password)

  const name = process.env.ADMIN_NAME ?? 'Administrator'

  await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } })

    if (existing) {
      // Promote in place rather than deleting: the previous script removed the
      // User row, which would now cascade to that person's sessions, audit
      // attribution and staff link.
      await tx.user.update({
        where: { id: existing.id },
        data: { role: 'ADMIN', isActive: true },
      })
      await tx.account.updateMany({
        where: { userId: existing.id, providerId: 'credential' },
        data: { password: hashPassword(password), passwordChangedAt: new Date() },
      })
      console.log(`Promoted the existing account ${email} to ADMIN and reset its password.`)
      return
    }

    const user = await tx.user.create({
      data: { name, email, emailVerified: true, role: 'ADMIN', isActive: true },
    })
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: hashPassword(password),
        passwordChangedAt: new Date(),
      },
    })
    console.log(`Created administrator ${email}.`)
  })

  if (generated) {
    console.log('\n  Generated password (shown once, store it now):\n')
    console.log(`    ${password}\n`)
  }
}

main()
  .catch((err) => {
    console.error('Failed to seed the administrator:', err.message ?? err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
