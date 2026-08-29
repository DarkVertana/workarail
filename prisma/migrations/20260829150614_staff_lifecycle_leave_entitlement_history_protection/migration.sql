-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'logout';
ALTER TYPE "AuditAction" ADD VALUE 'login_failed';
ALTER TYPE "AuditAction" ADD VALUE 'suspend';
ALTER TYPE "AuditAction" ADD VALUE 'reinstate';
ALTER TYPE "AuditAction" ADD VALUE 'reimburse';
ALTER TYPE "AuditAction" ADD VALUE 'issue';
ALTER TYPE "AuditAction" ADD VALUE 'lock';
ALTER TYPE "AuditAction" ADD VALUE 'unlock';
ALTER TYPE "AuditAction" ADD VALUE 'write_off';

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_staffRef_fkey";

-- DropForeignKey
ALTER TABLE "LeaveRequest" DROP CONSTRAINT "LeaveRequest_staffRef_fkey";

-- DropForeignKey
ALTER TABLE "PayrollAdjustment" DROP CONSTRAINT "PayrollAdjustment_payrollId_fkey";

-- DropForeignKey
ALTER TABLE "StaffDocument" DROP CONSTRAINT "StaffDocument_staffRef_fkey";

-- DropForeignKey
ALTER TABLE "StaffPayRate" DROP CONSTRAINT "StaffPayRate_staffRef_fkey";

-- DropForeignKey
ALTER TABLE "Timesheet" DROP CONSTRAINT "Timesheet_staffRef_fkey";

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "annualLeaveDays" DOUBLE PRECISION,
ADD COLUMN     "carryOverDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "probationEndDate" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- AddForeignKey
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_staffRef_fkey" FOREIGN KEY ("staffRef") REFERENCES "Staff"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "PayrollRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
