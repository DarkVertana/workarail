'use client'

import { useEffect, useId, useRef, useState } from 'react'
import {
  computePay,
  formatMoney,
  type PayrollRecord,
  type PayrollStatus,
  type StaffMember,
} from '@/app/lib/admin-data'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { useToast } from '@/app/ui/toast'
import { PayslipDialog, type PayslipTarget } from '@/app/ui/admin/payslip'
import { STAT_ICON, StatCard } from '@/app/ui/admin/stat-card'
import { addPayrollAdjustment } from '@/app/actions/admin'

const STATUS: Record<PayrollStatus, { label: string; badge: string; tone: string }> =
  {
    paid: {
      label: 'Paid',
      badge: 'bg-[#0ca30c]/12 text-[#006300]',
      tone: 'bg-[#0ca30c]/12 text-[#006300]',
    },
    pending: {
      label: 'Pending',
      badge: 'bg-amber-100 text-amber-800',
      tone: 'bg-amber-100 text-amber-800',
    },
  }

export function PayrollTable({
  initialPayrollRuns,
  initialStaff,
  activePayPeriod,
}: {
  initialPayrollRuns: PayrollRecord[]
  initialStaff: StaffMember[]
  activePayPeriod: { year: number; month: number; label: string }
}) {
  const payrollRunsData = initialPayrollRuns
  const staffData = initialStaff
  const period = activePayPeriod

  const personFor = (ref: string) => staffData.find((p) => p.ref === ref)

  const [status, setStatus] = useState<PayrollStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [slip, setSlip] = useState<PayslipTarget | null>(null)
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [adding, setAdding] = useState(false)
  const toast = useToast()

  useRegisterPageAction('Add adjustment', () => setAdding(true))

  // Apply adjustments to gross, then recompute the whole deduction stack with
  // the same formula the seeded rows used — never patch net directly.
  const runs: PayrollRecord[] = payrollRunsData.map((base) => {
    const delta = adjustments
      .filter((a) => a.staffRef === base.staffRef)
      .reduce((n, a) => n + a.amountPence, 0)
    if (delta === 0) return base
    const grossPence = base.grossPence + delta
    return { ...base, grossPence, ...computePay(grossPence) }
  })

  const q = query.trim().toLowerCase()
  const rows = runs
    .map((record) => ({ record, person: personFor(record.staffRef) }))
    .filter(
      (r): r is { record: PayrollRecord; person: NonNullable<ReturnType<typeof personFor>> } =>
        Boolean(r.person)
    )
    .filter(({ record, person }) => {
      if (status !== 'all' && record.status !== status) return false
      if (!q) return true
      return [person.name, person.ref, person.role, record.reference].some((f) =>
        f.toLowerCase().includes(q)
      )
    })

  const sum = (pick: (r: PayrollRecord) => number) =>
    runs.reduce((n, r) => n + pick(r), 0)

  const gross = sum((r) => r.grossPence)
  const deductions = sum((r) => r.taxPence + r.niPence + r.pensionPence)
  const net = sum((r) => r.netPence)
  const pending = runs.filter((r) => r.status === 'pending').length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MoneyCard label="Gross pay" pence={gross} hint={`${runs.length} employees`} tone="bg-zinc-100 text-zinc-700" icon={<WalletIcon />} />
        <MoneyCard label="Deductions" pence={deductions} hint="Tax, NI, pension" tone="bg-indigo-100 text-indigo-700" icon={<MinusIcon />} />
        <MoneyCard label="Net pay" pence={net} hint={period.label} tone={STATUS.paid.tone} icon={<CheckIcon />} />
        <StatCard label="Awaiting run" value={pending} tone={STATUS.pending.tone} icon={<ClockIcon />} />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3">
          <div>
            <span className="text-sm font-medium text-zinc-900">
              {period.label}
            </span>
            <span className="ml-2 text-sm text-zinc-500">
              {rows.length} of {runs.length} employees
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as PayrollStatus | 'all')
                }
                aria-label="Filter by payroll status"
                className="appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-9 pl-3 text-sm text-zinc-700 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-zinc-400"
              >
                <svg {...STAT_ICON} className="size-3.5">
                  <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
                </svg>
              </span>
            </div>

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees..."
              aria-label="Search by name, staff ID, role or payslip reference"
              className="w-52 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600">
                <th scope="col" className="px-5 py-3 font-medium">Employee</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Gross</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Tax</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">NI</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Pension</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Net</th>
                <th scope="col" className="px-5 py-3 font-medium">Status</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Payslip</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-900">
                      No matching employees
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Nothing matches the current search and filter.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map(({ record, person }) => {
                  const s = STATUS[record.status]
                  return (
                    <tr
                      key={record.staffRef}
                      className="border-b border-zinc-100 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <span className="block font-medium text-zinc-900">
                          {person.name}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {person.role}
                        </span>
                      </td>
                      <Num value={record.grossPence} strong />
                      <Num value={record.taxPence} negative />
                      <Num value={record.niPence} negative />
                      <Num value={record.pensionPence} negative />
                      <Num value={record.netPence} strong />
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setSlip({
                                record,
                                person,
                                periodLabel: period.label,
                                adjustments: adjustments.filter(
                                  (a) => a.staffRef === person.ref
                                ),
                              })
                            }
                            aria-label={`Generate payment slip for ${person.name}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                          >
                            <DocIcon />
                            Generate
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 font-medium text-zinc-900">
                <td className="px-5 py-3">Totals</td>
                <Num value={gross} strong />
                <Num value={sum((r) => r.taxPence)} negative />
                <Num value={sum((r) => r.niPence)} negative />
                <Num value={sum((r) => r.pensionPence)} negative />
                <Num value={net} strong />
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <AddAdjustmentDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={async (a) => {
          setAdjustments((prev) => [...prev, a])
          setAdding(false)
          const who =
            staffData.find((p) => p.ref === a.staffRef)?.name ?? a.staffRef
          toast(`${a.label} applied to ${who}. Deductions recalculated.`)
          try {
            await addPayrollAdjustment(a.staffRef, a.label, a.amountPence)
          } catch (err) {
            console.error(err)
            toast('Failed to save adjustment in database.', 'error')
          }
        }}
        staff={staffData}
      />

      <PayslipDialog target={slip} onClose={() => setSlip(null)} />
    </div>
  )
}

/** A one-off addition or deduction on top of an employee's normal pay. */
export type Adjustment = {
  staffRef: string
  label: string
  /** Signed pence: positive adds to gross, negative takes off. */
  amountPence: number
}

function AddAdjustmentDialog({
  open,
  onClose,
  onAdd,
  staff,
}: {
  open: boolean
  onClose: () => void
  onAdd: (a: Adjustment) => void
  staff: StaffMember[]
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  const field =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40'
  const labelCls = 'flex flex-col gap-1.5 text-sm font-medium text-zinc-700'

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-label="Add payroll adjustment"
      className="m-auto w-[min(32rem,92vw)] rounded-xl border border-zinc-200 bg-white p-0 backdrop:bg-black/50"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const amount = Number(data.get('amount'))
          if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter an amount greater than zero.')
            return
          }
          const sign = data.get('kind') === 'deduction' ? -1 : 1
          onAdd({
            staffRef: String(data.get('staffRef')),
            label: String(data.get('label')).trim(),
            amountPence: sign * Math.round(amount * 100),
          })
          event.currentTarget.reset()
          setError(null)
        }}
      >
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3">
          <h2 className="text-sm font-medium text-zinc-900">
            Add payroll adjustment
          </h2>
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

        <div className="flex flex-col gap-4 px-5 py-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}

          <label className={labelCls} htmlFor={`${id}-staff`}>
            Employee
            <select id={`${id}-staff`} name="staffRef" className={field}>
              {staff.map((p) => (
                <option key={p.ref} value={p.ref}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className={labelCls} htmlFor={`${id}-label`}>
            Reason
            <input
              id={`${id}-label`}
              name="label"
              required
              placeholder="Overtime bonus"
              className={field}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className={labelCls} htmlFor={`${id}-kind`}>
              Type
              <select id={`${id}-kind`} name="kind" className={field}>
                <option value="addition">Addition</option>
                <option value="deduction">Deduction</option>
              </select>
            </label>
            <label className={labelCls} htmlFor={`${id}-amount`}>
              Amount (£)
              <input
                id={`${id}-amount`}
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="250.00"
                className={field}
              />
            </label>
          </div>

          <p className="text-xs text-zinc-500">
            Tax, National Insurance and pension are recalculated on the new
            gross, so the payslip stays consistent.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Add adjustment
          </button>
        </div>
      </form>
    </dialog>
  )
}

function Num({
  value,
  negative,
  strong,
}: {
  value: number
  negative?: boolean
  strong?: boolean
}) {
  return (
    <td
      className={`px-5 py-3 text-right ${strong ? 'font-medium text-zinc-900' : 'text-zinc-600'}`}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {negative ? '−' : ''}
      {formatMoney(value)}
    </td>
  )
}

function MoneyCard({
  label,
  pence,
  hint,
  tone,
  icon,
}: {
  label: string
  pence: number
  hint: string
  tone: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-zinc-200 bg-white p-4">
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-600">{label}</p>
        <p
          className="truncate text-xl font-semibold tracking-tight text-zinc-900"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatMoney(pence)}
        </p>
        <p className="truncate text-xs text-zinc-500">{hint}</p>
      </div>
    </div>
  )
}

function WalletIcon() {
  return (
    <svg {...STAT_ICON}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h7" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.25L15.5 14" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg {...STAT_ICON} className="size-3.5">
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z" />
      <path d="M14 3v4.5h4.5" />
    </svg>
  )
}
