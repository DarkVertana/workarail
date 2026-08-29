-- Payroll identity, bank details and onboarding fields.
--
-- Three changes, in an order that preserves data:
--
--   1. Onboarding/identity columns are added to "Staff" (all nullable, so
--      existing rows stay valid and are completed through the app).
--   2. Tax code and NI category move OFF "Staff" onto the effective-dated
--      "StaffPayrollProfile". The existing values are copied across BEFORE the
--      old columns are dropped, so no payroll identity is lost.
--   3. Bank details move onto "StaffBankAccount". These are deliberately NOT
--      backfilled: the old schema only ever stored a sort code and the last
--      four digits, never a full account number, so there is nothing to
--      migrate. Affected employees are surfaced as "onboarding incomplete"
--      and must have details re-entered through the app, which is the honest
--      outcome — inventing an account number would be worse than a gap.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "Gender" AS ENUM ('male', 'female', 'non_binary', 'prefer_not_to_say');
CREATE TYPE "PayFrequency" AS ENUM ('weekly', 'fortnightly', 'four_weekly', 'monthly');
CREATE TYPE "TaxBasis" AS ENUM ('cumulative', 'week1_month1');
CREATE TYPE "StaffPaymentMethod" AS ENUM ('bacs', 'international');

ALTER TYPE "DocumentKind" ADD VALUE 'government_id';
ALTER TYPE "DocumentKind" ADD VALUE 'tax_document';
ALTER TYPE "DocumentKind" ADD VALUE 'ni_evidence';

-- ---------------------------------------------------------------------------
-- 1. Onboarding / identity columns
-- ---------------------------------------------------------------------------

ALTER TABLE "Staff"
  ADD COLUMN "preferredName"  TEXT,
  ADD COLUMN "personalEmail"  TEXT,
  ADD COLUMN "personalPhone"  TEXT,
  ADD COLUMN "gender"         "Gender",
  ADD COLUMN "nationality"    TEXT,
  ADD COLUMN "addressCountry" TEXT DEFAULT 'United Kingdom',
  ADD COLUMN "internalNotes"  TEXT,
  ADD COLUMN "payFrequency"   "PayFrequency" NOT NULL DEFAULT 'monthly';

-- ---------------------------------------------------------------------------
-- 2. Effective-dated payroll profile
-- ---------------------------------------------------------------------------

CREATE TABLE "StaffPayrollProfile" (
    "id"              TEXT NOT NULL,
    "staffRef"        TEXT NOT NULL,
    "taxCode"         TEXT NOT NULL,
    "basis"           "TaxBasis" NOT NULL DEFAULT 'cumulative',
    "niCategory"      TEXT NOT NULL DEFAULT 'A',
    "studentLoanPlan" INTEGER,
    "postgradLoan"    BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom"   TIMESTAMP(3) NOT NULL,
    "effectiveTo"     TIMESTAMP(3),
    "source"          TEXT,
    "createdById"     TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPayrollProfile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffPayrollProfile_staffRef_effectiveFrom_idx"
  ON "StaffPayrollProfile"("staffRef", "effectiveFrom");

ALTER TABLE "StaffPayrollProfile"
  ADD CONSTRAINT "StaffPayrollProfile_staffRef_fkey"
  FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill from the columns about to be dropped. `effectiveFrom` is the join
-- date: the arrangement is only known to have applied from the point the
-- employee existed, and dating it earlier would imply history we do not have.
INSERT INTO "StaffPayrollProfile"
  ("id", "staffRef", "taxCode", "niCategory", "basis", "effectiveFrom", "source")
SELECT
  gen_random_uuid()::text,
  s."ref",
  COALESCE(s."taxCode", '1257L'),
  COALESCE(s."niCategory", 'A'),
  'cumulative',
  s."joined",
  'migrated_from_staff_row'
FROM "Staff" s;

ALTER TABLE "Staff"
  DROP COLUMN "taxCode",
  DROP COLUMN "niCategory";

-- ---------------------------------------------------------------------------
-- 3. Bank details
-- ---------------------------------------------------------------------------

CREATE TABLE "StaffBankAccount" (
    "id"                TEXT NOT NULL,
    "staffRef"          TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "bankName"          TEXT,
    "method"            "StaffPaymentMethod" NOT NULL DEFAULT 'bacs',
    "accountNumberEnc"  TEXT NOT NULL,
    "sortCodeEnc"       TEXT NOT NULL,
    "accountLast4"      TEXT NOT NULL,
    "sortCodeLast2"     TEXT NOT NULL,
    "ibanEnc"           TEXT,
    "bicEnc"            TEXT,
    "ibanLast4"         TEXT,
    "isPrimary"         BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom"     TIMESTAMP(3) NOT NULL,
    "effectiveTo"       TIMESTAMP(3),
    "verifiedAt"        TIMESTAMP(3),
    "verifiedById"      TEXT,
    "createdById"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffBankAccount_staffRef_effectiveFrom_idx"
  ON "StaffBankAccount"("staffRef", "effectiveFrom");
CREATE INDEX "StaffBankAccount_staffRef_isPrimary_idx"
  ON "StaffBankAccount"("staffRef", "isPrimary");

-- At most one primary account per employee. A partial index rather than a
-- plain unique so superseded (non-primary) accounts can accumulate freely.
CREATE UNIQUE INDEX "StaffBankAccount_one_primary_per_staff"
  ON "StaffBankAccount"("staffRef") WHERE "isPrimary";

ALTER TABLE "StaffBankAccount"
  ADD CONSTRAINT "StaffBankAccount_staffRef_fkey"
  FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- An international payment needs an IBAN; a domestic one needs the masked
-- sort code. Prevents a half-populated row that payroll cannot act on.
ALTER TABLE "StaffBankAccount"
  ADD CONSTRAINT "StaffBankAccount_method_has_details" CHECK (
    ("method" = 'bacs' AND length("sortCodeLast2") > 0)
    OR ("method" = 'international' AND "ibanEnc" IS NOT NULL)
  );

ALTER TABLE "Staff"
  DROP COLUMN "bankSortCode",
  DROP COLUMN "bankAccountLast4";

-- ---------------------------------------------------------------------------
-- 4. Payroll record: HMRC period and year-to-date columns
-- ---------------------------------------------------------------------------

ALTER TABLE "PayrollRecord"
  ADD COLUMN "taxBasis"          "TaxBasis" NOT NULL DEFAULT 'cumulative',
  ADD COLUMN "payFrequency"      "PayFrequency" NOT NULL DEFAULT 'monthly',
  ADD COLUMN "taxYearStart"      INTEGER NOT NULL DEFAULT 2026,
  ADD COLUMN "taxPeriod"         INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "taxablePence"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "studentLoanPence"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "postgradLoanPence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ytdGrossPence"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ytdTaxablePence"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ytdTaxPence"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ytdNiPence"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ytdPensionPence"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bankAccountId"     TEXT;

-- The UK tax year runs 6 April to 5 April, so calendar month 4 onwards is tax
-- month 1 of that year and January is tax month 10 of the previous one. These
-- are derivable for existing rows, so they are backfilled rather than left at
-- a misleading default.
UPDATE "PayrollRecord" SET
  "taxYearStart" = CASE WHEN "month" >= 4 THEN "year" ELSE "year" - 1 END,
  "taxPeriod"    = CASE WHEN "month" >= 4 THEN "month" - 3 ELSE "month" + 9 END,
  "taxablePence" = GREATEST(0, "grossPence" - "pensionPence");

-- Year-to-date figures are deliberately left at zero for pre-existing rows.
-- They were produced by the flat-percentage engine, which never accumulated
-- cumulatively, so any value written here would be fabricated. Those rows
-- already carry calculationVersion = 'simplified-v1', which identifies them.

ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_tax_period_in_range" CHECK (
    ("payFrequency" = 'monthly' AND "taxPeriod" BETWEEN 1 AND 12)
    OR ("payFrequency" <> 'monthly' AND "taxPeriod" BETWEEN 1 AND 56)
  );

ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_ytd_non_negative" CHECK (
    "ytdGrossPence" >= 0 AND "ytdTaxablePence" >= 0 AND "ytdTaxPence" >= 0
    AND "ytdNiPence" >= 0 AND "ytdPensionPence" >= 0
  );
