'use client'

import { useState, useEffect } from 'react'
import {
  formatMoney,
  type Attachment,
  type Invoice,
  type InvoiceStatus,
} from '@/app/lib/admin-data'
import {
  AttachmentPreview,
  type PreviewTarget,
} from '@/app/ui/admin/attachment-preview'
import { STAT_ICON, StatCard } from '@/app/ui/admin/stat-card'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { addInvoice, getClients } from '@/app/actions/admin'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** '2026-08-03' -> '3 Aug'. String maths, so no timezone drift. */
function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

const STATUS: Record<InvoiceStatus, { label: string; badge: string; tone: string }> =
  {
    paid: {
      label: 'Paid',
      badge: 'bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]',
      tone: 'bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]',
    },
    pending: {
      label: 'Pending',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
      tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    },
    overdue: {
      label: 'Overdue',
      badge: 'bg-[#d03b3b]/12 text-[#b02c2c] dark:text-[#e07272]',
      tone: 'bg-[#d03b3b]/12 text-[#b02c2c] dark:text-[#e07272]',
    },
    draft: {
      label: 'Draft',
      badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
      tone: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    },
  }

/** The one attachment this invoice carries, wrapped for the shared viewer. */
function targetFor(inv: Invoice, todayStr: string): PreviewTarget {
  const file = inv.document ?? inv.proof
  const role = inv.document ? 'Invoice document' : 'Payment proof'
  return {
    file,
    title: inv.id,
    subtitle: `${role} · ${inv.client} · ${formatMoney(inv.amountPence)} · ${file.size}`,
    note:
      inv.due < todayStr && inv.status !== 'paid'
        ? `Due ${shortDate(inv.due)} · past due`
        : `Due ${shortDate(inv.due)}`,
  }
}

const ORDER: InvoiceStatus[] = ['paid', 'pending', 'overdue', 'draft']

export function InvoicesTable({
  initialInvoices,
  todayDate,
}: {
  initialInvoices: Invoice[]
  todayDate: string
}) {
  const invoicesData = initialInvoices
  const activeToday = todayDate
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<PreviewTarget | null>(null)

  const [adding, setAdding] = useState(false)
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (adding) {
      getClients().then(setClients)
    }
  }, [adding])

  useRegisterPageAction('New invoice', () => setAdding(true))

  const q = query.trim().toLowerCase()
  const rows = invoicesData.filter((inv) => {
    if (status !== 'all' && inv.status !== status) return false
    if (!q) return true
    return [inv.id, inv.client, inv.reference].some((f) =>
      f.toLowerCase().includes(q)
    )
  })

  const sum = (s: InvoiceStatus) =>
    invoicesData.filter((i) => i.status === s).reduce((n, i) => n + i.amountPence, 0)
  const count = (s: InvoiceStatus) =>
    invoicesData.filter((i) => i.status === s).length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MoneyCard label="Paid" pence={sum('paid')} n={count('paid')} tone={STATUS.paid.tone} icon={<CheckIcon />} />
        <MoneyCard label="Awaiting payment" pence={sum('pending')} n={count('pending')} tone={STATUS.pending.tone} icon={<ClockIcon />} />
        <MoneyCard label="Overdue" pence={sum('overdue')} n={count('overdue')} tone={STATUS.overdue.tone} icon={<AlertIcon />} />
        <StatCard label="Drafts" value={count('draft')} tone={STATUS.draft.tone} icon={<DocIcon />} />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {rows.length} of {invoicesData.length} invoices
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as InvoiceStatus | 'all')
                }
                aria-label="Filter by invoice status"
                className="appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-9 pl-3 text-sm text-zinc-700 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              >
                <option value="all">All statuses</option>
                {ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-zinc-400 dark:text-zinc-500"
              >
                <ChevronDownIcon />
              </span>
            </div>

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoices..."
              aria-label="Search by invoice number, client or reference"
              className="w-52 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-5 py-3 font-medium">Invoice</th>
                <th scope="col" className="px-5 py-3 font-medium">Client</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                <th scope="col" className="px-5 py-3 font-medium">Issued</th>
                <th scope="col" className="px-5 py-3 font-medium">Due</th>
                <th scope="col" className="px-5 py-3 font-medium">Status</th>
                <th scope="col" className="px-5 py-3 font-medium">Files</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      No matching invoices
                    </p>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Nothing matches the current search and filter.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((inv) => {
                  const s = STATUS[inv.status]
                  const late = inv.status === 'overdue'
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                    >
                      <td className="px-5 py-3">
                        <span
                          className="block font-medium text-zinc-900 dark:text-zinc-100"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {inv.id}
                        </span>
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {inv.reference}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                        {inv.client}
                      </td>
                      <td
                        className="px-5 py-3 text-right font-medium text-zinc-900 dark:text-zinc-100"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatMoney(inv.amountPence)}
                      </td>
                      <td
                        className="px-5 py-3 text-zinc-600 dark:text-zinc-400"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {shortDate(inv.issued)}
                      </td>
                      <td
                        className={`px-5 py-3 ${late ? 'font-medium text-[#b02c2c] dark:text-[#e07272]' : 'text-zinc-600 dark:text-zinc-400'}`}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {shortDate(inv.due)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Either file alone is valid, so each renders on
                              its own terms rather than one being expected. */}
                          {inv.document ? (
                            <FileChip
                              file={inv.document}
                              onOpen={() => setPreview(targetFor(inv, activeToday))}
                            />
                          ) : null}
                          {inv.proof ? (
                            <FileChip
                              file={inv.proof}
                              proof
                              onOpen={() => setPreview(targetFor(inv, activeToday))}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {adding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Invoice</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = e.currentTarget
                  const formData = new FormData(form)
                  const clientName = formData.get('clientName') as string
                  const reference = formData.get('reference') as string
                  const amountPence = Math.round(parseFloat(formData.get('amount') as string) * 100)
                  const issued = formData.get('issued') as string
                  const due = formData.get('due') as string
                  const status = formData.get('status') as string

                  try {
                    await addInvoice({ clientName, reference, amountPence, issued, due, status })
                    setAdding(false)
                  } catch (err) {
                    alert(String(err))
                  }
                }}
                className="mt-4 flex flex-col gap-4"
              >
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Client Name
                  </label>
                  <input
                    type="text"
                    name="clientName"
                    list="client-suggestions"
                    required
                    placeholder="e.g. Network Rail"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                  <datalist id="client-suggestions">
                    {clients.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Reference
                  </label>
                  <input
                    type="text"
                    name="reference"
                    required
                    placeholder="e.g. Q3 track maintenance"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Amount (£)
                    </label>
                    <input
                      type="number"
                      name="amount"
                      step="0.01"
                      required
                      placeholder="e.g. 1500.00"
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Status
                    </label>
                    <select
                      name="status"
                      required
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                    >
                      <option value="pending">Pending</option>
                      <option value="paid">Paid</option>
                      <option value="overdue">Overdue</option>
                      <option value="draft">Draft</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Issue Date
                    </label>
                    <input
                      type="date"
                      name="issued"
                      required
                      defaultValue={activeToday}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Due Date
                    </label>
                    <input
                      type="date"
                      name="due"
                      required
                      defaultValue={activeToday}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </section>

      <AttachmentPreview target={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function FileChip({
  file,
  proof,
  onOpen,
}: {
  file: Attachment
  proof?: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${file.name} · ${file.size}`}
      aria-label={`${proof ? 'Payment proof' : 'Invoice document'}: ${file.name}`}
      className={`inline-flex max-w-40 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
        proof
          ? 'border-[#0ca30c]/30 text-[#006300] hover:bg-[#0ca30c]/10 dark:border-[#0ca30c]/40 dark:text-[#0ca30c]'
          : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'
      }`}
    >
      {file.kind === 'pdf' ? <PdfIcon /> : <ImageIcon />}
      <span className="truncate">{file.kind === 'pdf' ? 'PDF' : 'Image'}</span>
    </button>
  )
}

function MoneyCard({
  label,
  pence,
  n,
  tone,
  icon,
}: {
  label: string
  pence: number
  n: number
  tone: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
          {label}
        </p>
        <p
          className="truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatMoney(pence)}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {n} invoice{n === 1 ? '' : 's'}
        </p>
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

function AlertIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg {...STAT_ICON}>
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z" />
      <path d="M14 3v4.5h4.5M9 13h6M9 16.5h4" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg {...STAT_ICON} className="size-3.5">
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  )
}
