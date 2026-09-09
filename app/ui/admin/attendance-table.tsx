'use client'

import { useMemo, useState } from 'react'
import { STAT_ICON, StatCard } from '@/app/ui/admin/stat-card'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { AttendanceEntryDialog } from '@/app/ui/admin/attendance-entry-dialog'
import {
  attendanceHours,
  type AttendanceCode,
  type StaffMember,
} from '@/app/lib/admin-data'

const CODES: Record<
  AttendanceCode,
  { label: string; cell: string; dot: string; tile: string }
> = {
  P: {
    label: 'Present',
    cell: 'bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]',
    dot: '#0ca30c',
    tile: 'bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]',
  },
  H: {
    label: 'Half day',
    cell: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    dot: '#fab219',
    tile: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  },
  L: {
    label: 'Leave',
    cell: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    dot: '#898781',
    tile: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
  A: {
    label: 'Absent',
    cell: 'bg-[#d03b3b]/12 text-[#b02c2c] dark:text-[#e07272]',
    dot: '#d03b3b',
    tile: 'bg-[#d03b3b]/12 text-[#b02c2c] dark:text-[#e07272]',
  },
  '-': {
    label: 'Non-working',
    cell: 'bg-transparent text-zinc-300 dark:text-zinc-700',
    dot: '#d4d4d8',
    tile: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500',
  },
}

const ORDER: AttendanceCode[] = ['P', 'H', 'L', 'A']

/** '2026-08-24' -> { dow: 'Mon', day: '24' }. String maths, no timezone drift. */
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function dayLabel(iso: string, index: number) {
  return { dow: DOW[index], day: iso.split('-')[2] }
}

export function AttendanceTable({
  initialStaff,
  initialPatterns,
  week,
  todayDate,
}: {
  initialStaff: StaffMember[]
  initialPatterns: Record<string, string>
  week: string[]
  todayDate: string
}) {
  const staffData = initialStaff
  const patterns = initialPatterns
  const activeWeek = week
  const activeToday = todayDate

  const [adding, setAdding] = useState(false)
  useRegisterPageAction('Add entry', () => setAdding(true))

  const getAttendanceFor = (ref: string) => {
    const pattern = patterns[ref] ?? '-------'
    return pattern.split('') as AttendanceCode[]
  }

  const getWeekHours = (ref: string) => {
    return getAttendanceFor(ref).reduce((n, c) => n + attendanceHours[c], 0)
  }

  const [query, setQuery] = useState('')
  const [code, setCode] = useState<AttendanceCode | 'all'>('all')

  const todayIndex = activeWeek.indexOf(activeToday)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return staffData
      .map((person) => ({ person, days: getAttendanceFor(person.ref) }))
      .filter(({ person, days }) => {
        if (code !== 'all' && !days.includes(code)) return false
        if (!q) return true
        return [person.name, person.ref, person.role].some((f) =>
          f.toLowerCase().includes(q)
        )
      })
  }, [staffData, query, code])

  // Counts for the day everyone is actually looking at.
  const todayCounts = useMemo(() => {
    const counts: Partial<Record<AttendanceCode, number>> = {}
    if (todayIndex < 0) return counts
    for (const person of staffData) {
      const c = getAttendanceFor(person.ref)[todayIndex]
      counts[c] = (counts[c] ?? 0) + 1
    }
    return counts
  }, [staffData, todayIndex])

  const totalHours = rows.reduce((n, r) => n + getWeekHours(r.person.ref), 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Present today"
          value={todayCounts.P ?? 0}
          tone={CODES.P.tile}
          icon={<CheckIcon />}
        />
        <StatCard
          label="Half day"
          value={todayCounts.H ?? 0}
          tone={CODES.H.tile}
          icon={<HalfDayIcon />}
        />
        <StatCard
          label="On leave"
          value={todayCounts.L ?? 0}
          tone={CODES.L.tile}
          icon={<PalmIcon />}
        />
        <StatCard
          label="Absent today"
          value={todayCounts.A ?? 0}
          tone={CODES.A.tile}
          icon={<SlashIcon />}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {formatRange(activeWeek)}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              · {rows.length} of {staffData.length} people
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={code}
                onChange={(e) =>
                  setCode(e.target.value as AttendanceCode | 'all')
                }
                aria-label="Filter by attendance code"
                className="appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-9 pl-3 text-sm text-zinc-700 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              >
                <option value="all">All codes</option>
                {ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CODES[c].label}
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
              placeholder="Search people..."
              aria-label="Search people by name, ID or role"
              className="w-48 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600"
            />

          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-5 py-3 font-medium">
                  Employee
                </th>
                {activeWeek.map((iso, i) => {
                  const { dow, day } = dayLabel(iso, i)
                  const isToday = iso === activeToday
                  return (
                    <th
                      key={iso}
                      scope="col"
                      aria-current={isToday ? 'date' : undefined}
                      className={`px-2 py-3 text-center font-medium ${
                        isToday
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : i > 4
                            ? 'text-zinc-400 dark:text-zinc-600'
                            : ''
                      }`}
                    >
                      <span className="block text-xs">{dow}</span>
                      <span
                        className="block"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {day}
                      </span>
                    </th>
                  )
                })}
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeWeek.length + 2}
                    className="px-5 py-16 text-center"
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      No matching people
                    </p>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Nothing matches the current search and filter.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map(({ person, days }) => (
                  <tr
                    key={person.ref}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal"
                    >
                      <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                        {person.name}
                      </span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {person.role}
                      </span>
                    </th>

                    {days.map((c, i) => (
                      <td key={activeWeek[i]} className="px-2 py-2.5">
                        <span
                          title={`${CODES[c].label} · ${attendanceHours[c]}h`}
                          className={`mx-auto flex size-8 items-center justify-center rounded-md text-xs font-semibold ${CODES[c].cell}`}
                        >
                          <span aria-hidden="true">{c === '-' ? '·' : c}</span>
                          <span className="sr-only">{CODES[c].label}</span>
                        </span>
                      </td>
                    ))}

                    <td
                      className="px-5 py-2.5 text-right font-medium text-zinc-900 dark:text-zinc-100"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {getWeekHours(person.ref)}h
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {ORDER.map((c) => (
              <li
                key={c}
                className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-4 items-center justify-center rounded text-[10px] font-semibold ${CODES[c].cell}`}
                >
                  {c}
                </span>
                {CODES[c].label}
              </li>
            ))}
          </ul>
          <p
            aria-live="polite"
            className="text-xs text-zinc-500 dark:text-zinc-400"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {totalHours}h total
          </p>
        </div>

      </section>

      {adding ? (
        <AttendanceEntryDialog
          staff={staffData}
          week={activeWeek}
          patterns={patterns}
          today={activeToday}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  )
}

function formatRange(week: string[]) {
  const [y, m, d] = week[0].split('-')
  const [, m2, d2] = week[6].split('-')
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const from = `${Number(d)} ${MON[Number(m) - 1]}`
  const to = `${Number(d2)} ${MON[Number(m2) - 1]} ${y}`
  return `${from} – ${to}`
}

/* --- tile icons --- */

function CheckIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  )
}

function HalfDayIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PalmIcon() {
  return (
    <svg {...STAT_ICON}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="M9.5 14.5h5" />
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

function ChevronDownIcon() {
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
