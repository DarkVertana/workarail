'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  formatMoney,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
} from '@/app/lib/admin-data'
import {
  AttachmentPreview,
  type PreviewTarget,
} from '@/app/ui/admin/attachment-preview'
import { StatusPill } from '@/app/ui/crew/status-pill'
import { useToast } from '@/app/ui/toast'
import { submitCrewExpense } from '@/app/actions/crew'
import { uploadAttachment, type AttachmentRef } from '@/app/ui/upload'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const CATEGORY: Record<ExpenseCategory, string> = {
  travel: 'Travel',
  materials: 'Materials',
  equipment: 'Equipment',
  meals: 'Meals',
  training: 'Training',
  other: 'Other',
}

const METHOD: Record<PaymentMethod, string> = {
  company_card: 'Company card',
  personal: 'Personal',
  cash: 'Cash',
}

function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

const field =
  'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40'

export function ExpenseClaims({
  existing,
  today,
}: {
  existing: Expense[]
  today: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const router = useRouter()
  const id = useId()

  const all = existing
  const owed = all
    .filter(
      (e) =>
        e.method !== 'company_card' &&
        (e.status === 'submitted' || e.status === 'approved')
    )
    .reduce((n, e) => n + e.amountPence, 0)
  const awaiting = all.filter((e) => e.status === 'submitted').length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <Figure label="Claims" value={String(all.length)} />
        <Figure label="Awaiting review" value={String(awaiting)} />
        <Figure label="Owed to you" value={formatMoney(owed)} />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-medium text-zinc-900">Your claims</h2>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            {open ? 'Cancel' : 'New claim'}
          </button>
        </div>

        {open ? (
          <form
            className="border-b border-zinc-200 bg-zinc-50 px-5 py-4"
            onSubmit={async (e) => {
              e.preventDefault()
              const data = new FormData(e.currentTarget)
              const amount = Number(data.get('amount'))
              if (!Number.isFinite(amount) || amount <= 0) {
                setError('Enter an amount greater than zero.')
                return
              }

              if (submitting) return
              setSubmitting(true)
              try {
                const file = data.get('receipt')
                let receipt: AttachmentRef | null = null
                if (file instanceof File && file.size > 0) {
                  receipt = await uploadAttachment(file)
                }

                const result = await submitCrewExpense({
                  date: String(data.get('date')),
                  category: data.get('category') as string,
                  merchant: String(data.get('merchant')).trim(),
                  description: String(data.get('description')).trim(),
                  amountPence: Math.round(amount * 100),
                  method: data.get('method') as string,
                  receipt,
                })

                if (!result.ok) {
                  setError(result.error)
                  return
                }

                setError(null)
                setOpen(false)
                setFileName(null)
                toast('Claim submitted for review.')
                router.refresh()
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : 'Could not reach the server. Check your connection and try again.'
                )
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {error ? (
              <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Merchant" htmlFor={`${id}-merchant`}>
                <input id={`${id}-merchant`} name="merchant" required placeholder="Northern Rail" className={field} />
              </Field>
              <Field label="Amount (£)" htmlFor={`${id}-amount`}>
                <input id={`${id}-amount`} name="amount" type="number" step="0.01" min="0.01" required placeholder="86.40" className={field} />
              </Field>
            </div>

            <Field label="What was it for?" htmlFor={`${id}-desc`} className="mt-4">
              <input id={`${id}-desc`} name="description" required placeholder="Return fare to Vale depot" className={field} />
            </Field>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Date" htmlFor={`${id}-date`}>
                <input id={`${id}-date`} name="date" type="date" required defaultValue={today} max={today} className={field} />
              </Field>
              <Field label="Category" htmlFor={`${id}-cat`}>
                <select id={`${id}-cat`} name="category" className={field}>
                  {(Object.keys(CATEGORY) as ExpenseCategory[]).map((c) => (
                    <option key={c} value={c}>{CATEGORY[c]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Paid with" htmlFor={`${id}-method`}>
                <select id={`${id}-method`} name="method" defaultValue="personal" className={field}>
                  {(Object.keys(METHOD) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>{METHOD[m]}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Receipt" htmlFor={`${id}-receipt`} className="mt-4">
              <input
                id={`${id}-receipt`}
                name="receipt"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-zinc-700"
              />
            </Field>
            <p className="mt-1 text-xs text-zinc-500">
              {fileName
                ? `Attached: ${fileName}`
                : 'Photo or PDF. Claims without a receipt take longer to approve.'}
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit claim'}
              </button>
            </div>
          </form>
        ) : null}

        {all.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            You haven&apos;t claimed anything yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {all.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">
                    {e.merchant}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {shortDate(e.date)} · {CATEGORY[e.category]} · {e.description}
                  </span>
                </span>

                {e.receipt ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPreview({
                        file: e.receipt!,
                        title: e.id,
                        subtitle: `${e.merchant} · ${formatMoney(e.amountPence)}`,
                      })
                    }
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  >
                    Receipt
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-[#b02c2c]">No receipt</span>
                )}

                <span
                  className="w-20 shrink-0 text-right text-sm font-medium text-zinc-900"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatMoney(e.amountPence)}
                </span>
                <StatusPill status={e.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <AttachmentPreview target={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-700">
        {label}
      </label>
      {children}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
    </div>
  )
}
