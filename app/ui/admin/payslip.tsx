'use client'

import { useEffect, useRef } from 'react'
import {
  formatMoney,
  type PayrollRecord,
  type StaffMember,
} from '@/app/lib/admin-data'
import { STAT_ICON } from '@/app/ui/admin/stat-card'

export type PayslipAdjustment = { label: string; amountPence: number }

/**
 * A payslip only identifies the employee — it never shows their crew, current
 * job or utilisation. Asking for the full `StaffMember` view model forced
 * callers holding a plain staff record to cast, which hid real mismatches.
 */
export type PayslipPerson = Pick<StaffMember, 'name' | 'ref' | 'email' | 'role'>

export type PayslipTarget = {
  record: PayrollRecord
  person: PayslipPerson
  /** One-off additions or deductions applied to this run. */
  adjustments?: PayslipAdjustment[]
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function longDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]} ${y}`
}

/**
 * Payment slip. "Generate" is the browser's own print pipeline — print to PDF
 * gives a real document without pulling in a PDF library or a render service.
 */
export function PayslipDialog({
  target,
  onClose,
}: {
  target: PayslipTarget | null
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (target && !el.open) el.showModal()
    if (!target && el.open) el.close()
  }, [target])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-label="Payment slip"
      className="m-auto w-[min(46rem,94vw)] rounded-xl border border-zinc-200 bg-white p-0 backdrop:bg-black/50"
    >
      {target ? (
        <>
          <div className="payslip-noprint flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3">
            <h2 className="text-sm font-medium text-zinc-900">
              Payment slip · {target.person.name}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                <PrintIcon />
                Print / Save as PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                <svg {...STAT_ICON}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-h-[75vh] overflow-auto bg-zinc-50 p-5">
            <Sheet {...target} />
          </div>
        </>
      ) : null}
    </dialog>
  )
}

function Sheet({
  record,
  person,
  adjustments = [],
}: {
  record: PayrollRecord
  person: PayslipPerson
  adjustments?: PayslipAdjustment[]
}) {
  const periodLabel = record.reference.match(/(\d{4})-?(\d{2})$/)
    ? (() => {
        const m = record.reference.match(/(\d{4})-?(\d{2})$/)!
        return `${MON[Number(m[2]) - 1]} ${m[1]}`
      })()
    : 'Current period'

  const deductions = record.taxPence + record.niPence + record.pensionPence
  // Gross already includes them; showing the base separately keeps the slip
  // reconcilable line by line.
  const adjustmentTotal = adjustments.reduce((n, a) => n + a.amountPence, 0)
  const basePence = record.grossPence - adjustmentTotal

  return (
    <article className="payslip-sheet mx-auto max-w-2xl rounded-lg border border-zinc-200 bg-white p-8">
      <header className="flex items-start justify-between gap-6 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-lg font-semibold tracking-tight text-zinc-900">
            Work à Rail
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {/* The slip states its own period, not whatever the current run
                happens to be — an old payslip must not relabel itself. */}
            Payment slip · {periodLabel}
          </p>
        </div>
        <div className="text-right">
          <p
            className="text-xs text-zinc-500"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {record.reference}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {record.paidOn ? `Paid ${longDate(record.paidOn)}` : 'Not yet paid'}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-zinc-200 py-5">
        <div>
          <p className="text-xs text-zinc-500">Employee</p>
          <p className="mt-1 font-medium text-zinc-900">{person.name}</p>
          <p className="text-sm text-zinc-600">{person.role}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">Staff ID</p>
          <p
            className="mt-1 font-medium text-zinc-900"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {person.ref}
          </p>
          <p className="text-sm text-zinc-600">{person.email}</p>
        </div>
      </section>

      <table className="w-full py-5 text-sm">
        <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
          {adjustments.length > 0 ? (
            <>
              <Line label="Basic pay" value={basePence} />
              {adjustments.map((a) => (
                <Line key={a.label} label={a.label} value={a.amountPence} indent />
              ))}
              <Line label="Gross pay" value={record.grossPence} bold />
            </>
          ) : (
            <Line label="Gross pay" value={record.grossPence} />
          )}
          <tr>
            <td colSpan={2} className="pt-4 pb-1 text-xs text-zinc-500 uppercase">
              Deductions
            </td>
          </tr>
          <Line label="Income tax" value={-record.taxPence} indent />
          <Line label="National Insurance" value={-record.niPence} indent />
          <Line label="Pension" value={-record.pensionPence} indent />
          <Line label="Total deductions" value={-deductions} bold />
        </tbody>
      </table>

      <footer className="flex items-center justify-between border-t-2 border-zinc-900 pt-4">
        <p className="font-medium text-zinc-900">Net pay</p>
        <p
          className="text-xl font-semibold tracking-tight text-zinc-900"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatMoney(record.netPence)}
        </p>
      </footer>

      <p className="mt-6 text-center text-[11px] text-zinc-400">
        Sample document for demo purposes.
      </p>
    </article>
  )
}

function Line({
  label,
  value,
  indent,
  bold,
}: {
  label: string
  value: number
  indent?: boolean
  bold?: boolean
}) {
  const negative = value < 0
  return (
    <tr className={bold ? 'border-t border-zinc-200' : ''}>
      <td
        className={`py-1.5 ${indent ? 'pl-4' : ''} ${bold ? 'font-medium text-zinc-900' : 'text-zinc-600'}`}
      >
        {label}
      </td>
      <td
        className={`py-1.5 text-right ${bold ? 'font-medium text-zinc-900' : 'text-zinc-700'}`}
      >
        {negative ? '−' : ''}
        {formatMoney(Math.abs(value))}
      </td>
    </tr>
  )
}

function PrintIcon() {
  return (
    <svg {...STAT_ICON} className="size-4">
      <path d="M7 9V4.5h10V9" />
      <rect x="4" y="9" width="16" height="7" rx="1.6" />
      <path d="M7 14h10v5.5H7z" />
    </svg>
  )
}
