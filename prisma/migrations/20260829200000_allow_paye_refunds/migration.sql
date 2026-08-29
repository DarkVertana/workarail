-- Allow a PAYE refund to be represented.
--
-- Two earlier constraints assumed tax only ever flows one way:
--
--   PayrollRecord_money_check     required "taxPence" >= 0
--   PayrollRecord_net_within_gross required "netPence" <= "grossPence"
--
-- Both are wrong under cumulative PAYE. When HMRC raises an employee's tax
-- code part-way through the year, the employer repays the over-deduction
-- through the next payslip: that period's tax is negative and net pay exceeds
-- gross. This is the normal, statutory mechanism, not an error — it is how
-- someone taken off an emergency code gets their money back.
--
-- The constraints are replaced with ones that still catch nonsense (NI and
-- pension can never be negative, net must reconcile to gross minus the
-- deductions) while permitting the refund case.

ALTER TABLE "PayrollRecord" DROP CONSTRAINT "PayrollRecord_money_check";
ALTER TABLE "PayrollRecord" DROP CONSTRAINT "PayrollRecord_net_within_gross";

ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_money_check" CHECK (
  "grossPence" >= 0
  AND "niPence" >= 0
  AND "pensionPence" >= 0
  AND "studentLoanPence" >= 0
  AND "postgradLoanPence" >= 0
  -- Tax may be negative (a refund), but never a larger refund than a year's
  -- pay, which would indicate a calculation that has run away.
  AND "taxPence" >= -"grossPence" * 12
);

-- Net pay must equal gross minus every deduction. This is a stronger check
-- than the bound it replaces: it ties the stored figures together instead of
-- merely bounding them, so a payslip whose parts do not add up is rejected.
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_net_reconciles" CHECK (
  "netPence" = "grossPence" - "taxPence" - "niPence" - "pensionPence"
              - "studentLoanPence" - "postgradLoanPence"
);
