'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { createLeaveRequest } from '@/app/actions/admin'
import { useToast } from '@/app/ui/toast'
import type { LeaveType, StaffMember } from '@/app/lib/admin-data'
import {
  LEAVE_POLICY,
  LEAVE_TYPES,
  computeLeave,
  formatDays,
  formatLeaveDate,
  workingPatternFrom,
  type EndAt,
  type StartAt,
} from '@/app/lib/leave'

export type LeaveContext = {
  holidays: Record<string, string>
  workingDaysSetting: string
  entitlement: number
  leaveDays: number
  carryOver: number
  balances: Record<string, { taken: number; pending: number }>
  booked: Array<{
    id: string
    staffRef: string
    type: string
    status: string
    from: string
    to: string
  }>
}

const STEPS = [
  { title: 'Employee', blurb: 'Who is the request for?' },
  { title: 'Leave type', blurb: 'What kind of absence is it?' },
  { title: 'Dates', blurb: 'When are they away?' },
  { title: 'Review', blurb: 'Check the deduction and submit.' },
] as const

export function LeaveRequestDialog({
  staff,
  context,
  today,
  onClose,
}: {
  staff: StaffMember[]
  context: LeaveContext
  today: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const titleId = useId()

  const [step, setStep] = useState(0)
  const [staffRef, setStaffRef] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<LeaveType>('annual')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [startAt, setStartAt] = useState<StartAt>('morning')
  const [endAt, setEndAt] = useState<EndAt>('end_of_day')
  const [reason, setReason] = useState('')
  const [approveNow, setApproveNow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  /** Each step is its own screen: start it at the top, without a stale error. */
  function goTo(index: number) {
    setStep(index)
    setError(null)
    bodyRef.current?.scrollTo({ top: 0 })
  }

  const policy = LEAVE_POLICY[type]
  const person = staff.find((p) => p.ref === staffRef)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staff
    return staff.filter((p) =>
      [p.name, p.ref, p.role].some((f) => (f ?? '').toLowerCase().includes(q))
    )
  }, [staff, query])

  const breakdown = useMemo(
    () =>
      computeLeave({
        from,
        to,
        startAt,
        endAt,
        pattern: workingPatternFrom(context.workingDaysSetting),
        holidays: context.holidays,
        allowHalfDays: policy.halfDays,
      }),
    [from, to, startAt, endAt, context, policy.halfDays]
  )

  const balance = context.balances[staffRef] ?? { taken: 0, pending: 0 }
  const remaining = context.entitlement - balance.taken - balance.pending
  const remainingAfter = policy.deducts ? remaining - breakdown.days : remaining
  const overAllowance = policy.deducts && breakdown.days > remaining

  /** This employee already has leave across these dates — a hard stop. */
  const ownClash = useMemo(() => {
    if (!staffRef || !from || !to) return null
    return (
      context.booked.find(
        (b) => b.staffRef === staffRef && b.from <= to && b.to >= from
      ) ?? null
    )
  }, [context.booked, staffRef, from, to])

  /** Crewmates already off across these dates — worth knowing, not a blocker. */
  const crewAway = useMemo(() => {
    if (!person || !from || !to) return []
    const crewRefs = new Set(
      staff.filter((p) => p.crew === person.crew).map((p) => p.ref)
    )
    return context.booked
      .filter(
        (b) =>
          b.staffRef !== staffRef &&
          crewRefs.has(b.staffRef) &&
          b.from <= to &&
          b.to >= from
      )
      .map((b) => staff.find((p) => p.ref === b.staffRef)?.name ?? b.staffRef)
  }, [context.booked, person, staff, staffRef, from, to])

  const crewSize = person
    ? staff.filter((p) => p.crew === person.crew).length
    : 0

  const datesProblem =
    breakdown.error ??
    (ownClash
      ? `Clashes with ${ownClash.id}, ${ownClash.status} ${ownClash.type} leave from ${formatLeaveDate(ownClash.from)} to ${formatLeaveDate(ownClash.to)}.`
      : overAllowance
        ? `${person?.name} has ${formatDays(remaining)} days left but this needs ${formatDays(breakdown.days)}.`
        : null)

  /** Why the user cannot leave the step they are on, or null when they can. */
  function blockerFor(index: number) {
    if (index === 0) return staffRef ? null : 'Select an employee to continue.'
    if (index === 2) return datesProblem
    return null
  }

  const blocker = blockerFor(step)
  const isLast = step === STEPS.length - 1
  const reachable = (index: number) => {
    for (let i = 0; i < index; i += 1) if (blockerFor(i)) return false
    return true
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // Enter on an earlier step means "next", not "submit".
    if (!isLast) {
      const problem = blockerFor(step)
      if (problem) {
        setError(problem)
        return
      }
      goTo(step + 1)
      return
    }

    const problem = blockerFor(0) ?? blockerFor(2)
    if (problem) {
      setError(problem)
      return
    }

    startTransition(async () => {
      const result = await createLeaveRequest({
        staffRef,
        type,
        from,
        to,
        startAt,
        endAt,
        reason,
        approveNow,
      })

      if (!('ok' in result)) {
        setError(result.error ?? 'Could not save the request.')
        return
      }

      toast(
        result.approved
          ? `${formatDays(result.days)} days approved for ${result.name}.`
          : `${formatDays(result.days)} days submitted for ${result.name} — awaiting approval.`
      )
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (!dialogRef.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
              >
                New leave request
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                Step {step + 1} of {STEPS.length} · {STEPS[step].blurb}
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
          </div>

          <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
            {STEPS.map((s, index) => {
              const done = index < step
              const current = index === step
              const canGo = index < step || reachable(index)
              return (
                <li key={s.title} className="flex items-center gap-2">
                  {index > 0 ? (
                    <span
                      aria-hidden="true"
                      className="h-px w-4 bg-zinc-300 dark:bg-zinc-700"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => canGo && goTo(index)}
                    disabled={!canGo}
                    aria-current={current ? 'step' : undefined}
                    className={`flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-xs font-medium transition ${
                      current
                        ? 'bg-indigo-600 text-white'
                        : done
                          ? 'text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40'
                          : 'text-zinc-400 dark:text-zinc-600'
                    } ${canGo ? '' : 'cursor-not-allowed'}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                        current
                          ? 'bg-white/20 text-white'
                          : done
                            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                            : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600'
                      }`}
                    >
                      {done ? <TickIcon /> : index + 1}
                    </span>
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
        </header>

        <form
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div
            ref={bodyRef}
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
          >
            {step === 0 ? (
              <>
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, ID or role..."
                  aria-label="Search employees"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />

                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                  {matches.length === 0 ? (
                    <p className="px-3 py-10 text-center text-sm text-zinc-500">
                      No one matches “{query}”.
                    </p>
                  ) : (
                    matches.map((p) => (
                      <label
                        key={p.ref}
                        className="flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-3 py-2 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60"
                      >
                        <input
                          type="radio"
                          name="staffRef"
                          checked={staffRef === p.ref}
                          onChange={() => setStaffRef(p.ref)}
                          className="size-4 accent-indigo-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {p.name}
                          </span>
                          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {p.ref} · {p.role}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>

                {person ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Balance
                      label="Entitlement"
                      value={context.entitlement}
                      hint={`${context.leaveDays} + ${context.carryOver} carried`}
                    />
                    <Balance label="Taken" value={balance.taken} />
                    <Balance label="Pending" value={balance.pending} />
                    <Balance
                      label="Remaining"
                      value={remaining}
                      tone={remaining <= 0 ? 'bad' : 'good'}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {step === 1 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {LEAVE_TYPES.map((t) => {
                  const p = LEAVE_POLICY[t]
                  const active = type === t
                  return (
                    <label
                      key={t}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                        active
                          ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/30 dark:bg-indigo-950/30'
                          : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="type"
                        checked={active}
                        onChange={() => setType(t)}
                        className="mt-0.5 size-4 shrink-0 accent-indigo-600"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {p.label}
                        </span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {p.hint}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : null}

            {step === 2 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labelled label="First day">
                    <input
                      autoFocus
                      type="date"
                      value={from}
                      onChange={(e) => {
                        setFrom(e.target.value)
                        if (to < e.target.value) setTo(e.target.value)
                      }}
                      className={dateControl}
                    />
                  </Labelled>
                  <Labelled label="Last day">
                    <input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                      className={dateControl}
                    />
                  </Labelled>
                </div>

                {policy.halfDays ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Labelled label="Starts">
                      <Segmented
                        value={startAt}
                        onChange={(v) => setStartAt(v as StartAt)}
                        options={[
                          { value: 'morning', label: 'Morning' },
                          { value: 'afternoon', label: 'Afternoon' },
                        ]}
                        full
                      />
                    </Labelled>
                    <Labelled label="Ends">
                      <Segmented
                        value={endAt}
                        onChange={(v) => setEndAt(v as EndAt)}
                        options={[
                          { value: 'lunchtime', label: 'Lunchtime' },
                          { value: 'end_of_day', label: 'End of day' },
                        ]}
                        full
                      />
                    </Labelled>
                  </div>
                ) : (
                  <Callout tone="info">
                    {policy.label} is booked in whole days.
                  </Callout>
                )}

                {breakdown.error ? (
                  <Callout tone="bad">{breakdown.error}</Callout>
                ) : (
                  <Callout tone="info">
                    That is{' '}
                    <strong className="font-semibold">
                      {formatDays(breakdown.days)} working{' '}
                      {breakdown.days === 1 ? 'day' : 'days'}
                    </strong>{' '}
                    out of {breakdown.calendarDays} calendar days.
                  </Callout>
                )}

                {ownClash ? (
                  <Callout tone="bad">
                    {person?.name} already has {ownClash.status} {ownClash.type}{' '}
                    leave from {formatLeaveDate(ownClash.from)} to{' '}
                    {formatLeaveDate(ownClash.to)} ({ownClash.id}).
                  </Callout>
                ) : null}

                {overAllowance ? (
                  <Callout tone="bad">
                    {person?.name} has {formatDays(remaining)} days left, and
                    this request needs {formatDays(breakdown.days)}.
                  </Callout>
                ) : null}

                {crewAway.length > 0 ? (
                  <Callout tone="warn">
                    {crewAway.length} of {crewSize} on the same crew are already
                    off across these dates: {crewAway.join(', ')}.
                  </Callout>
                ) : null}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                  <Row label="Employee">
                    {person?.name} · {person?.ref}
                  </Row>
                  <Row label="Leave type">{policy.label}</Row>
                  <Row
                    label="Dates"
                    detail={
                      startAt === 'afternoon' || endAt === 'lunchtime'
                        ? [
                            startAt === 'afternoon' ? 'from the afternoon' : '',
                            endAt === 'lunchtime' ? 'to lunchtime' : '',
                          ]
                            .filter(Boolean)
                            .join(', ')
                        : undefined
                    }
                  >
                    {from === to
                      ? formatLeaveDate(from)
                      : `${formatLeaveDate(from)} – ${formatLeaveDate(to)}`}
                  </Row>
                  <Row label="Calendar days in range" tone="muted">
                    {breakdown.calendarDays}
                  </Row>
                  {breakdown.weekendDays > 0 ? (
                    <Row label="Non-working days skipped" tone="muted">
                      −{breakdown.weekendDays}
                    </Row>
                  ) : null}
                  {breakdown.holidays.length > 0 ? (
                    <Row
                      label="Public holidays skipped"
                      tone="muted"
                      detail={breakdown.holidays
                        .map((h) => `${h.name} (${formatLeaveDate(h.date)})`)
                        .join(', ')}
                    >
                      −{breakdown.holidays.length}
                    </Row>
                  ) : null}
                  {breakdown.halfDayAdjustment > 0 ? (
                    <Row label="Half-day adjustment" tone="muted">
                      −{formatDays(breakdown.halfDayAdjustment)}
                    </Row>
                  ) : null}
                  <Row label="Days deducted" strong>
                    {formatDays(breakdown.days)}
                  </Row>
                </dl>

                {policy.deducts ? (
                  <Callout tone={overAllowance ? 'bad' : 'info'}>
                    {person?.name} would have{' '}
                    {formatDays(remainingAfter)} of {context.entitlement} days
                    left after this.
                  </Callout>
                ) : (
                  <Callout tone="info">
                    {policy.label} does not come off the annual allowance, so{' '}
                    {person?.name} keeps {formatDays(remaining)} days.
                  </Callout>
                )}

                <Labelled label="Reason" hint="Optional">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder={`e.g. ${type === 'sick' ? 'Flu, self-certified' : 'Family holiday'}`}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </Labelled>

                <Labelled
                  label="Approval"
                  hint={
                    approveNow
                      ? 'Recorded as approved straight away.'
                      : 'Lands in the pending queue.'
                  }
                >
                  <Segmented
                    value={approveNow ? 'now' : 'queue'}
                    onChange={(v) => setApproveNow(v === 'now')}
                    options={[
                      { value: 'queue', label: 'Send for approval' },
                      { value: 'now', label: 'Approve immediately' },
                    ]}
                    full
                  />
                </Labelled>
              </>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50/70 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p
              aria-live="polite"
              className="min-w-0 text-sm text-zinc-600 dark:text-zinc-400"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {error ? (
                <span className="font-medium text-[#b02c2c] dark:text-[#e07272]">
                  {error}
                </span>
              ) : blocker ? (
                blocker
              ) : person && step > 0 ? (
                <>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {person.name}
                  </span>
                  {' · '}
                  {policy.label}
                  {step >= 2 && !breakdown.error
                    ? ` · ${formatDays(breakdown.days)} ${breakdown.days === 1 ? 'day' : 'days'}`
                    : ''}
                </>
              ) : (
                STEPS[step].blurb
              )}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (step === 0 ? onClose() : goTo(step - 1))}
                className={quietButton}
              >
                {step === 0 ? 'Cancel' : 'Back'}
              </button>
              <button
                type="submit"
                disabled={pending || Boolean(blocker)}
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending
                  ? 'Saving…'
                  : !isLast
                    ? 'Continue'
                    : approveNow
                      ? 'Approve leave'
                      : 'Submit request'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}

const quietButton =
  'shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'

const dateControl =
  'h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50'

function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </span>
        {hint ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
  full = false,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  full?: boolean
}) {
  return (
    <div
      className={`${full ? 'flex' : 'inline-flex'} rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`${full ? 'flex-1' : ''} rounded-md px-3 py-1 text-sm font-medium transition ${
            value === option.value
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Balance({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string
  value: number
  hint?: string
  tone?: 'plain' | 'good' | 'bad'
}) {
  const colour =
    tone === 'good'
      ? 'text-[#006300] dark:text-[#0ca30c]'
      : tone === 'bad'
        ? 'text-[#b02c2c] dark:text-[#e07272]'
        : 'text-zinc-900 dark:text-zinc-100'
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p
        className={`text-base font-semibold ${colour}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatDays(value)}
      </p>
      {hint ? (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-600">{hint}</p>
      ) : null}
    </div>
  )
}

function Row({
  label,
  detail,
  children,
  strong = false,
  tone = 'plain',
}: {
  label: string
  detail?: string
  children: ReactNode
  strong?: boolean
  tone?: 'plain' | 'muted'
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="min-w-0">
        <span
          className={`text-sm ${
            strong
              ? 'font-medium text-zinc-900 dark:text-zinc-100'
              : tone === 'muted'
                ? 'text-zinc-500 dark:text-zinc-400'
                : 'text-zinc-700 dark:text-zinc-300'
          }`}
        >
          {label}
        </span>
        {detail ? (
          <span className="block text-xs text-zinc-400 dark:text-zinc-600">
            {detail}
          </span>
        ) : null}
      </dt>
      <dd
        className={`shrink-0 text-sm ${
          strong
            ? 'font-semibold text-zinc-900 dark:text-zinc-100'
            : 'text-zinc-600 dark:text-zinc-400'
        }`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {children}
      </dd>
    </div>
  )
}

function Callout({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'bad'
  children: ReactNode
}) {
  const styles = {
    info: 'border-zinc-200 bg-zinc-50/70 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400',
    warn: 'border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300',
    bad: 'border-[#d03b3b]/40 bg-[#d03b3b]/8 text-[#b02c2c] dark:text-[#e07272]',
  }[tone]
  return (
    <p className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</p>
  )
}

function TickIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
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
