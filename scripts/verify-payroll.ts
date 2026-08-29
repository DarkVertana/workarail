/**
 * Read-only check that seeded payroll agrees with the HMRC engine.
 *
 * Recomputes every stored record from its own recorded inputs and compares.
 * A mismatch means the stored figure could not be reproduced, which is the
 * property that matters for a payslip.
 *
 *   npm run db:verify-payroll
 */

import 'dotenv/config'
import { prisma } from '../app/lib/prisma'
import { calculatePay, formatTaxYear } from '../app/lib/hmrc'

async function main() {
  const records = await prisma.payrollRecord.findMany({
    orderBy: [{ staffRef: 'asc' }, { taxYearStart: 'asc' }, { taxPeriod: 'asc' }],
    include: { staff: { select: { name: true } } },
  })

  console.log(`\nChecking ${records.length} payroll records...\n`)

  const ytd = new Map<string, {
    grossPence: number; taxablePence: number; taxPence: number
    niPence: number; pensionPence: number
  }>()
  let mismatches = 0

  const sample: Array<Record<string, string | number>> = []

  for (const r of records) {
    const key = `${r.staffRef}:${r.taxYearStart}`
    const prior = ytd.get(key) ?? {
      grossPence: 0, taxablePence: 0, taxPence: 0, niPence: 0, pensionPence: 0,
    }

    const profile = await prisma.staffPayrollProfile.findFirst({
      where: { staffRef: r.staffRef },
      orderBy: { effectiveFrom: 'desc' },
    })

    const recomputed = calculatePay({
      grossPence: r.grossPence,
      taxCode: r.taxCode,
      basis: r.taxBasis,
      niCategory: r.niCategory,
      payFrequency: r.payFrequency,
      taxYearStart: r.taxYearStart,
      taxPeriod: r.taxPeriod,
      ytd: prior,
      pensionPence: r.pensionPence,
      studentLoanPlan: profile?.studentLoanPlan ?? null,
      postgradLoan: profile?.postgradLoan ?? false,
    })
    ytd.set(key, recomputed.ytd)

    if (recomputed.taxPence !== r.taxPence || recomputed.niPence !== r.niPence) {
      mismatches += 1
      console.log(
        `  MISMATCH ${r.staffRef} ${formatTaxYear(r.taxYearStart)} P${r.taxPeriod}: ` +
          `stored tax=${r.taxPence} ni=${r.niPence}, ` +
          `recomputed tax=${recomputed.taxPence} ni=${recomputed.niPence}`
      )
    }

    if (sample.length < 14) {
      sample.push({
        staff: r.staffRef,
        name: r.staff.name.split(' ')[0],
        code: r.taxCode,
        NI: r.niCategory,
        freq: r.payFrequency,
        period: `${formatTaxYear(r.taxYearStart)} P${r.taxPeriod}`,
        gross: (r.grossPence / 100).toFixed(2),
        tax: (r.taxPence / 100).toFixed(2),
        ni: (r.niPence / 100).toFixed(2),
        net: (r.netPence / 100).toFixed(2),
      })
    }

    // The invariant the database also enforces.
    const reconciles =
      r.netPence ===
      r.grossPence - r.taxPence - r.niPence - r.pensionPence -
        r.studentLoanPence - r.postgradLoanPence
    if (!reconciles) {
      mismatches += 1
      console.log(`  NET DOES NOT RECONCILE for ${r.staffRef} P${r.taxPeriod}`)
    }
  }

  console.log('\n=== Sample payslips ===')
  console.table(sample)

  const refunds = records.filter((r) => r.taxPence < 0)
  console.log(`\nRefund periods (negative tax): ${refunds.length}`)
  for (const r of refunds) {
    console.log(
      `  ${r.staffRef} ${formatTaxYear(r.taxYearStart)} P${r.taxPeriod}: ` +
        `£${(r.taxPence / 100).toFixed(2)} on code ${r.taxCode}`
    )
  }

  console.log(
    mismatches === 0
      ? '\nEvery stored record reproduces exactly from its recorded inputs.'
      : `\n${mismatches} record(s) could not be reproduced.`
  )
  if (mismatches > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error('Payroll verification failed:', err.message ?? err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
