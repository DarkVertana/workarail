'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { useToast } from '@/app/ui/toast'
import {
  formatMoney,
  type Attachment,
  type Expense,
  type ExpenseCategory,
  type ExpenseStatus,
  type PaymentMethod,
  type StaffMember,
} from '@/app/lib/admin-data'
import {
  AttachmentPreview,
  type PreviewTarget,
} from '@/app/ui/admin/attachment-preview'
import { STAT_ICON, StatCard } from '@/app/ui/admin/stat-card'
import { decideExpense, addExpense } from '@/app/actions/admin'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

const CATEGORY: Record<ExpenseCategory, string> = {
  travel: 'Travel',
  materials: 'Materials',
  equipment: 'Equipment',
  meals: 'Meals',
  training: 'Training',
  other: 'Other',
}

const METHOD: Record<PaymentMethod, string> = {
  'company-card': 'Company card',
  personal: 'Personal',
  cash: 'Cash',
}

const STATUS: Record<ExpenseStatus, { label: string; badge: string; tone: string }> =
  {
    submitted: {
      label: 'Submitted',
      badge: 'bg-amber-100 text-amber-800',
      tone: 'bg-amber-100 text-amber-800',
    },
    approved: {
      label: 'Approved',
      badge: 'bg-indigo-100 text-indigo-700',
      tone: 'bg-indigo-100 text-indigo-700',
    },
    reimbursed: {
      label: 'Reimbursed',
      badge: 'bg-[#0ca30c]/12 text-[#006300]',
      tone: 'bg-[#0ca30c]/12 text-[#006300]',
    },
    rejected: {
      label: 'Rejected',
      badge: 'bg-[#d03b3b]/12 text-[#b02c2c]',
      tone: 'bg-[#d03b3b]/12 text-[#b02c2c]',
    },
  }

const STATUS_ORDER: ExpenseStatus[] = [
  'submitted',
  'approved',
  'reimbursed',
  'rejected',
]

export function ExpensesTable({
  initialExpenses,
  initialStaff,
  todayDate,
}: {
  initialExpenses: Expense[]
  initialStaff: StaffMember[]
  todayDate: string
}) {
  const expensesData = initialExpenses
  const staffData = initialStaff
  const activeToday = todayDate

  const nameFor = (ref: string) => staffData.find((p) => p.ref === ref)?.name ?? ref

  const [decisions, setDecisions] = useState<Record<string, ExpenseStatus>>({})
  const [status, setStatus] = useState<ExpenseStatus | 'all'>('all')
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [added, setAdded] = useState<Expense[]>([])
  const [adding, setAdding] = useState(false)
  const toast = useToast()

  // Renders in the topbar rather than this toolbar.
  useRegisterPageAction('Add expense', () => setAdding(true))

  const all = [...added, ...expensesData].map((e) => ({
    ...e,
    status: decisions[e.id] ?? e.status,
  }))

  const q = query.trim().toLowerCase()
  const rows = all.filter((e) => {
    if (status !== 'all' && e.status !== status) return false
    if (category !== 'all' && e.category !== category) return false
    if (!q) return true
    return [e.id, e.merchant, e.description, nameFor(e.staffRef)].some((f) =>
      f.toLowerCase().includes(q)
    )
  })

  const sum = (list: typeof all) =>
    list.reduce((n, e) => n + e.amountPence, 0)
  const byStatus = (s: ExpenseStatus) => all.filter((e) => e.status === s)

  // Owed back to people who paid out of pocket and haven't been repaid yet.
  const owed = all.filter(
    (e) => e.method !== 'company-card' && (e.status === 'approved' || e.status === 'submitted')
  )

  async function decide(id: string, next: ExpenseStatus) {
    setDecisions((prev) => ({ ...prev, [id]: next }))
    const verb =
      next === 'approved'
        ? 'approved'
        : next === 'rejected'
          ? 'rejected'
          : 'marked reimbursed'
    toast(`Expense ${id} ${verb}.`, next === 'rejected' ? 'info' : 'success')
    try {
      await decideExpense(id, next as 'approved' | 'rejected' | 'reimbursed')
    } catch (err) {
      console.error(err)
      toast('Failed to save status in database.', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MoneyCard
          label="Total claimed"
          pence={sum(all.filter((e) => e.status !== 'rejected'))}
          hint={`${all.filter((e) => e.status !== 'rejected').length} expenses`}
          tone="bg-zinc-100 text-zinc-700"
          icon={<WalletIcon />}
        />
        <MoneyCard
          label="Awaiting approval"
          pence={sum(byStatus('submitted'))}
          hint={`${byStatus('submitted').length} to review`}
          tone={STATUS.submitted.tone}
          icon={<ClockIcon />}
        />
        <MoneyCard
          label="To reimburse"
          pence={sum(owed)}
          hint={`${owed.length} out of pocket`}
          tone={STATUS.approved.tone}
          icon={<HandCoinIcon />}
        />
        <StatCard
          label="Rejected"
          value={byStatus('rejected').length}
          tone={STATUS.rejected.tone}
          icon={<SlashIcon />}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3">
          <span className="text-sm text-zinc-500">
            {rows.length} of {all.length} expenses
            <span className="ml-2 font-medium text-zinc-900">
              {formatMoney(sum(rows))}
            </span>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={category}
              onChange={(v) => setCategory(v as ExpenseCategory | 'all')}
              label="Filter by category"
              options={[
                { value: 'all', label: 'All categories' },
                ...(Object.keys(CATEGORY) as ExpenseCategory[]).map((c) => ({
                  value: c,
                  label: CATEGORY[c],
                })),
              ]}
            />
            <Select
              value={status}
              onChange={(v) => setStatus(v as ExpenseStatus | 'all')}
              label="Filter by status"
              options={[
                { value: 'all', label: 'All statuses' },
                ...STATUS_ORDER.map((s) => ({
                  value: s,
                  label: STATUS[s].label,
                })),
              ]}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search expenses..."
              aria-label="Search by ID, merchant, description or employee"
              className="w-48 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600">
                <th scope="col" className="px-5 py-3 font-medium">Date</th>
                <th scope="col" className="px-5 py-3 font-medium">Expense</th>
                <th scope="col" className="px-5 py-3 font-medium">Employee</th>
                <th scope="col" className="px-5 py-3 font-medium">Category</th>
                <th scope="col" className="px-5 py-3 font-medium">Method</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                <th scope="col" className="px-5 py-3 font-medium">Status</th>
                <th scope="col" className="px-5 py-3 font-medium">Receipt</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-900">
                      No matching expenses
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Nothing matches the current search and filters.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((e) => {
                  const s = STATUS[e.status]
                  return (
                    <tr key={e.id} className="border-b border-zinc-100 last:border-0">
                      <td
                        className="px-5 py-3 text-zinc-600"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {shortDate(e.date)}
                      </td>
                      <td className="px-5 py-3">
                        <span className="block font-medium text-zinc-900">
                          {e.merchant}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {e.description}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        {nameFor(e.staffRef)}
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        {CATEGORY[e.category]}
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        {METHOD[e.method]}
                      </td>
                      <td
                        className="px-5 py-3 text-right font-medium text-zinc-900"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatMoney(e.amountPence)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {e.receipt ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreview({
                                file: e.receipt!,
                                title: e.id,
                                subtitle: `${e.merchant} · ${formatMoney(e.amountPence)} · ${e.receipt!.size}`,
                                note: `${CATEGORY[e.category]} · claimed by ${nameFor(e.staffRef)}`,
                              })
                            }
                            title={`${e.receipt.name} · ${e.receipt.size}`}
                            aria-label={`Receipt for ${e.id}: ${e.receipt.name}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                          >
                            {e.receipt.kind === 'pdf' ? <PdfIcon /> : <ImageIcon />}
                            {e.receipt.kind === 'pdf' ? 'PDF' : 'Image'}
                          </button>
                        ) : (
                          <span className="text-xs text-[#b02c2c]">Missing</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {e.status === 'submitted' ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => decide(e.id, 'approved')}
                              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => decide(e.id, 'rejected')}
                              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                            >
                              Reject
                            </button>
                          </div>
                        ) : e.status === 'approved' ? (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => decide(e.id, 'reimbursed')}
                              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                            >
                              Mark reimbursed
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AddExpenseDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={async (e) => {
          setAdded((prev) => [e, ...prev])
          setAdding(false)
          toast(`Expense ${e.id} added for approval.`)
          try {
            await addExpense(e)
          } catch (err) {
            console.error(err)
            toast('Failed to save expense in database.', 'error')
          }
        }}
        nextId={`EX-${4022 + all.length}`}
        staff={staffData}
        todayDate={activeToday}
      />

      <AttachmentPreview target={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

/**
 * New expense claim. The receipt is a real upload: the picked file is exposed
 * via an object URL, so the preview shows the actual document rather than a
 * stand-in. That URL lives for this tab only — real storage replaces it.
 */
function AddExpenseDialog({
  open,
  onClose,
  onAdd,
  nextId,
  staff,
  todayDate,
}: {
  open: boolean
  onClose: () => void
  onAdd: (expense: Expense) => void
  nextId: string
  staff: StaffMember[]
  todayDate: string
}) {
  const activeToday = todayDate
  const ref = useRef<HTMLDialogElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  // Refs can't be read during render — drive the dialog from an effect,
  // the same way AttachmentPreview does.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)

    const amount = Number(data.get('amount'))
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    const file = data.get('receipt')
    let receipt: Attachment | null = null
    if (file instanceof File && file.size > 0) {
      receipt = {
        name: file.name,
        kind: file.type === 'application/pdf' ? 'pdf' : 'image',
        size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
        url: URL.createObjectURL(file),
      }
    }

    onAdd({
      id: nextId,
      date: String(data.get('date')),
      category: data.get('category') as ExpenseCategory,
      merchant: String(data.get('merchant')).trim(),
      description: String(data.get('description')).trim(),
      // Pounds in, pence stored — rounded once, here.
      amountPence: Math.round(amount * 100),
      staffRef: String(data.get('staffRef')),
      method: data.get('method') as PaymentMethod,
      status: 'submitted',
      receipt,
    })

    form.reset()
    setFileName(null)
    setError(null)
  }

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
      aria-label="Add expense"
      className="m-auto w-[min(34rem,92vw)] rounded-xl border border-zinc-200 bg-white p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3">
          <h2 className="text-sm font-medium text-zinc-900">New expense</h2>
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

          <div className="grid grid-cols-2 gap-4">
            <label className={labelCls} htmlFor={`${id}-merchant`}>
              Merchant
              <input
                id={`${id}-merchant`}
                name="merchant"
                required
                placeholder="Buildbase"
                className={field}
              />
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
                placeholder="42.75"
                className={field}
              />
            </label>
          </div>

          <label className={labelCls} htmlFor={`${id}-description`}>
            Description
            <input
              id={`${id}-description`}
              name="description"
              required
              placeholder="Ballast bags and fixings"
              className={field}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className={labelCls} htmlFor={`${id}-date`}>
              Date
              <input
                id={`${id}-date`}
                name="date"
                type="date"
                required
                defaultValue={activeToday}
                className={field}
              />
            </label>
            <label className={labelCls} htmlFor={`${id}-category`}>
              Category
              <select id={`${id}-category`} name="category" className={field}>
                {(Object.keys(CATEGORY) as ExpenseCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className={labelCls} htmlFor={`${id}-staff`}>
              Claimed by
              <select id={`${id}-staff`} name="staffRef" className={field}>
                {staff.map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls} htmlFor={`${id}-method`}>
              Paid with
              <select id={`${id}-method`} name="method" className={field}>
                {(Object.keys(METHOD) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {METHOD[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={labelCls} htmlFor={`${id}-receipt`}>
            Receipt
            <input
              id={`${id}-receipt`}
              name="receipt"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-zinc-700"
            />
            <span className="text-xs font-normal text-zinc-500">
              {fileName
                ? `Attached: ${fileName}`
                : 'Image or PDF. Optional, but claims without one are flagged.'}
            </span>
          </label>
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
            Add expense
          </button>
        </div>
      </form>
    </dialog>
  )
}

function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-9 pl-3 text-sm text-zinc-700 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
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

function PdfIcon() {
  return (
    <svg {...STAT_ICON} className="size-3.5">
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z" />
      <path d="M14 3v4.5h4.5" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg {...STAT_ICON} className="size-3.5">
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L20 17" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg {...STAT_ICON}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" />
      <circle cx="17" cy="14.5" r="1" fill="currentColor" stroke="none" />
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

function HandCoinIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="15.5" cy="7.5" r="3.5" />
      <path d="M3 14.5h4l2.5 2h3a1.5 1.5 0 0 1 0 3H9" />
      <path d="M7 18.5h3.5l7-3a1.6 1.6 0 0 1 1.8 2.6L14 21.5H3" />
    </svg>
  )
}

function SlashIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6" />
    </svg>
  )
}
