-- Workflow invariants, enforced by the database.
--
-- The application now guards each of these in its Server Actions, but an
-- action is only one code path. These constraints make the invariant a
-- property of the data rather than of the code that happens to write it, so a
-- future migration, a script or a direct query cannot leave a record in a
-- state the product treats as impossible.
--
-- Each one corresponds to a contradiction that was actually present in the
-- development database before this work:
--   - 4 expenses marked `reimbursed` with no approval recorded
--   - payroll runs that could not reach `approved` or `paid` at all
--   - invoices past `draft` with no `sentAt`, because nothing ever wrote it

-- An expense cannot be reimbursed or reconciled without having been approved,
-- and cannot be rejected without a reason.
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_settled_requires_approval"
  CHECK (
    status NOT IN ('reimbursed', 'reconciled')
    OR ("approvedAt" IS NOT NULL AND "paymentReference" IS NOT NULL)
  );

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_rejection_requires_reason"
  CHECK (status <> 'rejected' OR "rejectionReason" IS NOT NULL);

-- Money on an expense is never negative, and VAT never exceeds the gross.
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_vat_within_amount"
  CHECK ("vatPence" >= 0 AND "vatPence" <= "amountPence");

-- A settled payroll run is locked, carries its approval, and a paid one has a
-- payment date. `approved` and `paid` were previously unreachable, so nothing
-- ever tested this.
ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_settled_is_locked"
  CHECK (
    status = 'draft'
    OR ("lockedAt" IS NOT NULL AND "approvedAt" IS NOT NULL)
  );

ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_paid_has_date"
  CHECK (status <> 'paid' OR "paidOn" IS NOT NULL);

-- Net pay is never negative and never exceeds gross.
ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_net_within_gross"
  CHECK ("netPence" >= 0 AND "netPence" <= "grossPence");

-- An invoice past draft has been sent; a void one says why.
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_issued_has_sent_date"
  CHECK (status IN ('draft', 'void') OR "sentAt" IS NOT NULL);

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_void_has_reason"
  CHECK (status <> 'void' OR "voidReason" IS NOT NULL);

-- Gross reconciles with net plus VAT, and the due date is not before issue.
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_totals_reconcile"
  CHECK ("amountPence" = "netPence" + "vatPence");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_due_after_issue"
  CHECK ("due" >= "issued");

-- A payment is positive and cannot predate the invoice it settles.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive"
  CHECK ("amountPence" > 0);

-- Employment dates are ordered, and a leaver has a leaving date.
ALTER TABLE "Staff"
  ADD CONSTRAINT "Staff_end_after_join"
  CHECK ("endDate" IS NULL OR "endDate" >= "joined");

ALTER TABLE "Staff"
  ADD CONSTRAINT "Staff_notice_before_end"
  CHECK ("noticeDate" IS NULL OR "endDate" IS NULL OR "noticeDate" <= "endDate");

ALTER TABLE "Staff"
  ADD CONSTRAINT "Staff_leaver_has_end_date"
  CHECK ("employmentStatus" NOT IN ('leaver', 'notice') OR "endDate" IS NOT NULL);

ALTER TABLE "Staff"
  ADD CONSTRAINT "Staff_suspended_has_reason"
  CHECK ("employmentStatus" <> 'suspended' OR "suspensionReason" IS NOT NULL);

-- Leave dates are ordered and a request covers at least half a day.
ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_to_after_from"
  CHECK ("to" >= "from");

ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_days_positive"
  CHECK (days > 0);

ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_decision_recorded"
  CHECK (status NOT IN ('approved', 'rejected') OR "decidedAt" IS NOT NULL);

-- A compliance document cannot expire before it was issued.
ALTER TABLE "StaffDocument"
  ADD CONSTRAINT "StaffDocument_expiry_after_issue"
  CHECK ("expiresOn" IS NULL OR "issuedOn" IS NULL OR "expiresOn" >= "issuedOn");

-- A timesheet that has been decided records when, and an approved one is locked.
ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_decision_recorded"
  CHECK (status NOT IN ('approved', 'rejected', 'locked') OR "decidedAt" IS NOT NULL);

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_rejection_has_reason"
  CHECK (status <> 'rejected' OR "rejectionReason" IS NOT NULL);
