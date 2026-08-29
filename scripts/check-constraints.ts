/**
 * Dry-run for the workflow-invariant constraints.
 *
 * Read-only. Reports how many existing rows would violate each CHECK in
 * prisma/migrations/20260829160000_workflow_invariants, so the migration can
 * be validated before it is applied rather than failing half-way through.
 *
 *   npx tsx scripts/check-constraints.ts
 */

import 'dotenv/config'
import { prisma } from '../app/lib/prisma'

const CHECKS: Array<[string, string]> = [
  ['Expense_settled_requires_approval',
    `select count(*)::int n from "Expense" where not (
      status not in ('reimbursed','reconciled')
      or ("approvedAt" is not null and "paymentReference" is not null))`],
  ['Expense_rejection_requires_reason',
    `select count(*)::int n from "Expense" where not (
      status <> 'rejected' or "rejectionReason" is not null)`],
  ['Expense_vat_within_amount',
    `select count(*)::int n from "Expense" where not (
      "vatPence" >= 0 and "vatPence" <= "amountPence")`],
  ['PayrollRecord_settled_is_locked',
    `select count(*)::int n from "PayrollRecord" where not (
      status = 'draft' or ("lockedAt" is not null and "approvedAt" is not null))`],
  ['PayrollRecord_paid_has_date',
    `select count(*)::int n from "PayrollRecord" where not (
      status <> 'paid' or "paidOn" is not null)`],
  ['PayrollRecord_net_within_gross',
    `select count(*)::int n from "PayrollRecord" where not (
      "netPence" >= 0 and "netPence" <= "grossPence")`],
  ['Invoice_issued_has_sent_date',
    `select count(*)::int n from "Invoice" where not (
      status in ('draft','void') or "sentAt" is not null)`],
  ['Invoice_void_has_reason',
    `select count(*)::int n from "Invoice" where not (
      status <> 'void' or "voidReason" is not null)`],
  ['Invoice_totals_reconcile',
    `select count(*)::int n from "Invoice" where not (
      "amountPence" = "netPence" + "vatPence")`],
  ['Invoice_due_after_issue',
    `select count(*)::int n from "Invoice" where not ("due" >= "issued")`],
  ['Payment_amount_positive',
    `select count(*)::int n from "Payment" where not ("amountPence" > 0)`],
  ['Staff_end_after_join',
    `select count(*)::int n from "Staff" where not (
      "endDate" is null or "endDate" >= "joined")`],
  ['Staff_notice_before_end',
    `select count(*)::int n from "Staff" where not (
      "noticeDate" is null or "endDate" is null or "noticeDate" <= "endDate")`],
  ['Staff_leaver_has_end_date',
    `select count(*)::int n from "Staff" where not (
      "employmentStatus" not in ('leaver','notice') or "endDate" is not null)`],
  ['Staff_suspended_has_reason',
    `select count(*)::int n from "Staff" where not (
      "employmentStatus" <> 'suspended' or "suspensionReason" is not null)`],
  ['LeaveRequest_to_after_from',
    `select count(*)::int n from "LeaveRequest" where not ("to" >= "from")`],
  ['LeaveRequest_days_positive',
    `select count(*)::int n from "LeaveRequest" where not (days > 0)`],
  ['LeaveRequest_decision_recorded',
    `select count(*)::int n from "LeaveRequest" where not (
      status not in ('approved','rejected') or "decidedAt" is not null)`],
  ['StaffDocument_expiry_after_issue',
    `select count(*)::int n from "StaffDocument" where not (
      "expiresOn" is null or "issuedOn" is null or "expiresOn" >= "issuedOn")`],
  ['Timesheet_decision_recorded',
    `select count(*)::int n from "Timesheet" where not (
      status not in ('approved','rejected','locked') or "decidedAt" is not null)`],
  ['Timesheet_rejection_has_reason',
    `select count(*)::int n from "Timesheet" where not (
      status <> 'rejected' or "rejectionReason" is not null)`],
]

async function main() {
  let violations = 0
  const rows: Array<{ constraint: string; violating: number }> = []

  for (const [name, sql] of CHECKS) {
    const [result] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(sql)
    rows.push({ constraint: name, violating: result.n })
    violations += result.n
  }

  console.table(rows)

  if (violations === 0) {
    console.log('\nAll invariants hold. The migration can be applied safely.')
  } else {
    console.log(`\n${violations} row(s) would violate a constraint. Fix the data first.`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('Constraint check failed:', err.message ?? err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
