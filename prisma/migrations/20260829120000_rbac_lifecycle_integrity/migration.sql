-- ===========================================================================
-- RBAC, lifecycle and integrity migration
--
-- Hand-written rather than generated, because the generated diff was
-- destructive: it dropped and recreated every status column (wiping all
-- workflow state), dropped Attachment.url and Staff.birthday, and dropped
-- SmtpSettings without moving the credentials.
--
-- This migration preserves every existing row. Enum columns are converted
-- in place with USING casts after normalising hyphenated values, and new
-- NOT NULL columns are added nullable, backfilled, then constrained.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'FINANCE', 'MANAGER', 'CREW');
CREATE TYPE "EmploymentStatus" AS ENUM ('onboarding', 'active', 'suspended', 'notice', 'leaver', 'archived');
CREATE TYPE "StaffAvailability" AS ENUM ('on_site', 'available', 'off_shift');
CREATE TYPE "LeaveType" AS ENUM ('annual', 'sick', 'unpaid', 'parental', 'compassionate');
CREATE TYPE "LeaveStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'cancelled', 'taken');
CREATE TYPE "ExpenseStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'reconciled');
CREATE TYPE "ExpenseCategory" AS ENUM ('travel', 'materials', 'equipment', 'meals', 'training', 'other');
CREATE TYPE "ExpenseMethod" AS ENUM ('company_card', 'personal', 'cash');
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'pending', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off');
CREATE TYPE "PaymentMethod" AS ENUM ('bank_transfer', 'card', 'cheque', 'cash', 'other');
CREATE TYPE "PayrollStatus" AS ENUM ('draft', 'approved', 'paid');
CREATE TYPE "TimesheetStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'locked');
CREATE TYPE "DocumentKind" AS ENUM ('pts', 'medical', 'right_to_work', 'contract', 'certification', 'other');
CREATE TYPE "DocumentStatus" AS ENUM ('pending_review', 'valid', 'expiring', 'expired', 'rejected');
CREATE TYPE "ContractType" AS ENUM ('permanent', 'fixed_term', 'agency', 'subcontractor', 'apprentice');
CREATE TYPE "AttachmentKind" AS ENUM ('pdf', 'image');
CREATE TYPE "NotificationType" AS ENUM ('leave_submitted', 'leave_decided', 'expense_submitted', 'expense_decided', 'expense_reimbursed', 'timesheet_submitted', 'timesheet_decided', 'invoice_issued', 'invoice_overdue', 'payment_received', 'payroll_ready', 'payslip_available', 'document_expiring', 'staff_invited', 'role_changed');
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'approve', 'reject', 'cancel', 'login', 'role_change', 'offboard', 'settings_change', 'payment');

-- ---------------------------------------------------------------------------
-- 2. User: explicit roles
--
-- Backfill preserves today's *effective* access rather than silently
-- demoting anyone: under the old model a user with no Staff row already had
-- admin access, so that is the role they are granted here. Everyone with a
-- Staff row becomes CREW, which is the least-privileged role.
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "role" "UserRole",
                  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
                  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

UPDATE "User" u
   SET "role" = CASE
     WHEN EXISTS (SELECT 1 FROM "Staff" s WHERE s.email = u.email) THEN 'CREW'::"UserRole"
     ELSE 'ADMIN'::"UserRole"
   END;

ALTER TABLE "User" ALTER COLUMN "role" SET NOT NULL,
                   ALTER COLUMN "role" SET DEFAULT 'CREW';

CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- ---------------------------------------------------------------------------
-- 3. Session / Account / Verification hardening
-- ---------------------------------------------------------------------------
ALTER TABLE "Session" ADD COLUMN "revokedAt" TIMESTAMP(3);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Account" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

ALTER TABLE "Verification" ADD COLUMN "consumedAt" TIMESTAMP(3);
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

-- ---------------------------------------------------------------------------
-- 4. Attachment: real storage metadata, preserving existing URLs
--
-- The old `url` column becomes `storageKey`. Existing blob:/data: values are
-- rewritten to a quarantined key so they can never be rendered as a live
-- href; the application treats the `quarantined:` prefix as "unavailable".
-- ---------------------------------------------------------------------------
ALTER TABLE "Attachment" RENAME COLUMN "url" TO "storageKey";
ALTER TABLE "Attachment" ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
                         ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0,
                         ADD COLUMN "checksum" TEXT,
                         ADD COLUMN "uploadedById" TEXT;

UPDATE "Attachment"
   SET "storageKey" = 'quarantined:' || id
 WHERE "storageKey" LIKE 'blob:%' OR "storageKey" LIKE 'data:%';

-- Derive bytes from the old human-readable size string ("91 KB") where possible.
UPDATE "Attachment"
   SET "sizeBytes" = CASE
     WHEN size ~* '^[0-9.]+ *KB$' THEN (regexp_replace(size, '[^0-9.]', '', 'g'))::numeric * 1024
     WHEN size ~* '^[0-9.]+ *MB$' THEN (regexp_replace(size, '[^0-9.]', '', 'g'))::numeric * 1024 * 1024
     WHEN size ~* '^[0-9]+ *B$'   THEN (regexp_replace(size, '[^0-9]', '', 'g'))::numeric
     ELSE 0
   END,
   "mimeType" = CASE WHEN kind = 'pdf' THEN 'application/pdf' ELSE 'image/*' END;

ALTER TABLE "Attachment" DROP COLUMN "size";

-- Deduplicate storage keys before the unique index.
UPDATE "Attachment" a
   SET "storageKey" = a."storageKey" || '#' || a.id
 WHERE EXISTS (
   SELECT 1 FROM "Attachment" b
    WHERE b."storageKey" = a."storageKey" AND b.id <> a.id
 );

ALTER TABLE "Attachment" ALTER COLUMN "kind" TYPE "AttachmentKind" USING ("kind"::text::"AttachmentKind");
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- ---------------------------------------------------------------------------
-- 5. Crew: case-insensitive uniqueness, supervisor, lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE "Crew" ADD COLUMN "nameKey" TEXT,
                   ADD COLUMN "site" TEXT,
                   ADD COLUMN "supervisorRef" TEXT,
                   ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Crew" SET "nameKey" = lower(btrim(name));
ALTER TABLE "Crew" ALTER COLUMN "nameKey" SET NOT NULL;
CREATE UNIQUE INDEX "Crew_nameKey_key" ON "Crew"("nameKey");
CREATE INDEX "Crew_isActive_idx" ON "Crew"("isActive");

-- ---------------------------------------------------------------------------
-- 6. Client: billing identity, case-insensitive uniqueness
-- ---------------------------------------------------------------------------
ALTER TABLE "Client" ADD COLUMN "nameKey" TEXT,
                     ADD COLUMN "legalName" TEXT,
                     ADD COLUMN "companyNumber" TEXT,
                     ADD COLUMN "vatNumber" TEXT,
                     ADD COLUMN "billingAddressLine1" TEXT,
                     ADD COLUMN "billingAddressLine2" TEXT,
                     ADD COLUMN "billingCity" TEXT,
                     ADD COLUMN "billingPostcode" TEXT,
                     ADD COLUMN "primaryContactName" TEXT,
                     ADD COLUMN "primaryContactEmail" TEXT,
                     ADD COLUMN "primaryContactPhone" TEXT,
                     ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
                     ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'GBP',
                     ADD COLUMN "creditLimitPence" INTEGER,
                     ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
                     ADD COLUMN "notes" TEXT;

UPDATE "Client" SET "nameKey" = lower(btrim(name));
ALTER TABLE "Client" ALTER COLUMN "nameKey" SET NOT NULL;
CREATE UNIQUE INDEX "Client_nameKey_key" ON "Client"("nameKey");
CREATE INDEX "Client_isActive_idx" ON "Client"("isActive");

-- ---------------------------------------------------------------------------
-- 7. Job: connect to client and crew, add operational detail
-- ---------------------------------------------------------------------------
ALTER TABLE "Job" ADD COLUMN "reference" TEXT,
                  ADD COLUMN "clientId" TEXT,
                  ADD COLUMN "crewId" TEXT,
                  ADD COLUMN "location" TEXT,
                  ADD COLUMN "costCode" TEXT,
                  ADD COLUMN "dayRatePence" INTEGER,
                  ADD COLUMN "startDate" TIMESTAMP(3),
                  ADD COLUMN "endDate" TIMESTAMP(3),
                  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- The old primary key doubled as the human-facing job number.
UPDATE "Job" SET "reference" = id;
ALTER TABLE "Job" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "Job_reference_key" ON "Job"("reference");
CREATE INDEX "Job_clientId_idx" ON "Job"("clientId");
CREATE INDEX "Job_crewId_idx" ON "Job"("crewId");
CREATE INDEX "Job_isActive_idx" ON "Job"("isActive");

ALTER TABLE "Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 8. Staff: employment lifecycle and the HR profile
--
-- `status` held operational availability ('on-site' / 'available' /
-- 'off-shift'). It becomes `availability`; employment lifecycle is a new,
-- separate concern. Hyphens are normalised to underscores for the enum.
-- ---------------------------------------------------------------------------
ALTER TABLE "Staff"
  ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "availability" "StaffAvailability",
  ADD COLUMN "contractType" "ContractType" NOT NULL DEFAULT 'permanent',
  ADD COLUMN "endDate" TIMESTAMP(3),
  ADD COLUMN "noticeDate" TIMESTAMP(3),
  ADD COLUMN "leaverReason" TEXT,
  ADD COLUMN "weeklyHours" DOUBLE PRECISION NOT NULL DEFAULT 37.5,
  ADD COLUMN "dayRatePence" INTEGER,
  ADD COLUMN "managerRef" TEXT,
  ADD COLUMN "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressPostcode" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "emergencyContactRelation" TEXT,
  ADD COLUMN "niNumber" TEXT,
  ADD COLUMN "taxCode" TEXT,
  ADD COLUMN "niCategory" TEXT NOT NULL DEFAULT 'A',
  ADD COLUMN "bankSortCode" TEXT,
  ADD COLUMN "bankAccountLast4" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "Staff" SET "availability" = replace(status, '-', '_')::"StaffAvailability";
ALTER TABLE "Staff" ALTER COLUMN "availability" SET NOT NULL,
                    ALTER COLUMN "availability" SET DEFAULT 'off_shift';
ALTER TABLE "Staff" DROP COLUMN "status";

-- birthday stays as 'MM-DD' for the celebrations board; make it nullable so
-- an unknown birthday is representable instead of being stored as ''.
ALTER TABLE "Staff" ALTER COLUMN "birthday" DROP NOT NULL;
UPDATE "Staff" SET "birthday" = NULL WHERE btrim("birthday") = '';

-- A crew must be dissolvable without deleting its people.
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_crewId_fkey";
ALTER TABLE "Staff" ALTER COLUMN "crewId" DROP NOT NULL;
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_managerRef_fkey" FOREIGN KEY ("managerRef") REFERENCES "Staff"("ref") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Staff_status_idx";
CREATE INDEX "Staff_managerRef_idx" ON "Staff"("managerRef");
CREATE INDEX "Staff_employmentStatus_idx" ON "Staff"("employmentStatus");
CREATE INDEX "Staff_availability_idx" ON "Staff"("availability");
CREATE INDEX "Staff_email_idx" ON "Staff"("email");
CREATE INDEX "Staff_deletedAt_idx" ON "Staff"("deletedAt");

ALTER TABLE "Crew" ADD CONSTRAINT "Crew_supervisorRef_fkey" FOREIGN KEY ("supervisorRef") REFERENCES "Staff"("ref") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 9. Attendance and the new Timesheet lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "staffRef" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "rejectionReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Timesheet_staffRef_weekStart_key" ON "Timesheet"("staffRef", "weekStart");
CREATE INDEX "Timesheet_status_idx" ON "Timesheet"("status");
CREATE INDEX "Timesheet_weekStart_idx" ON "Timesheet"("weekStart");
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attendance" ADD COLUMN "hours" DOUBLE PRECISION,
                         ADD COLUMN "jobId" TEXT,
                         ADD COLUMN "notes" TEXT,
                         ADD COLUMN "timesheetId" TEXT,
                         ADD COLUMN "source" TEXT NOT NULL DEFAULT 'admin';

-- The roster grid uses '-' for "not scheduled", which cannot be an enum
-- member, so the legal set is enforced with a CHECK constraint instead.
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_code_check"
  CHECK ("code" IN ('P', 'H', 'L', 'A', '-'));
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_hours_check"
  CHECK ("hours" IS NULL OR ("hours" >= 0 AND "hours" <= 24));

CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");
CREATE INDEX "Attendance_jobId_idx" ON "Attendance"("jobId");
CREATE INDEX "Attendance_timesheetId_idx" ON "Attendance"("timesheetId");
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 10. LeaveRequest: enums, decision provenance, overlap prevention
-- ---------------------------------------------------------------------------
ALTER TABLE "LeaveRequest" ADD COLUMN "decidedById" TEXT,
                           ADD COLUMN "decisionNote" TEXT,
                           ADD COLUMN "cancelledAt" TIMESTAMP(3),
                           ADD COLUMN "leaveYear" INTEGER,
                           ADD COLUMN "attachmentId" TEXT;

UPDATE "LeaveRequest" SET "leaveYear" = EXTRACT(YEAR FROM "from")::int;
ALTER TABLE "LeaveRequest" ALTER COLUMN "leaveYear" SET NOT NULL;

ALTER TABLE "LeaveRequest" ALTER COLUMN "type" TYPE "LeaveType" USING ("type"::text::"LeaveType");
ALTER TABLE "LeaveRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "LeaveRequest" ALTER COLUMN "status" TYPE "LeaveStatus" USING ("status"::text::"LeaveStatus");
ALTER TABLE "LeaveRequest" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_range_check" CHECK ("to" >= "from");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_days_check" CHECK ("days" > 0);

CREATE INDEX "LeaveRequest_staffRef_from_to_idx" ON "LeaveRequest"("staffRef", "from", "to");
CREATE INDEX "LeaveRequest_leaveYear_idx" ON "LeaveRequest"("leaveYear");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Make overlapping live leave physically impossible, rather than relying on a
-- read-then-write check that two concurrent requests can both pass.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_no_overlap"
  EXCLUDE USING gist (
    "staffRef" WITH =,
    daterange("from"::date, "to"::date, '[]') WITH &&
  ) WHERE ("status" IN ('pending', 'approved', 'taken'));

-- ---------------------------------------------------------------------------
-- 11. Expense: enums, approval provenance, non-negative money
-- ---------------------------------------------------------------------------
ALTER TABLE "Expense" ADD COLUMN "vatPence" INTEGER NOT NULL DEFAULT 0,
                      ADD COLUMN "jobId" TEXT,
                      ADD COLUMN "approvedById" TEXT,
                      ADD COLUMN "approvedAt" TIMESTAMP(3),
                      ADD COLUMN "rejectionReason" TEXT,
                      ADD COLUMN "reimbursedAt" TIMESTAMP(3),
                      ADD COLUMN "paymentReference" TEXT,
                      ADD COLUMN "reconciledAt" TIMESTAMP(3);

UPDATE "Expense" SET method = replace(method, '-', '_');

ALTER TABLE "Expense" ALTER COLUMN "category" TYPE "ExpenseCategory" USING ("category"::text::"ExpenseCategory");
ALTER TABLE "Expense" ALTER COLUMN "method" TYPE "ExpenseMethod" USING ("method"::text::"ExpenseMethod");
ALTER TABLE "Expense" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Expense" ALTER COLUMN "status" TYPE "ExpenseStatus" USING ("status"::text::"ExpenseStatus");
ALTER TABLE "Expense" ALTER COLUMN "status" SET DEFAULT 'submitted';

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK ("amountPence" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vat_check" CHECK ("vatPence" >= 0);

-- An employee with expense history must not be hard-deletable.
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_staffRef_fkey";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 12. Invoice: lifecycle, VAT, line items, payments
-- ---------------------------------------------------------------------------
ALTER TABLE "Invoice" ADD COLUMN "jobId" TEXT,
                      ADD COLUMN "netPence" INTEGER NOT NULL DEFAULT 0,
                      ADD COLUMN "vatPence" INTEGER NOT NULL DEFAULT 0,
                      ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'GBP',
                      ADD COLUMN "poNumber" TEXT,
                      ADD COLUMN "notes" TEXT,
                      ADD COLUMN "sentAt" TIMESTAMP(3),
                      ADD COLUMN "paidAt" TIMESTAMP(3),
                      ADD COLUMN "voidedAt" TIMESTAMP(3),
                      ADD COLUMN "voidReason" TEXT,
                      ADD COLUMN "createdById" TEXT;

-- Existing totals were VAT-inclusive with no breakdown recorded; treat the
-- stored figure as net so net + vat still equals the original gross.
UPDATE "Invoice" SET "netPence" = "amountPence", "vatPence" = 0;

ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus" USING ("status"::text::"InvoiceStatus");
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'draft';

-- Backfill paidAt so the derived status stays consistent with history.
UPDATE "Invoice" SET "paidAt" = "issued" WHERE "status" = 'paid' AND "paidAt" IS NULL;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amount_check" CHECK ("amountPence" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_net_check" CHECK ("netPence" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vat_check" CHECK ("vatPence" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_due_check" CHECK ("due" >= "issued");

CREATE UNIQUE INDEX "Invoice_clientId_reference_key" ON "Invoice"("clientId", "reference");
CREATE INDEX "Invoice_due_idx" ON "Invoice"("due");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A client with invoice history must not be hard-deletable.
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_clientId_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPricePence" INTEGER NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 2000,
    "netPence" INTEGER NOT NULL,
    "vatPence" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_qty_check" CHECK ("quantity" > 0);
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_price_check" CHECK ("unitPricePence" >= 0);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "receivedOn" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'bank_transfer',
    "reference" TEXT NOT NULL,
    "notes" TEXT,
    "proofId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_receivedOn_idx" ON "Payment"("receivedOn");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amountPence" > 0);

-- Historical invoices already marked paid get a reconstructed payment record
-- so the derived status has evidence behind it.
INSERT INTO "Payment" ("id", "invoiceId", "amountPence", "receivedOn", "method", "reference", "notes")
SELECT gen_random_uuid()::text, i.id, i."amountPence", COALESCE(i."paidAt", i.issued),
       'bank_transfer'::"PaymentMethod", 'MIGRATED-' || i.id,
       'Reconstructed during the payments migration from the legacy paid flag.'
  FROM "Invoice" i
 WHERE i.status = 'paid' AND i."amountPence" > 0;

-- ---------------------------------------------------------------------------
-- 13. Payroll: status enum, provenance, adjustments with reasons
-- ---------------------------------------------------------------------------
ALTER TABLE "PayrollRecord" ADD COLUMN "baseGrossPence" INTEGER NOT NULL DEFAULT 0,
                            ADD COLUMN "taxCode" TEXT NOT NULL DEFAULT '1257L',
                            ADD COLUMN "niCategory" TEXT NOT NULL DEFAULT 'A',
                            ADD COLUMN "dayRatePence" INTEGER,
                            ADD COLUMN "daysWorked" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            ADD COLUMN "calculationVersion" TEXT NOT NULL DEFAULT 'simplified-v1',
                            ADD COLUMN "approvedById" TEXT,
                            ADD COLUMN "approvedAt" TIMESTAMP(3),
                            ADD COLUMN "lockedAt" TIMESTAMP(3);

UPDATE "PayrollRecord" SET "baseGrossPence" = "grossPence";

-- 'pending' becomes 'draft'; 'paid' is preserved.
UPDATE "PayrollRecord" SET status = 'draft' WHERE status = 'pending';
ALTER TABLE "PayrollRecord" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PayrollRecord" ALTER COLUMN "status" TYPE "PayrollStatus" USING ("status"::text::"PayrollStatus");
ALTER TABLE "PayrollRecord" ALTER COLUMN "status" SET DEFAULT 'draft';

ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_money_check"
  CHECK ("grossPence" >= 0 AND "taxPence" >= 0 AND "niPence" >= 0 AND "pensionPence" >= 0);
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_month_check"
  CHECK ("month" BETWEEN 1 AND 12);

CREATE INDEX "PayrollRecord_year_month_idx" ON "PayrollRecord"("year", "month");
CREATE INDEX "PayrollRecord_status_idx" ON "PayrollRecord"("status");

ALTER TABLE "PayrollRecord" DROP CONSTRAINT "PayrollRecord_staffRef_fkey";
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayrollAdjustment_payrollId_idx" ON "PayrollAdjustment"("payrollId");
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffPayRate" (
    "id" TEXT NOT NULL,
    "staffRef" TEXT NOT NULL,
    "dayRatePence" INTEGER NOT NULL,
    "hourlyRatePence" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffPayRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffPayRate_staffRef_effectiveFrom_idx" ON "StaffPayRate"("staffRef", "effectiveFrom");
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_rate_check" CHECK ("dayRatePence" >= 0);

-- ---------------------------------------------------------------------------
-- 14. Staff compliance documents
-- ---------------------------------------------------------------------------
CREATE TABLE "StaffDocument" (
    "id" TEXT NOT NULL,
    "staffRef" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "reference" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending_review',
    "issuedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "attachmentId" TEXT,
    "uploadedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffDocument_staffRef_kind_idx" ON "StaffDocument"("staffRef", "kind");
CREATE INDEX "StaffDocument_expiresOn_idx" ON "StaffDocument"("expiresOn");
CREATE INDEX "StaffDocument_status_idx" ON "StaffDocument"("status");
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 15. Platform: settings, audit, notifications
-- ---------------------------------------------------------------------------
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- Carry the existing SMTP configuration across before dropping the table.
-- The password is intentionally NOT migrated: it was stored in plaintext and
-- is now handled as an encrypted, write-only secret, so it must be re-entered.
INSERT INTO "Setting" ("key", "value", "isSecret", "updatedAt")
SELECT 'smtp.host', to_jsonb(host), false, CURRENT_TIMESTAMP FROM "SmtpSettings" WHERE id = 'default'
UNION ALL SELECT 'smtp.port', to_jsonb(port), false, CURRENT_TIMESTAMP FROM "SmtpSettings" WHERE id = 'default'
UNION ALL SELECT 'smtp.secure', to_jsonb(secure), false, CURRENT_TIMESTAMP FROM "SmtpSettings" WHERE id = 'default'
UNION ALL SELECT 'smtp.user', to_jsonb("user"), false, CURRENT_TIMESTAMP FROM "SmtpSettings" WHERE id = 'default'
UNION ALL SELECT 'smtp.from', to_jsonb("from"), false, CURRENT_TIMESTAMP FROM "SmtpSettings" WHERE id = 'default'
ON CONFLICT ("key") DO NOTHING;

DROP TABLE "SmtpSettings";

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
