'use client'

import { useId, useState, useTransition } from 'react'
import { useToast } from '@/app/ui/toast'
import { addCompanyHoliday, removeCompanyHoliday } from '@/app/actions/admin'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

type Entry = { id: string; date: string; name: string }

function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function longDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

/**
 * Manual entries, for countries the holiday API doesn't cover. Not every
 * country is in Nager.Date's table, so this keeps the feature usable
 * everywhere rather than leaving those teams stuck.
 */
export function ManualHolidays({
  year,
  entries,
}: {
  year: number
  entries: Entry[]
}) {
  const [error, setError] = useState<string | null>(null)
  // Controlled inputs rather than a nested form element, which would be
  // invalid HTML inside the settings form and break hydration.
  const [date, setDate] = useState(`${year}-01-01`)
  const [name, setName] = useState('')
  const toast = useToast()
  const id = useId()
  const [pending, startTransition] = useTransition()

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="border-t border-zinc-200 px-5 py-4">
      <h3 className="text-sm font-medium text-zinc-900">Add a holiday manually</h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        For dates the source doesn&apos;t list, or company-specific closures.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-700">
          Date
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          />
        </label>
        <label className="flex min-w-52 flex-1 flex-col gap-1.5 text-xs font-medium text-zinc-700">
          Name
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Diwali"
            className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const label = name.trim()
            if (!date || !label) {
              setError('Give the holiday a date and a name.')
              return
            }
            if (!date.startsWith(String(year))) {
              setError(`Pick a date in ${year} to see it in this list.`)
              return
            }
            startTransition(async () => {
              const result = await addCompanyHoliday({ date, name: label })
              if ('error' in result) {
                setError(result.error ?? 'Could not save the company holiday.')
                return
              }
              setError(null)
              setName('')
              toast(`${label} added to the holiday calendar.`)
            })
          }}
          disabled={pending}
          className="h-9 rounded-lg border border-zinc-300 px-3.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          Add
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-[#b02c2c]">
          {error}
        </p>
      ) : null}

      {sorted.length > 0 ? (
        <ul className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {sorted.map((e) => (
            <li key={e.id} className="flex items-center gap-4 px-3 py-2">
              <span
                className="w-16 shrink-0 text-sm font-medium text-zinc-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {longDate(e.date)}
              </span>
              <span className="w-10 shrink-0 text-xs text-zinc-400">
                {weekday(e.date)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">
                {e.name}
              </span>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                Manual
              </span>
              <button
                type="button"
                onClick={() => {
                  startTransition(async () => {
                    const result = await removeCompanyHoliday(e.id)
                    if ('error' in result) {
                      setError(result.error ?? 'Could not remove the company holiday.')
                      return
                    }
                    setError(null)
                    toast(`${e.name} removed.`, 'info')
                  })
                }}
                disabled={pending}
                aria-label={`Remove ${e.name}`}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[#b02c2c] transition hover:bg-[#d03b3b]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
