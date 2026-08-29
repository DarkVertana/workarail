'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import { saveAttendanceEntries } from '@/app/actions/admin'
import { useToast } from '@/app/ui/toast'
import {
  attendanceHours,
  type AttendanceCode,
  type StaffMember,
} from '@/app/lib/admin-data'

type Mode = 'day' | 'range'

const CODE_OPTIONS: Array<{
  code: AttendanceCode
  label: string
  hint: string
  swatch: string
}> = [
  { code: 'P', label: 'Present', hint: 'Full shift worked', swatch: 'bg-[#0ca30c]/12 text-[#006300]' },
  { code: 'H', label: 'Half day', hint: 'Half a shift worked', swatch: 'bg-amber-100 text-amber-800' },
  { code: 'L', label: 'Leave', hint: 'Approved absence', swatch: 'bg-zinc-200 text-zinc-700' },
  { code: 'A', label: 'Absent', hint: 'Unplanned, unpaid', swatch: 'bg-[#d03b3b]/12 text-[#b02c2c]' },
  { code: '-', label: 'Non-working', hint: 'Not rostered', swatch: 'bg-zinc-100 text-zinc-500' },
]

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-08-24' -> '24 Aug 2026'. String maths, so no timezone drift. */
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]} ${y}`
}

function isWeekend(iso: string) {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay()
  return day === 0 || day === 6
}

/** Every ISO day from `from` to `to` inclusive. */
function dayRange(from: string, to: string) {
  if (!from || !to || to < from) return []
  const days: string[] = []
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  for (
    let t = new Date(`${from}T00:00:00.000Z`).getTime();
    t <= end;
    t += 86_400_000
  ) {
    days.push(new Date(t).toISOString().slice(0, 10))
    if (days.length > 400) break // the server rejects anything this large anyway
  }
  return days
}

export function AttendanceEntryDialog({
  staff,
  week,
  patterns,
  today,
  onClose,
}: {
  staff: StaffMember[]
  week: string[]
  /** Seven codes per employee for the week on screen, used to warn on overwrite. */
  patterns: Record<string, string>
  today: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const titleId = useId()

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('day')
  const [day, setDay] = useState(today)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [code, setCode] = useState<AttendanceCode>('P')
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [overwrite, setOverwrite] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  // Escape closes, and the page behind must not scroll while this is open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstFieldRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  const byCrew = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = staff.filter((p) =>
      q === ''
        ? true
        : [p.name, p.ref, p.role, p.crew].some((f) =>
            (f ?? '').toLowerCase().includes(q)
          )
    )
    const groups = new Map<string, StaffMember[]>()
    for (const person of matches) {
      const crew = person.crew || 'Unassigned'
      groups.set(crew, [...(groups.get(crew) ?? []), person])
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [staff, query])

  const visibleRefs = useMemo(
    () => byCrew.flatMap(([, people]) => people.map((p) => p.ref)),
    [byCrew]
  )

  // A single day is always taken at face value — picking Saturday means Saturday.
  // The weekend filter only makes sense when sweeping a range.
  const weekendsOn = mode === 'day' || includeWeekends

  const days = useMemo(() => {
    if (mode === 'day') return day ? [day] : []
    const all = dayRange(from, to)
    return includeWeekends ? all : all.filter((d) => !isWeekend(d))
  }, [mode, day, from, to, includeWeekends])

  const skippedWeekends = useMemo(() => {
    if (mode === 'day' || includeWeekends) return 0
    return dayRange(from, to).filter(isWeekend).length
  }, [includeWeekends, mode, from, to])

  // Days already on the sheet, for the week currently displayed behind us.
  const conflicts = useMemo(() => {
    let n = 0
    for (const ref of selected) {
      const pattern = patterns[ref] ?? ''
      for (const iso of days) {
        const index = week.indexOf(iso)
        if (index >= 0 && pattern[index] && pattern[index] !== '-') n += 1
      }
    }
    return n
  }, [selected, days, patterns, week])

  const entries = selected.size * days.length
  const hours = entries * attendanceHours[code]

  function toggle(ref: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  function setMany(refs: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const ref of refs) {
        if (on) next.add(ref)
        else next.delete(ref)
      }
      return next
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (selected.size === 0) {
      setError('Select at least one employee.')
      return
    }
    if (days.length === 0) {
      setError(
        skippedWeekends > 0
          ? 'That range only covers a weekend. Tick “include Saturdays and Sundays” to record it.'
          : 'Choose a date.'
      )
      return
    }

    startTransition(async () => {
      const result = await saveAttendanceEntries({
        staffRefs: Array.from(selected),
        from: mode === 'day' ? day : from,
        to: mode === 'day' ? day : to,
        code,
        includeWeekends: weekendsOn,
        overwrite,
      })

      if ('error' in result && result.error) {
        setError(result.error)
        return
      }

      const parts = [
        result.created ? `${result.created} added` : null,
        result.updated ? `${result.updated} updated` : null,
        result.skipped ? `${result.skipped} left alone` : null,
      ].filter(Boolean)
      toast(`Attendance saved — ${parts.join(', ')}.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        // Backdrop only — a drag that ends outside the panel shouldn't close it.
        if (!dialogRef.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Record attendance
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Mark a day or a run of days for one person or a whole crew. Saved
              entries feed the weekly hours and payroll.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <CloseIcon />
          </button>
        </header>

        <form
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
            <Fieldset
              legend="Who"
              hint={
                selected.size === 0
                  ? 'Nobody selected yet.'
                  : `${selected.size} of ${staff.length} selected.`
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={firstFieldRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, ID, role or crew..."
                  aria-label="Search employees"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
                <button
                  type="button"
                  onClick={() => setMany(visibleRefs, true)}
                  className={quietButton}
                >
                  Select {query.trim() ? 'matches' : 'all'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className={quietButton}
                >
                  Clear
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                {byCrew.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-zinc-500">
                    No one matches “{query}”.
                  </p>
                ) : (
                  byCrew.map(([crew, people]) => {
                    const refs = people.map((p) => p.ref)
                    const allOn = refs.every((r) => selected.has(r))
                    return (
                      <div key={crew}>
                        <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50/95 px-3 py-1.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
                          <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                            {crew}
                          </span>
                          <button
                            type="button"
                            onClick={() => setMany(refs, !allOn)}
                            className="rounded text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {allOn ? 'Deselect crew' : 'Select crew'}
                          </button>
                        </div>
                        {people.map((person) => (
                          <label
                            key={person.ref}
                            className="flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-3 py-2 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(person.ref)}
                              onChange={() => toggle(person.ref)}
                              className="size-4 rounded-sm border-zinc-300 accent-indigo-600 dark:border-zinc-600"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {person.name}
                              </span>
                              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                                {person.ref} · {person.role}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )
                  })
                )}
              </div>
            </Fieldset>

            <Fieldset
              legend="When"
              hint={
                days.length === 0
                  ? 'No days selected.'
                  : days.length === 1
                    ? formatDate(days[0])
                    : `${days.length} days, ${formatDate(days[0])} to ${formatDate(days[days.length - 1])}`
              }
            >
              <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
                {(['day', 'range'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                      mode === m
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {m === 'day' ? 'Single day' : 'Date range'}
                  </button>
                ))}
              </div>

              {mode === 'day' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labelled label="Date">
                    <input
                      type="date"
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                      className={dateControl}
                    />
                  </Labelled>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setDay(today)}
                      disabled={day === today}
                      className={quietButton}
                    >
                      Today
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labelled label="From">
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => {
                        setFrom(e.target.value)
                        if (to < e.target.value) setTo(e.target.value)
                      }}
                      className={dateControl}
                    />
                  </Labelled>
                  <Labelled label="To">
                    <input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                      className={dateControl}
                    />
                  </Labelled>
                </div>
              )}

              {mode === 'range' ? (
                <Switch
                  checked={includeWeekends}
                  onChange={setIncludeWeekends}
                  label="Include Saturdays and Sundays"
                  hint={
                    skippedWeekends > 0
                      ? `${skippedWeekends} weekend day${skippedWeekends === 1 ? '' : 's'} in this range will be skipped.`
                      : 'For weekend possessions and engineering works.'
                  }
                />
              ) : isWeekend(day) ? (
                <p className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                  {formatDate(day)} is a weekend — recorded as picked.
                </p>
              ) : null}
            </Fieldset>

            <Fieldset legend="Status" hint={`${attendanceHours[code]}h per day`}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CODE_OPTIONS.map((option) => {
                  const active = code === option.code
                  return (
                    <label
                      key={option.code}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                        active
                          ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/30 dark:bg-indigo-950/30'
                          : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="code"
                        value={option.code}
                        checked={active}
                        onChange={() => setCode(option.code)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${option.swatch}`}
                      >
                        {option.code === '-' ? '·' : option.code}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {option.label}
                        </span>
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {option.hint} · {attendanceHours[option.code]}h
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>

              <Switch
                checked={overwrite}
                onChange={setOverwrite}
                label="Overwrite days that already have an entry"
                hint={
                  conflicts > 0
                    ? `${conflicts} of the selected days already have an entry this week.`
                    : 'Leave off to fill in gaps without touching existing entries.'
                }
                tone={conflicts > 0 && overwrite ? 'warn' : 'default'}
              />
            </Fieldset>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50/70 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p
              aria-live="polite"
              className="text-sm text-zinc-600 dark:text-zinc-400"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {error ? (
                <span className="font-medium text-[#b02c2c] dark:text-[#e07272]">
                  {error}
                </span>
              ) : entries === 0 ? (
                'Pick people and a date to continue.'
              ) : (
                <>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {entries} {entries === 1 ? 'entry' : 'entries'}
                  </span>{' '}
                  · {selected.size} {selected.size === 1 ? 'person' : 'people'} ×{' '}
                  {days.length} {days.length === 1 ? 'day' : 'days'} · {hours}h
                </>
              )}
            </p>

            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className={quietButton}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || entries === 0}
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Save attendance'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}

const quietButton =
  'shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'

const dateControl =
  'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50'

function Fieldset({
  legend,
  hint,
  children,
}: {
  legend: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {legend}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      </legend>
      {children}
    </fieldset>
  )
}

function Labelled({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
    </label>
  )
}

function Switch({
  checked,
  onChange,
  label,
  hint,
  tone = 'default',
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
  tone?: 'default' | 'warn'
}) {
  const id = useId()
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5 ${
        tone === 'warn'
          ? 'border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20'
          : 'border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40'
      }`}
    >
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </span>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded-sm border-zinc-300 accent-indigo-600 dark:border-zinc-600"
      />
    </div>
  )
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className="size-4"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}
