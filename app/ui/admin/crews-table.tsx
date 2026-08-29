'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  todayIso,
  type StaffMember,
  type StaffStatus,
} from '@/app/lib/admin-data'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { getCrews, addCrew, addStaffMember } from '@/app/actions/admin'

const PAGE_SIZE = 10

/** First and last initial — the avatar stands in for a photo. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** '2023-03-12' -> '12/03/2023'. String maths only, so no Date/timezone drift. */
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Whole days between two ISO dates, via UTC to sidestep DST. */
function daysBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  )
}

// Dot + label, never colour alone.
const STATUS: Record<StaffStatus, { label: string; dot: string; badge: string }> =
  {
    'on-site': {
      label: 'On site',
      dot: '#0ca30c',
      badge: 'bg-[#0ca30c]/10 text-[#006300] dark:text-[#0ca30c]',
    },
    available: {
      label: 'Available',
      dot: '#898781',
      badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    },
    'off-shift': {
      label: 'Off shift',
      dot: '#d4d4d8',
      badge: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400',
    },
  }

const STATUS_ORDER: StaffStatus[] = ['on-site', 'available', 'off-shift']

const DATE_RANGES = [
  { value: 'all', label: 'All time', days: null },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
] as const
type DateRange = (typeof DATE_RANGES)[number]['value']

const COLUMNS = [
  { key: 'ref', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'phone', label: 'Phone' },
  { key: 'status', label: 'Status' },
  { key: 'joined', label: 'Joined' },
] as const
type ColumnKey = (typeof COLUMNS)[number]['key']

const pagerButtonClass =
  'rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'

export function CrewsTable({
  initialStaff,
  todayDate,
}: {
  initialStaff: StaffMember[]
  todayDate?: string
}) {
  const activeToday = todayDate ?? todayIso()
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StaffStatus | 'all'>('all')
  const [range, setRange] = useState<DateRange>('all')
  const router = useRouter()
  const [hidden, setHidden] = useState<ReadonlySet<ColumnKey>>(new Set())
  const [openRow, setOpenRow] = useState<string | null>(null)

  const [crews, setCrews] = useState<Array<{ id: string; name: string }>>([])
  const [addingStaff, setAddingStaff] = useState(false)
  const [addingCrew, setAddingCrew] = useState(false)

  useEffect(() => {
    if (addingStaff) {
      getCrews().then(setCrews)
    }
  }, [addingStaff])

  // Onboarding moved to its own route. The modal it replaced collected nine
  // fields and discarded the rest, and lost everything typed into it on a
  // reload — neither is acceptable for a form that also captures payroll,
  // bank and right-to-work data.
  useRegisterPageAction('Add staff member', () => router.push('/admin/crews/new'))

  const visible = COLUMNS.filter((c) => !hidden.has(c.key))

  const staffData = initialStaff

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const days = DATE_RANGES.find((r) => r.value === range)?.days ?? null
    return staffData.filter((p) => {
      if (status !== 'all' && p.status !== status) return false
      if (days !== null && daysBetween(p.joined, activeToday) > days) return false
      if (!q) return true
      return [p.name, p.email, p.ref, p.role, p.phone].some((field) =>
        field.toLowerCase().includes(q)
      )
    })
  }, [staffData, query, status, range, activeToday])

  const isFiltered = query.trim() !== '' || status !== 'all' || range !== 'all'

  function clearFilters() {
    setQuery('')
    setStatus('all')
    setRange('all')
    setPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // A narrowed filter can leave `page` past the end — clamp rather than
  // stranding the user on an empty page.
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE_SIZE
  const rows = filtered.slice(start, start + PAGE_SIZE)

  const statusLabel =
    status === 'all' ? 'All' : STATUS[status as StaffStatus].label
  const rangeLabel = DATE_RANGES.find((r) => r.value === range)!.label

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <Pill icon={<ColumnsIcon />} label="Columns">
            <div className="flex flex-col gap-0.5 p-1">
              {COLUMNS.map((col) => {
                const shown = !hidden.has(col.key)
                // Never let the last column be hidden — an empty table is a dead end.
                const locked = shown && visible.length === 1
                return (
                  <label
                    key={col.key}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                      locked
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={shown}
                      disabled={locked}
                      onChange={() =>
                        setHidden((prev) => {
                          const next = new Set(prev)
                          if (next.has(col.key)) next.delete(col.key)
                          else next.add(col.key)
                          return next
                        })
                      }
                      className="size-3.5 rounded-sm border-zinc-300 accent-indigo-600 dark:border-zinc-600"
                    />
                    {col.label}
                  </label>
                )
              })}
            </div>
          </Pill>

          <Pill icon={<StatusIcon />} label={`Status: ${statusLabel}`}>
            <div className="flex flex-col gap-0.5 p-1">
              <MenuOption
                selected={status === 'all'}
                onSelect={() => {
                  setStatus('all')
                  setPage(0)
                }}
              >
                All
              </MenuOption>
              {STATUS_ORDER.map((key) => (
                <MenuOption
                  key={key}
                  selected={status === key}
                  onSelect={() => {
                    setStatus(key)
                    setPage(0)
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: STATUS[key].dot }}
                  />
                  {STATUS[key].label}
                </MenuOption>
              ))}
            </div>
          </Pill>

          <Pill icon={<CalendarIcon />} label={rangeLabel}>
            <div className="flex flex-col gap-0.5 p-1">
              {DATE_RANGES.map((r) => (
                <MenuOption
                  key={r.value}
                  selected={range === r.value}
                  onSelect={() => {
                    setRange(r.value)
                    setPage(0)
                  }}
                >
                  {r.label}
                </MenuOption>
              ))}
            </div>
          </Pill>

          {isFiltered ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md px-2 py-1 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              Clear
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setAddingCrew(true)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <PlusIcon />
            Add Crew
          </button>
        </div>

        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400 dark:text-zinc-500"
          >
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0) // a new query invalidates whatever page we were on
            }}
            placeholder="Search..."
            aria-label="Search staff by name, email, ID, role or phone"
            className="w-56 rounded-lg border border-zinc-300 bg-white py-1.5 pr-3 pl-9 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              {visible.map((col) => (
                <th key={col.key} scope="col" className="px-5 py-3 font-medium">
                  {col.label}
                </th>
              ))}
              <th scope="col" className="w-12 px-5 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={visible.length + 1}
                  className="px-5 py-16 text-center"
                >
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {isFiltered ? 'No matching staff' : 'No staff members yet'}
                  </p>
                  {isFiltered ? (
                    <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                      Nothing matches the current search and filters.{' '}
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="rounded-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
                      >
                        Clear filters
                      </button>
                    </p>
                  ) : (
                    <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                      Add your people to{' '}
                      <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        staff
                      </code>{' '}
                      in{' '}
                      <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        app/lib/admin-data.ts
                      </code>
                      .
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((person) => (
                <tr
                  key={person.ref}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  {visible.map((col) => (
                    <Cell key={col.key} column={col.key} person={person} />
                  ))}
                  <td className="px-5 py-3">
                    <RowActions
                      person={person}
                      open={openRow === person.ref}
                      onToggle={() =>
                        setOpenRow((r) => (r === person.ref ? null : person.ref))
                      }
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <p
          aria-live="polite"
          className="text-xs text-zinc-500 dark:text-zinc-400"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {filtered.length === 0
            ? 'No results'
            : `Showing ${start + 1}–${start + rows.length} of ${filtered.length}`}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className={pagerButtonClass}
          >
            Previous
          </button>
          <span
            aria-live="polite"
            className="text-xs text-zinc-500 dark:text-zinc-400"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
            className={pagerButtonClass}
          >
            Next
          </button>
        </div>
      </div>

      {addingCrew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add Crew</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const form = e.currentTarget
                const formData = new FormData(form)
                const name = formData.get('name') as string
                if (!name) return
                try {
                  await addCrew(name)
                  setAddingCrew(false)
                } catch (err) {
                  alert(String(err))
                }
              }}
              className="mt-4 flex flex-col gap-4"
            >
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Crew Name
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Track Team A"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setAddingCrew(false)}
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

      {addingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="my-8 w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add Staff Member</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const form = e.currentTarget
                const formData = new FormData(form)
                const ref = formData.get('ref') as string
                const name = formData.get('name') as string
                const email = formData.get('email') as string
                const phone = formData.get('phone') as string
                const role = formData.get('role') as string
                const crewId = formData.get('crewId') as string
                const status = formData.get('status') as string
                const joined = formData.get('joined') as string
                const birthday = formData.get('birthday') as string

                try {
                  await addStaffMember({
                    ref,
                    name,
                    email,
                    phone,
                    role,
                    crewId,
                    status,
                    joined,
                    birthday,
                  })
                  setAddingStaff(false)
                } catch (err) {
                  alert(String(err))
                }
              }}
              className="mt-4 flex flex-col gap-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    name="ref"
                    required
                    placeholder="e.g. EMP-015"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Full Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="e.g. Jane Doe"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Email Address
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="e.g. jane@workarail.com"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    required
                    placeholder="e.g. +44 7700 900077"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Role
                  </label>
                  <input
                    type="text"
                    name="role"
                    required
                    placeholder="e.g. Track Technician"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Crew Assignment
                  </label>
                  <select
                    name="crewId"
                    required
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                  >
                    <option value="">Select a crew...</option>
                    {crews.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Status
                  </label>
                  <select
                    name="status"
                    required
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                  >
                    <option value="available">Available</option>
                    <option value="on-site">On site</option>
                    <option value="off-shift">Off shift</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Date Joined
                  </label>
                  <input
                    type="date"
                    name="joined"
                    required
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Birthday (MM-DD)
                  </label>
                  <input
                    type="text"
                    name="birthday"
                    required
                    placeholder="e.g. 10-24"
                    pattern="^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"
                    title="Please use MM-DD format"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setAddingStaff(false)}
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
  )
}

/**
 * Filter pill. Built on <details> so open/close, Escape and outside-click
 * dismissal come from the platform rather than hand-rolled listeners.
 */
function Pill({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">
        <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
        {label}
        <span className="text-zinc-400 transition-transform group-open:rotate-180 dark:text-zinc-500">
          <ChevronDownIcon />
        </span>
      </summary>
      <div className="absolute top-full left-0 z-20 mt-1 min-w-44 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {children}
      </div>
    </details>
  )
}

function MenuOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
        selected
          ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  )
}

function Cell({ column, person }: { column: ColumnKey; person: StaffMember }) {
  const tabular = { fontVariantNumeric: 'tabular-nums' as const }

  switch (column) {
    case 'ref':
      return (
        <td
          className="px-5 py-3 text-zinc-500 dark:text-zinc-400"
          style={tabular}
        >
          {person.ref}
        </td>
      )
    case 'name':
      return (
        <td className="px-5 py-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              {initials(person.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                {person.name}
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {person.email}
              </p>
            </div>
          </div>
        </td>
      )
    case 'role':
      return (
        <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
          {person.role}
        </td>
      )
    case 'phone':
      return (
        <td
          className="px-5 py-3 text-zinc-600 dark:text-zinc-400"
          style={tabular}
        >
          {person.phone}
        </td>
      )
    case 'status': {
      const s = STATUS[person.status]
      return (
        <td className="px-5 py-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
          >
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: s.dot }}
            />
            {s.label}
          </span>
        </td>
      )
    }
    case 'joined':
      return (
        <td
          className="px-5 py-3 text-zinc-600 dark:text-zinc-400"
          style={tabular}
        >
          {formatDate(person.joined)}
        </td>
      )
  }
}

function RowActions({
  person,
  open,
  onToggle,
}: {
  person: StaffMember
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Actions for ${person.name}`}
        className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <DotsIcon />
      </button>
      {open ? (
        // TODO: none of these are wired — add Server Actions behind them.
        <div className="absolute top-full right-0 z-20 mt-1 flex min-w-36 flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {['View profile', 'Edit', 'Assign to job'].map((label) => (
            <button
              key={label}
              type="button"
              className="rounded-md px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* --- icons --- */

const ICON = {
  'aria-hidden': 'true',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'size-4',
} as const

function ColumnsIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M10 4.5v15" />
    </svg>
  )
}

function StatusIcon() {
  return (
    <svg {...ICON} strokeDasharray="3 2.5">
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg {...ICON} className="size-3.5">
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg {...ICON} className="size-4.5">
      <circle cx="12" cy="5.5" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg {...ICON}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
