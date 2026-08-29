/**
 * Post-migration integrity check.
 *
 * Reads schema metadata and counts constraint violations. It never selects
 * record contents, so it is safe to run against a populated database.
 *
 *   npx tsx scripts/check-integrity.ts
 *
 * Every number under "Integrity violations" must be zero.
 */

import { prisma } from '../app/lib/prisma'

const q = (sql: string) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql)

async function main() {
  console.log('\nCHECK constraints per table:')
  console.table(
    await q(`select conrelid::regclass::text as tbl, count(*)::int as checks
      from pg_constraint
      where contype = 'c' and connamespace = 'public'::regnamespace
      group by 1 order by 1`)
  )

  console.log('\nTables added by the RBAC/lifecycle migration:')
  console.table(
    await q(`select table_name from information_schema.tables
      where table_schema = 'public' and table_name in
        ('AuditLog','Notification','Setting','Payment','InvoiceLineItem',
         'PayrollAdjustment','Timesheet','StaffDocument')
      order by 1`)
  )

  console.log('\nIntegrity violations (every value must be 0):')
  const violations = await q(`select
    -- amountPence is the gross total; the name predates the net/VAT split and
    -- was kept so the migration did not have to rename a populated column.
    (select count(*)::int from "Invoice"
       where "netPence" + "vatPence" <> "amountPence") as invoice_money_mismatch,
    (select count(*)::int from "LeaveRequest" where "to" < "from") as reversed_leave_ranges,
    (select count(*)::int from "User" where role is null) as users_without_role,
    (select count(*)::int from "Attachment"
       where "storageKey" like 'blob:%' or "storageKey" like 'data:%') as unsafe_attachment_urls`)
  console.table(violations)

  const failed = Object.entries(violations[0] ?? {}).filter(([, v]) => Number(v) !== 0)
  if (failed.length > 0) {
    console.error('\nFAILED:', failed.map(([k, v]) => `${k}=${v}`).join(', '))
    process.exitCode = 1
  } else {
    console.log('\nAll integrity checks passed.')
  }

  await prisma.$disconnect()
}

main()
