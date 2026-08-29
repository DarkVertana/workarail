/**
 * Removes all operational data, leaving the schema and migration history.
 *
 * This is a development tool. It refuses to run against anything that does not
 * look like a local database unless ALLOW_DESTRUCTIVE_RESET is set, because
 * the whole point of the script is that it is destructive.
 *
 *   npx tsx scripts/reset-db.ts
 *
 * What it deletes and why:
 *
 * The existing development data was created by seed scripts that have since
 * been deleted, against a schema that has since changed. An inventory found it
 * self-contradictory in ways that would make any testing misleading:
 *
 *   - 12 invoices, 0 line items — the money model moved to line items, so
 *     every invoice's net/VAT split is unrecoverable
 *   - 4 expenses marked `reimbursed` with no approval date, which the
 *     workflow now forbids
 *   - 14 active employees with no pay rate and no StaffPayRate history, so no
 *     payroll run can be reproduced
 *   - 14 employees with no manager, so no manager scoping can be exercised
 *   - 91 of 98 attendance rows with no timesheet, so none of it is approvable
 *     and none of it can reach payroll
 *   - only ADMIN and CREW roles present, so FINANCE and MANAGER authorization
 *     was untestable
 *   - 0 compliance documents, for a rail contractor
 *
 * None of it is reference data and none of it is a real business record: it is
 * all development scaffolding. Deleting and reseeding is correct here, where
 * repairing it in place would not be.
 *
 * `Setting` rows are preserved by default — they are configuration rather than
 * operational data, and include the encrypted SMTP credential. Pass
 * --include-settings to clear them too.
 */

import 'dotenv/config'
import { prisma } from '../app/lib/prisma'

const includeSettings = process.argv.includes('--include-settings')

/**
 * Deletion order. Children before parents: the schema now uses `Restrict`
 * rather than `Cascade` on the relations that carry history, deliberately, so
 * this order is load-bearing rather than merely tidy.
 */
const ORDER = [
  'PayrollAdjustment',
  'PayrollRecord',
  'Payment',
  'InvoiceLineItem',
  'Invoice',
  'Expense',
  'Attendance',
  'Timesheet',
  'LeaveRequest',
  'StaffDocument',
  'StaffPayRate',
  // Both reference Staff with `Restrict`, so they have to go before it.
  'StaffPayrollProfile',
  'StaffBankAccount',
  'Notification',
  'AuditLog',
  'Staff',
  'Job',
  'Crew',
  'Client',
  'Attachment',
  'Session',
  'Account',
  'Verification',
  'User',
] as const

function looksLocal(url: string): boolean {
  return /(@|\/\/)(localhost|127\.0\.0\.1|::1|host\.docker\.internal)[:/]/.test(url)
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!looksLocal(url) && !process.env.ALLOW_DESTRUCTIVE_RESET) {
    throw new Error(
      'DATABASE_URL does not point at a local database. Set ALLOW_DESTRUCTIVE_RESET=1 if you really mean to wipe it.'
    )
  }

  console.log('Clearing operational data...')
  for (const table of ORDER) {
    // Staff.managerRef and Crew.supervisorRef are self/mutual references, so
    // the rows have to be detached before the tables can be emptied.
    if (table === 'Staff') {
      await prisma.$executeRawUnsafe(
        'UPDATE "Staff" SET "managerRef" = NULL, "crewId" = NULL, "currentJobId" = NULL'
      )
      await prisma.$executeRawUnsafe('UPDATE "Crew" SET "supervisorRef" = NULL')
    }
    const deleted = await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)
    console.log(`  ${table.padEnd(20)} ${deleted}`)
  }

  if (includeSettings) {
    const deleted = await prisma.$executeRawUnsafe('DELETE FROM "Setting"')
    console.log(`  ${'Setting'.padEnd(20)} ${deleted}`)
  } else {
    const kept = await prisma.setting.count()
    console.log(`\n  Kept ${kept} Setting row(s). Pass --include-settings to clear them.`)
  }

  console.log('\nDone. Run `npm run seed` to populate a realistic environment.')
}

main()
  .catch((err) => {
    console.error('Reset failed:', err.message ?? err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
