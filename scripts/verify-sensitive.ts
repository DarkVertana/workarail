/**
 * Read-only check that sensitive employee data is stored the way we promised:
 * bank identifiers encrypted at rest, only masked tails in the clear, and no
 * plaintext account details anywhere in the audit trail.
 */
import { prisma } from '../app/lib/prisma'

async function main() {
  const accounts = await prisma.staffBankAccount.findMany({
    select: {
      id: true,
      staffRef: true,
      accountHolderName: true,
      bankName: true,
      bicEnc: true,
      method: true,
      sortCodeEnc: true,
      accountNumberEnc: true,
      ibanEnc: true,
      accountLast4: true,
      sortCodeLast2: true,
      isPrimary: true,
      verifiedAt: true,
    },
    orderBy: { staffRef: 'asc' },
  })

  console.log(`Bank accounts: ${accounts.length}`)
  console.log(`  verified:    ${accounts.filter((a) => a.verifiedAt).length}`)
  console.log(`  unverified:  ${accounts.filter((a) => !a.verifiedAt).length}`)
  console.log(`  primary:     ${accounts.filter((a) => a.isPrimary).length}`)

  const problems: string[] = []

  for (const a of accounts) {
    // Ciphertext must not look like a sort code or account number.
    for (const [field, value] of [
      ['sortCodeEnc', a.sortCodeEnc],
      ['accountNumberEnc', a.accountNumberEnc],
      ['ibanEnc', a.ibanEnc],
      ['bicEnc', a.bicEnc],
    ] as const) {
      if (!value) continue
      if (/^\d{6,}$/.test(value)) {
        problems.push(`${a.staffRef}: ${field} looks like plaintext digits`)
      }
    }
    if (a.method === 'bacs' && !(a.sortCodeEnc && a.accountNumberEnc)) {
      problems.push(`${a.staffRef}: BACS account missing encrypted identifiers`)
    }
    if (!/^\d{4}$/.test(a.accountLast4)) {
      problems.push(`${a.staffRef}: accountLast4 "${a.accountLast4}" is not a 4-digit tail`)
    }
    if (!/^\d{2}$/.test(a.sortCodeLast2)) {
      problems.push(`${a.staffRef}: sortCodeLast2 "${a.sortCodeLast2}" is not a 2-digit tail`)
    }
  }

  // One primary account per staff member at most.
  const primaryByStaff = new Map<string, number>()
  for (const a of accounts.filter((x) => x.isPrimary)) {
    primaryByStaff.set(a.staffRef, (primaryByStaff.get(a.staffRef) ?? 0) + 1)
  }
  for (const [ref, count] of primaryByStaff) {
    if (count > 1) problems.push(`${ref}: ${count} primary accounts`)
  }

  // The audit trail must never carry raw bank identifiers.
  const audits = await prisma.auditLog.findMany({
    select: { id: true, action: true, entity: true, before: true, after: true },
  })
  for (const entry of audits) {
    const blob = JSON.stringify({ b: entry.before, a: entry.after })
    if (/"(sortCode|accountNumber|iban|bic)"\s*:\s*"[^"*]/.test(blob)) {
      problems.push(`audit ${entry.id} (${entry.entity}.${entry.action}) contains bank plaintext`)
    }
  }
  console.log(`Audit entries scanned: ${audits.length}`)

  // Payroll must reference the account it actually paid.
  const paidWithoutAccount = await prisma.payrollRecord.count({
    where: { status: { in: ['approved', 'paid'] }, bankAccountId: null },
  })
  if (paidWithoutAccount > 0) {
    problems.push(`${paidWithoutAccount} approved/paid payroll records have no bank account`)
  }

  console.log('')
  if (problems.length === 0) {
    console.log('Sensitive data checks passed.')
  } else {
    console.log(`${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exitCode = 1
  }
}

main().finally(() => prisma.$disconnect())
