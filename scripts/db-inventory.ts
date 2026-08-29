/**
 * Read-only database inventory.
 *
 * Prints row counts and state distributions so we can tell demo/test leftovers
 * from legitimate records before deciding what to clean. It reads aggregates
 * and enum distributions only, never record contents.
 *
 *   npx tsx scripts/db-inventory.ts
 */

import { prisma } from '../app/lib/prisma'

const q = (sql: string) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql)

async function main() {
  console.log('\n=== Row counts ===')
  console.table(
    await q(`select
      (select count(*)::int from "User") as users,
      (select count(*)::int from "Account") as accounts,
      (select count(*)::int from "Session") as sessions,
      (select count(*)::int from "Staff") as staff,
      (select count(*)::int from "Crew") as crews,
      (select count(*)::int from "Job") as jobs,
      (select count(*)::int from "Client") as clients`)
  )
  console.table(
    await q(`select
      (select count(*)::int from "Attendance") as attendance,
      (select count(*)::int from "Timesheet") as timesheets,
      (select count(*)::int from "LeaveRequest") as leave,
      (select count(*)::int from "Expense") as expenses,
      (select count(*)::int from "Invoice") as invoices,
      (select count(*)::int from "InvoiceLineItem") as invoice_lines,
      (select count(*)::int from "Payment") as payments`)
  )
  console.table(
    await q(`select
      (select count(*)::int from "PayrollRecord") as payroll,
      (select count(*)::int from "PayrollAdjustment") as payroll_adj,
      (select count(*)::int from "StaffPayRate") as pay_rates,
      (select count(*)::int from "StaffDocument") as documents,
      (select count(*)::int from "Attachment") as attachments,
      (select count(*)::int from "Setting") as settings,
      (select count(*)::int from "AuditLog") as audit,
      (select count(*)::int from "Notification") as notifications`)
  )

  console.log('\n=== State distributions ===')
  for (const [label, sql] of [
    ['User.role', `select role::text as v, count(*)::int as n from "User" group by 1 order by 1`],
    ['Staff.employmentStatus', `select "employmentStatus"::text as v, count(*)::int as n from "Staff" group by 1 order by 1`],
    ['LeaveRequest.status', `select status::text as v, count(*)::int as n from "LeaveRequest" group by 1 order by 1`],
    ['Expense.status', `select status::text as v, count(*)::int as n from "Expense" group by 1 order by 1`],
    ['Invoice.status', `select status::text as v, count(*)::int as n from "Invoice" group by 1 order by 1`],
    ['PayrollRecord.status', `select status::text as v, count(*)::int as n from "PayrollRecord" group by 1 order by 1`],
    ['Timesheet.status', `select status::text as v, count(*)::int as n from "Timesheet" group by 1 order by 1`],
    ['StaffDocument.status', `select status::text as v, count(*)::int as n from "StaffDocument" group by 1 order by 1`],
  ] as const) {
    const rows = await q(sql)
    console.log(`\n${label}:`)
    console.table(rows.length ? rows : [{ v: '(none)', n: 0 }])
  }

  console.log('\n=== Referential gaps (counts only) ===')
  console.table(
    await q(`select
      (select count(*)::int from "Staff" where "userId" is null) as staff_without_login,
      (select count(*)::int from "User" u where not exists
        (select 1 from "Staff" s where s."userId" = u.id)) as users_without_staff,
      (select count(*)::int from "Staff" where "crewId" is null) as staff_without_crew,
      (select count(*)::int from "Staff" where "managerRef" is null) as staff_without_manager,
      (select count(*)::int from "Invoice" where "jobId" is null) as invoices_without_job,
      (select count(*)::int from "Expense" where "jobId" is null) as expenses_without_job,
      (select count(*)::int from "Attendance" where "timesheetId" is null) as attendance_without_timesheet,
      (select count(*)::int from "Invoice" i where not exists
        (select 1 from "InvoiceLineItem" l where l."invoiceId" = i.id)) as invoices_without_lines`)
  )

  console.log('\n=== Semantic contradictions (all should be 0) ===')
  console.table(
    await q(`select
      (select count(*)::int from "Invoice" i where i.status = 'paid' and not exists
        (select 1 from "Payment" p where p."invoiceId" = i.id)) as paid_invoice_no_payment,
      (select count(*)::int from "Expense" where status = 'reimbursed' and "approvedAt" is null) as reimbursed_not_approved,
      (select count(*)::int from "LeaveRequest" l join "Staff" s on s.ref = l."staffRef"
        where l.status = 'approved' and s."endDate" is not null and l."from" > s."endDate") as leave_after_leaving,
      (select count(*)::int from "Staff" where "employmentStatus" = 'active' and "dayRatePence" is null) as active_without_pay_rate,
      (select count(*)::int from "PayrollRecord" where status in ('approved','paid') and "lockedAt" is null) as settled_payroll_unlocked,
      (select count(*)::int from "Invoice" where status <> 'draft' and "sentAt" is null) as issued_invoice_never_sent`)
  )

  // Not a contradiction: DocumentStatus stores the *review* decision, and
  // expiry is derived from the date on read (see effectiveStatus in
  // app/actions/documents.ts). A stored 'valid' with a past expiry is exactly
  // the case that derivation exists to report as expired, so the seed
  // includes one deliberately.
  console.log('\n=== Compliance (informational) ===')
  console.table(
    await q(`select
      (select count(*)::int from "StaffDocument"
        where status = 'valid' and "expiresOn" < now()) as stored_valid_now_expired,
      (select count(*)::int from "StaffDocument"
        where status = 'valid' and "expiresOn" between now() and now() + interval '60 days') as expiring_within_60_days,
      (select count(*)::int from "Staff" s
        where s."deletedAt" is null
          and s."employmentStatus" in ('active','onboarding','notice')
          and not exists (
            select 1 from "StaffDocument" d
            where d."staffRef" = s.ref and d.kind = 'right_to_work'
              and d.status = 'valid'
              and (d."expiresOn" is null or d."expiresOn" >= now())
          )) as staff_without_valid_right_to_work`)
  )

  await prisma.$disconnect()
}

main()
