'use client'

import { useMemo, useState } from 'react'
import {
  leaveRequests,
  staff,
  today,
  type LeaveStatus,
  type LeaveType,
  type StaffMember,
  type LeaveRequest,
} from '@/app/lib/admin-data'
import { STAT_ICON, StatCard } from '@/app/ui/admin/stat-card'
import { useToast } from '@/app/ui/toast'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { decideLeaveRequest } from '@/app/actions/admin'
import {
  LeaveRequestDialog,
  type LeaveContext,
} from '@/app/ui/admin/leave-request-dialog'
import { formatDays } from '@/app/lib/leave'

const STATUS: Record<LeaveStatus, { label: string; badge: string; tone: string }> =
  {
    pending: {
      label: 'Pending',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
      tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    },
    approved: {
      label: 'Approved',
      badge: 'bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]',
      tone: 'bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]',
    },
    rejected: {
      label: 'Rejected',
      badge: 'bg-[#d03b3b]/12 text-[#b02c2c] dark:text-[#e07272]',
      tone: 'bg-[#d03b3b]/12 text-[#b02c2c] dark:text-[#e07272]',
    },
  }

const TYPES: Record<LeaveType, string> = {
  annual: 'Annual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  parental: 'Parental',
  compassionate: 'Compassionate',
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** '2026-08-26' -> '26 Aug'. String maths, so no timezone drift. */
function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

function range(from: string, to: string) {
  return from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`
}

/** Spells out a part-day booking, e.g. 'from the afternoon'. */
function halfDayNote(r: LeaveRequest) {
  const notes = []
  if (r.startAt === 'afternoon') notes.push('from the afternoon')
  if (r.endAt === 'lunchtime') notes.push('to lunchtime')
  return notes.join(', ')
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase()
}

export function LeaveRequests({
  initialLeaves,
  initialStaff,
  leaveContext,
  todayDate,
}: {
  initialLeaves?: LeaveRequest[]
  initialStaff?: StaffMember[]
  leaveContext?: LeaveContext
  todayDate?: string
}) {
  const leavesData = initialLeaves || leaveRequests
  const staffData = initialStaff || staff
  const activeToday = todayDate || today

  const nameFor = (ref: string) =>
    staffData.find((p) => p.ref === ref)?.name ?? ref
  const roleFor = (ref: string) =>
    staffData.find((p) => p.ref === ref)?.role ?? ''

  const [decisions, setDecisions] = useState<Record<string, LeaveStatus>>({})
  const [status, setStatus] = useState<LeaveStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const toast = useToast()

  const [adding, setAdding] = useState(false)
  useRegisterPageAction('New request', () => setAdding(true))

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leavesData
      .map((r) => ({ ...r, status: decisions[r.id] ?? r.status }))
      .filter((r) => {
        if (status !== 'all' && r.status !== status) return false
        if (!q) return true
        return [nameFor(r.staffRef), r.id, TYPES[r.type], r.reason].some((f) =>
          f.toLowerCase().includes(q)
        )
      })
  }, [leavesData, decisions, status, query])

  const all = leavesData.map((r) => ({
    ...r,
    status: decisions[r.id] ?? r.status,
  }))
  const count = (s: LeaveStatus) => all.filter((r) => r.status === s).length
  const awayToday = all.filter(
    (r) => r.status === 'approved' && r.from <= activeToday && r.to >= activeToday
  ).length

  async function decide(id: string, next: 'approved' | 'rejected') {
    setDecisions((prev) => ({ ...prev, [id]: next }))
    const who = nameFor(leavesData.find((r) => r.id === id)?.staffRef ?? '')
    toast(`${who}'s request ${next}.`, next === 'rejected' ? 'info' : 'success')
    try {
      await decideLeaveRequest(id, next)
    } catch (err) {
      console.error(err)
      toast('Failed to save decision in database.', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Pending"
          value={count('pending')}
          tone={STATUS.pending.tone}
          icon={<ClockIcon />}
        />
        <StatCard
          label="Approved"
          value={count('approved')}
          tone={STATUS.approved.tone}
          icon={<CheckIcon />}
        />
        <StatCard
          label="Rejected"
          value={count('rejected')}
          tone={STATUS.rejected.tone}
          icon={<SlashIcon />}
        />
        <StatCard
          label="Away today"
          value={awayToday}
          tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
          icon={<CalendarIcon />}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {rows.length} of {leaveRequests.length} requests
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LeaveStatus | 'all')}
                aria-label="Filter by request status"
                className="appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-9 pl-3 text-sm text-zinc-700 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              >
                <option value="all">All statuses</option>
                {(['pending', 'approved', 'rejected'] as LeaveStatus[]).map(
                  (s) => (
                    <option key={s} value={s}>
                      {STATUS[s].label}
                    </option>
                  )
                )}
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
              placeholder="Search requests..."
              aria-label="Search by employee, request ID, type or reason"
              className="w-52 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-5 py-3 font-medium">Employee</th>
                <th scope="col" className="px-5 py-3 font-medium">Type</th>
                <th scope="col" className="px-5 py-3 font-medium">Dates</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Days</th>
                <th scope="col" className="px-5 py-3 font-medium">Reason</th>
                <th scope="col" className="px-5 py-3 font-medium">Status</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      No matching requests
                    </p>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Nothing matches the current search and filter.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const s = STATUS[r.status]
                  const name = nameFor(r.staffRef)
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          >
                            {initials(name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                              {name}
                            </p>
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {roleFor(r.staffRef)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                        {TYPES[r.type]}
                      </td>
                      <td
                        className="px-5 py-3 text-zinc-600 dark:text-zinc-400"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {range(r.from, r.to)}
                        {halfDayNote(r) ? (
                          <span className="block text-xs text-zinc-400 dark:text-zinc-600">
                            {halfDayNote(r)}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="px-5 py-3 text-right text-zinc-600 dark:text-zinc-400"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatDays(r.days)}
                      </td>
                      <td className="max-w-56 px-5 py-3">
                        <span className="block truncate text-zinc-600 dark:text-zinc-400">
                          {r.reason}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {r.status === 'pending' ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => decide(r.id, 'approved')}
                              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => decide(r.id, 'rejected')}
                              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <p className="text-right text-xs text-zinc-400 dark:text-zinc-600">
                            {shortDate(r.submitted)}
                          </p>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

      </section>

      {adding && leaveContext ? (
        <LeaveRequestDialog
          staff={staffData}
          context={leaveContext}
          today={activeToday}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
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

function CheckIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
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

function CalendarIcon() {
  return (
    <svg {...STAT_ICON}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
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
