/**
 * Lists the CHECK constraints actually present in the database.
 *
 * Read-only. Distinct from `check-constraints.ts`, which asks whether the
 * current *data* would satisfy the invariants; this one confirms the
 * constraints were really installed by the migration and are enforcing.
 *
 *   npm run db:list-constraints
 */

import 'dotenv/config'
import { prisma } from '../app/lib/prisma'

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ table: string; constraint: string }>
  >(`
    select rel.relname as "table", con.conname as "constraint"
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where con.contype = 'c'
      and ns.nspname = 'public'
      and con.conname !~ '_not_null$'
    order by 1, 2
  `)

  console.table(rows)
  console.log(`${rows.length} CHECK constraint(s) enforcing.`)
}

main()
  .catch((err) => {
    console.error('Failed to list constraints:', err.message ?? err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
