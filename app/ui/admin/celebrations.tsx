'use client'

import { useState } from 'react'
import { todayIso, type StaffMember } from '@/app/lib/admin-data'
import { STAT_ICON, StatCard } from '@/app/ui/admin/stat-card'
import { useToast } from '@/app/ui/toast'
import { updateStaffDates } from '@/app/actions/admin'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type Kind = 'birthday' | 'anniversary'

type Celebration = {
  person: EditablePerson
  kind: Kind
  /** ISO of the next occurrence on or after `today`. */
  date: string
  daysAway: number
  /** Years of service being marked. Anniversaries only. */
  years?: number
}

/** Whole days between two ISO dates, via UTC so DST can't shift the count. */
function daysBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  )
}

/** This year's MM-DD if it hasn't passed, otherwise next year's. */
function nextOccurrence(monthDay: string, from: string) {
  const year = Number(from.slice(0, 4))
  const thisYear = `${year}-${monthDay}`
  return thisYear >= from ? thisYear : `${year + 1}-${monthDay}`
}

function label(date: string, daysAway: number) {
  if (daysAway === 0) return 'Today'
  if (daysAway === 1) return 'Tomorrow'
  if (daysAway < 7) return `in ${daysAway} days`
  const [, m, d] = date.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

function formatDate(date: string) {
  const [, m, d] = date.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase()
}

/** A person with dates cleared shows `null` instead of an ISO string. */
export type EditablePerson = Omit<StaffMember, 'birthday' | 'joined'> & {
  birthday: string | null
  joined: string | null
}

/** Every upcoming birthday and work anniversary, soonest first. */
function buildCelebrations(people: EditablePerson[], todayStr: string): Celebration[] {
  const out: Celebration[] = []
  for (const person of people) {
    if (person.birthday) {
      const bday = nextOccurrence(person.birthday, todayStr)
      out.push({
        person,
        kind: 'birthday',
        date: bday,
        daysAway: daysBetween(todayStr, bday),
      })
    }

    if (!person.joined) continue
    const joinedMd = person.joined.slice(5)
    const anniv = nextOccurrence(joinedMd, todayStr)
    const years = Number(anniv.slice(0, 4)) - Number(person.joined.slice(0, 4))
    if (years > 0) {
      out.push({
        person,
        kind: 'anniversary',
        date: anniv,
        daysAway: daysBetween(todayStr, anniv),
        years,
      })
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway)
}

const KIND = {
  birthday: {
    label: 'Birthday',
    badge: 'bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-300',
    tone: 'bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-300',
  },
  anniversary: {
    label: 'Work anniversary',
    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
} as const

type Override = { birthday?: string | null; joined?: string | null }

export function Celebrations({
  initialStaff,
  todayDate,
}: {
  initialStaff: StaffMember[]
  todayDate?: string
}) {
  const staffData = initialStaff
  const activeToday = todayDate ?? todayIso()
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const toast = useToast()

  const people: EditablePerson[] = staffData.map((p) => {
    const o = overrides[p.ref]
    return {
      ...p,
      birthday: o && 'birthday' in o ? (o.birthday ?? null) : p.birthday,
      joined: o && 'joined' in o ? (o.joined ?? null) : p.joined,
    }
  })

  const ALL = buildCelebrations(people, activeToday)

  async function save(ref: string, next: Override) {
    setOverrides((prev) => ({ ...prev, [ref]: { ...prev[ref], ...next } }))
    setEditing(null)
    const personName = staffData.find((p) => p.ref === ref)?.name ?? ref
    toast(`Dates updated for ${personName}.`)
    try {
      const orig = staffData.find((p) => p.ref === ref)
      const bday = next.birthday !== undefined ? next.birthday : (orig?.birthday || null)
      const joined = next.joined !== undefined ? next.joined : (orig?.joined || null)
      await updateStaffDates(ref, bday, joined)
    } catch (err) {
      console.error(err)
      toast('Failed to save dates in database.', 'error')
    }
  }

  async function clearDates(ref: string) {
    setOverrides((prev) => ({ ...prev, [ref]: { birthday: null, joined: null } }))
    setEditing(null)
    const personName = staffData.find((p) => p.ref === ref)?.name ?? ref
    toast(
      `Dates cleared for ${personName}.`,
      'info'
    )
    try {
      await updateStaffDates(ref, null, null)
    } catch (err) {
      console.error(err)
      toast('Failed to clear dates in database.', 'error')
    }
  }

  const thisMonth = activeToday.slice(0, 7)

  const todays = ALL.filter((c) => c.daysAway === 0)
  // A filter over ~28 rows; the React Compiler memoises this on its own.
  const q = query.trim().toLowerCase()
  const upcoming = ALL.filter((c) => c.daysAway > 0 && c.daysAway <= 90).filter(
    (c) => {
      if (kind !== 'all' && c.kind !== kind) return false
      if (!q) return true
      return [c.person.name, c.person.role].some((f) =>
        f.toLowerCase().includes(q)
      )
    }
  )

  const inMonth = (k: Kind) =>
    ALL.filter((c) => c.kind === k && c.date.slice(0, 7) === thisMonth).length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Today"
          value={todays.length}
          tone="bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          icon={<SparkIcon />}
        />
        <StatCard
          label="Next 7 days"
          value={ALL.filter((c) => c.daysAway > 0 && c.daysAway <= 7).length}
          tone="bg-[#0ca30c]/12 text-[#006300] dark:text-[#0ca30c]"
          icon={<CalendarIcon />}
        />
        <StatCard
          label="Birthdays this month"
          value={inMonth('birthday')}
          tone={KIND.birthday.tone}
          icon={<CakeIcon />}
        />
        <StatCard
          label="Anniversaries this month"
          value={inMonth('anniversary')}
          tone={KIND.anniversary.tone}
          icon={<AwardIcon />}
        />
      </div>

      {todays.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
          <h2 className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <SparkIcon />
            Celebrating today
          </h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {todays.map((c) => (
              <li
                key={`${c.person.ref}-${c.kind}`}
                className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-4 py-3 dark:border-amber-900/50 dark:bg-zinc-950"
              >
                <Avatar name={c.person.name} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {c.person.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {c.kind === 'birthday'
                      ? 'Birthday'
                      : `${c.years} year${c.years === 1 ? '' : 's'} at Work à Rail`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Coming up
            <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
              next 90 days
            </span>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind | 'all')}
                aria-label="Filter by celebration type"
                className="appearance-none rounded-lg border border-zinc-300 bg-white py-1.5 pr-9 pl-3 text-sm text-zinc-700 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              >
                <option value="all">All types</option>
                <option value="birthday">Birthdays</option>
                <option value="anniversary">Work anniversaries</option>
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
              aria-label="Search by name or role"
              className="w-48 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600"
            />
          </div>
        </div>

        {upcoming.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Nothing coming up
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              No celebrations match the current filter in the next 90 days.
            </p>
          </div>
        ) : (
          <ul>
            {upcoming.map((c) => (
              <li
                key={`${c.person.ref}-${c.kind}`}
                className="flex items-center gap-4 border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-900"
              >
                <Avatar name={c.person.name} />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {c.person.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {c.person.role}
                  </p>
                </div>

                <span
                  className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline ${KIND[c.kind].badge}`}
                >
                  {c.kind === 'anniversary'
                    ? `${c.years} year${c.years === 1 ? '' : 's'}`
                    : KIND.birthday.label}
                </span>

                <span
                  className="w-16 shrink-0 text-right text-sm text-zinc-600 dark:text-zinc-400"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatDate(c.date)}
                </span>

                <span
                  className="w-24 shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-500"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {label(c.date, c.daysAway)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Employee dates
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Add, update or clear the dates each celebration is built from.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-5 py-3 font-medium">Employee</th>
                <th scope="col" className="px-5 py-3 font-medium">Birthday</th>
                <th scope="col" className="px-5 py-3 font-medium">Joined</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <DateRow
                  key={person.ref}
                  person={person}
                  editing={editing === person.ref}
                  onEdit={() => setEditing(person.ref)}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => save(person.ref, next)}
                  onClear={() => clearDates(person.ref)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/**
 * One employee's dates. Birthday is stored as MM-DD, so the date input is
 * seeded with a placeholder year that is stripped again on save.
 */
function DateRow({
  person,
  editing,
  onEdit,
  onCancel,
  onSave,
  onClear,
}: {
  person: EditablePerson
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (next: Override) => void
  onClear: () => void
}) {
  const hasDates = Boolean(person.birthday || person.joined)

  if (editing) {
    return (
      <tr className="border-b border-zinc-100 bg-indigo-50/40 last:border-0 dark:border-zinc-900 dark:bg-indigo-950/20">
        <td className="px-5 py-3">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {person.name}
          </span>
        </td>
        <td className="px-5 py-2" colSpan={3}>
          <form
            className="flex flex-wrap items-center justify-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const data = new FormData(e.currentTarget)
              const b = String(data.get('birthday') ?? '')
              const j = String(data.get('joined') ?? '')
              onSave({
                birthday: b ? b.slice(5) : null,
                joined: j || null,
              })
            }}
          >
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              Birthday
              <input
                type="date"
                name="birthday"
                defaultValue={person.birthday ? `2000-${person.birthday}` : ''}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              Joined
              <input
                type="date"
                name="joined"
                defaultValue={person.joined ?? ''}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
          </form>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={person.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
              {person.name}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {person.role}
            </p>
          </div>
        </div>
      </td>
      <td
        className="px-5 py-3 text-zinc-600 dark:text-zinc-400"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {person.birthday ? (
          formatDate(`2000-${person.birthday}`)
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">Not set</span>
        )}
      </td>
      <td
        className="px-5 py-3 text-zinc-600 dark:text-zinc-400"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {person.joined ? (
          `${formatDate(person.joined)} ${person.joined.slice(0, 4)}`
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">Not set</span>
        )}
      </td>
      <td className="px-5 py-3">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {hasDates ? 'Edit' : 'Add'}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!hasDates}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-[#b02c2c] transition hover:bg-[#d03b3b]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-[#e07272]"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
    >
      {initials(name)}
    </span>
  )
}

function CakeIcon() {
  return (
    <svg {...STAT_ICON}>
      <path d="M4.5 20.5h15" />
      <path d="M6 20.5v-7h12v7" />
      <path d="M6 16.5c1.2 0 1.2 1 2.4 1s1.2-1 2.4-1 1.2 1 2.4 1 1.2-1 2.4-1" />
      <path d="M12 13.5v-3" />
      <circle cx="12" cy="8.8" r="1.2" />
    </svg>
  )
}

function AwardIcon() {
  return (
    <svg {...STAT_ICON}>
      <circle cx="12" cy="9.5" r="5.5" />
      <path d="m9 14.5-1.5 6L12 18l4.5 2.5-1.5-6" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg {...STAT_ICON}>
      <path d="M12 4.5 13.7 9l4.5 1.7-4.5 1.7L12 17l-1.7-4.6L5.8 10.7 10.3 9z" />
      <path d="M18.5 4v3M20 5.5h-3" />
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
