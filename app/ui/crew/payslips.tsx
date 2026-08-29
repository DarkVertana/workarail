'use client'

import { useState } from 'react'
import {
  formatMoney,
  type PayrollRecord,
} from '@/app/lib/admin-data'
import {
  PayslipDialog,
  type PayslipPerson,
  type PayslipTarget,
} from '@/app/ui/admin/payslip'

export function CrewPayslips({
  person,
  record,
}: {
  person: PayslipPerson
  record: (PayrollRecord & { month: number; year: number }) | null
}) {
  const [slip, setSlip] = useState<PayslipTarget | null>(null)

  if (!record) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white px-5 py-10 text-center">
        <p className="text-sm font-medium text-zinc-900">No payslips yet</p>
        <p className="mt-1 text-sm text-zinc-500">
          Your first slip appears once a pay run includes you.
        </p>
      </section>
    )
  }

  const deductions = record.taxPence + record.niPence + record.pensionPence
  // Only one run exists so far, so year to date is that run. It adds up as
  // more periods land rather than needing a separate figure.
  const periods = 1
  const ytdGross = record.grossPence * periods
  const ytdNet = record.netPence * periods
  const ytdDeductions = deductions * periods

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  const payPeriodLabel = `${MONTHS[record.month - 1]} ${record.year}`

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <Ytd label="Gross year to date" value={formatMoney(ytdGross)} />
        <Ytd label="Deductions" value={formatMoney(ytdDeductions)} />
        <Ytd label="Net paid" value={formatMoney(ytdNet)} />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <ul className="divide-y divide-zinc-100">
          <li className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-900">
                {payPeriodLabel}
              </span>
              <span className="block text-xs text-zinc-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {record.reference} ·{' '}
                {record.paidOn ? `paid ${record.paidOn}` : 'not yet paid'}
              </span>
            </span>

            <span className="text-right">
              <span className="block text-xs text-zinc-500">Net pay</span>
              <span
                className="block text-lg font-semibold tracking-tight text-zinc-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatMoney(record.netPence)}
              </span>
            </span>

            <button
              type="button"
              onClick={() => setSlip({ record, person })}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              View payslip
            </button>
          </li>
        </ul>

        <dl className="grid grid-cols-2 gap-px border-t border-zinc-200 bg-zinc-200 sm:grid-cols-4">
          <Cell label="Gross" value={formatMoney(record.grossPence)} />
          <Cell label="Tax" value={`−${formatMoney(record.taxPence)}`} />
          <Cell label="NI" value={`−${formatMoney(record.niPence)}`} />
          <Cell label="Pension" value={`−${formatMoney(record.pensionPence)}`} />
        </dl>
        <p className="border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
          Total deductions {formatMoney(deductions)}
        </p>
      </section>

      <PayslipDialog target={slip} onClose={() => setSlip(null)} />
    </>
  )
}

function Ytd({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="truncate text-sm text-zinc-600">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </dd>
    </div>
  )
}
