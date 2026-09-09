'use client'

import { useId, useState } from 'react'
import {
  type LeaveRequest,
  type LeaveType,
} from '@/app/lib/admin-data'
import { StatusPill } from '@/app/ui/crew/status-pill'
import { useToast } from '@/app/ui/toast'
import { submitCrewLeaveRequest } from '@/app/actions/crew'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TYPES: LeaveType[] = ['annual', 'sick', 'unpaid', 'parental', 'compassionate']

function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

/**
 * Working days between two ISO dates, inclusive, skipping weekends — the
 * figure people are actually charged for.
 */
export function workingDays(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let cursor = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  if (end < cursor) return 0
  let count = 0
  while (cursor <= end) {
    const day = new Date(cursor).getUTCDay()
    if (day !== 0 && day !== 6) count += 1
    cursor += 86_400_000
  }
  return count
}

const field =
  'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40'

export function LeaveForm({
  staffRef,
  existing,
  today,
  taken,
  totalLeaveDays,
}: {
  staffRef: string
  existing: LeaveRequest[]
  today: string
  taken: number
  totalLeaveDays: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const id = useId()

  const all = existing
  const pending = all
    .filter((r) => r.status === 'pending')
    .reduce((n, r) => n + r.days, 0)
  const remaining = totalLeaveDays - taken - pending

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <Balance label="Remaining" value={remaining} tone="text-[#006300]" />
        <Balance label="Taken" value={taken} tone="text-zinc-900" />
        <Balance label="Pending" value={pending} tone="text-amber-700" />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-medium text-zinc-900">Your requests</h2>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            {open ? 'Cancel' : 'Request leave'}
          </button>
        </div>

        {open ? (
          <form
            className="border-b border-zinc-200 bg-zinc-50 px-5 py-4"
            onSubmit={async (e) => {
              e.preventDefault()
              const data = new FormData(e.currentTarget)
              const from = String(data.get('from'))
              const to = String(data.get('to'))
              const reason = String(data.get('reason')).trim()

              if (to < from) {
                setError('The end date is before the start date.')
                return
              }
              const days = workingDays(from, to)
              if (days === 0) {
                setError('That range has no working days in it.')
                return
              }
              const type = data.get('type') as LeaveType
              if (type === 'annual' && days > remaining) {
                setError(
                  `That's ${days} days but only ${remaining} remain. Pick a shorter range or unpaid leave.`
                )
                return
              }

              try {
                const result = await submitCrewLeaveRequest({
                  type,
                  from,
                  to,
                  reason,
                })
                if ('error' in result) {
                  setError(result.error)
                  return
                }
                setError(null)
                setOpen(false)
                toast(`Request submitted for ${result.days} day${result.days === 1 ? '' : 's'}.`)
              } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Failed to submit request.')
              }
            }}
          >
            {error ? (
              <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700" htmlFor={`${id}-type`}>
                Type
                <div className="relative">
                  <select id={`${id}-type`} name="type" className={`${field} appearance-none pr-9`}>
                    {TYPES.map((t) => (
                      <option key={t} value={t} className="capitalize">
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-zinc-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
                    </svg>
                  </span>
                </div>
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700" htmlFor={`${id}-from`}>
                From
                <input id={`${id}-from`} name="from" type="date" required defaultValue={today} min={today} className={field} />
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700" htmlFor={`${id}-to`}>
                To
                <input id={`${id}-to`} name="to" type="date" required defaultValue={today} min={today} className={field} />
              </label>
            </div>

            <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium text-zinc-700" htmlFor={`${id}-reason`}>
              Reason
              <input id={`${id}-reason`} name="reason" required placeholder="Family holiday" className={field} />
            </label>

            <p className="mt-3 text-xs text-zinc-500">
              Weekends aren&apos;t counted. Annual leave is checked against your
              remaining balance.
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                Submit request
              </button>
            </div>
          </form>
        ) : null}

        {all.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            You haven&apos;t requested any leave yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {all.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-zinc-900 capitalize">
                    {r.type} leave · {r.days} day{r.days === 1 ? '' : 's'}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {shortDate(r.from)} – {shortDate(r.to)} · {r.reason}
                  </span>
                </span>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Balance({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${tone}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p className="text-xs text-zinc-500">days</p>
    </div>
  )
}
