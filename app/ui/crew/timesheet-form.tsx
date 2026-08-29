'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  attendanceHours,
  type AttendanceCode,
} from '@/app/lib/admin-data'
import { useToast } from '@/app/ui/toast'
import { saveCrewTimesheet } from '@/app/actions/crew'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

const OPTIONS: { code: AttendanceCode; label: string }[] = [
  { code: 'P', label: 'Present' },
  { code: 'H', label: 'Half day' },
  { code: 'L', label: 'Leave' },
  { code: 'A', label: 'Absent' },
  { code: '-', label: 'Non-working' },
]

const TONE: Record<AttendanceCode, string> = {
  P: 'bg-[#0ca30c]/12 text-[#006300]',
  H: 'bg-amber-100 text-amber-800',
  L: 'bg-zinc-200 text-zinc-700',
  A: 'bg-[#d03b3b]/12 text-[#b02c2c]',
  '-': 'bg-zinc-100 text-zinc-500',
}

function dayDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

/**
 * The employee's own timesheet. Editable until it's submitted, then locked so
 * a submitted week can't be quietly changed.
 */
export function TimesheetForm({
  initial,
  today,
  weekDays,
}: {
  initial: AttendanceCode[]
  today: string
  weekDays: string[]
}) {
  const [codes, setCodes] = useState<AttendanceCode[]>(initial)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const toast = useToast()
  const router = useRouter()

  const total = codes.reduce((n, c) => n + attendanceHours[c], 0)
  const changed = codes.some((c, i) => c !== initial[i])

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-medium text-zinc-900">This week</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {submitted
              ? 'Submitted for approval. Ask your lead to reopen it if something is wrong.'
              : 'Set each day, then submit for approval.'}
          </p>
        </div>
        {submitted ? (
          <span className="rounded-full bg-[#0ca30c]/12 px-2.5 py-1 text-xs font-medium text-[#006300]">
            Submitted
          </span>
        ) : null}
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-600">
            <th scope="col" className="px-5 py-3 font-medium">Day</th>
            <th scope="col" className="px-5 py-3 font-medium">Date</th>
            <th scope="col" className="px-5 py-3 font-medium">Status</th>
            <th scope="col" className="px-5 py-3 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code, i) => {
            const iso = weekDays[i]
            const isToday = iso === today
            return (
              <tr
                key={iso}
                className={`border-b border-zinc-100 last:border-0 ${isToday ? 'bg-indigo-50/40' : ''}`}
              >
                <td className="px-5 py-2.5 font-medium text-zinc-900">
                  {DOW[i]}
                  {isToday ? (
                    <span className="ml-2 text-xs font-normal text-indigo-600">
                      Today
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-2.5 text-zinc-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {dayDate(iso)}
                </td>
                <td className="px-5 py-2.5">
                  {submitted ? (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[code]}`}>
                      {OPTIONS.find((o) => o.code === code)?.label}
                    </span>
                  ) : (
                    <div className="relative w-40">
                      <select
                        value={code}
                        aria-label={`Status for ${DOW[i]}`}
                        onChange={(e) =>
                          setCodes((prev) =>
                            prev.map((c, j) =>
                              j === i ? (e.target.value as AttendanceCode) : c
                            )
                          )
                        }
                        className="h-9 w-full appearance-none rounded-lg border border-zinc-300 bg-white pr-9 pl-3 text-sm text-zinc-900 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                      >
                        {OPTIONS.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-zinc-400">
                        <Chevron />
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right text-zinc-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {attendanceHours[code]}h
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-zinc-200 bg-zinc-50 font-medium text-zinc-900">
            <td colSpan={3} className="px-5 py-3">Total</td>
            <td className="px-5 py-3 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {total}h
            </td>
          </tr>
        </tfoot>
      </table>

      {submitted ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3">
          <p className="text-xs text-zinc-500">
            {changed ? 'Unsaved changes to this week.' : 'No changes yet.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!changed}
              onClick={() => {
                setCodes(initial)
                toast('Timesheet reset.', 'info')
              }}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={async () => {
                if (pending) return // guards against a double submit
                setPending(true)
                try {
                  const res = await saveCrewTimesheet(codes)
                  if (res.ok) {
                    setSubmitted(true)
                    toast(`Timesheet submitted — ${total}h this week.`)
                    router.refresh()
                  } else {
                    // Show the reason the server gave rather than a generic
                    // failure, so the person knows what to change.
                    toast(res.error, 'error')
                  }
                } catch {
                  toast(
                    'Could not reach the server. Check your connection and try again.',
                    'error'
                  )
                } finally {
                  setPending(false)
                }
              }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? 'Submitting…' : 'Submit timesheet'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  )
}
