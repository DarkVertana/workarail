import {
  forRegion,
  getCountries,
  getHolidays,
  regionName,
  regionsOf,
  isExtraCountry,
} from '@/app/lib/holidays'
import { getCompanyHolidays } from '@/app/actions/admin'
import { HolidayFilter } from '@/app/ui/admin/holiday-filter'
import { ManualHolidays } from '@/app/ui/admin/manual-holidays'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/** Weekday for an ISO date, via UTC so a timezone can't shift it a day. */
function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function longDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

/**
 * Server Component: the holiday table is fetched on the server and cached, so
 * the API key-free upstream isn't hit from the browser. Selection travels in
 * the URL via a plain GET form, which means it works without JavaScript and
 * the result is shareable.
 */
export async function PublicHolidays({
  country,
  region,
  year,
}: {
  country: string
  region: string | null
  year: number
}) {
  const [countries, holidays, entries] = await Promise.all([
    getCountries(),
    getHolidays(year, country),
    getCompanyHolidays(year),
  ])

  const unavailable = holidays === null
  const regions = holidays ? regionsOf(holidays) : []
  const activeRegion = region && regions.includes(region) ? region : null
  const shown = holidays ? forRegion(holidays, activeRegion) : []

  return (
    <section id="holidays" className="scroll-mt-24 rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-medium text-zinc-900">Public holidays</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Non-working days for leave and timesheets.
          {countries.length > 0 ? ` ${countries.length} countries covered.` : ''}
        </p>
      </div>

      <HolidayFilter
        countries={countries}
        regions={regions}
        country={country}
        region={activeRegion}
        year={year}
      />

      {unavailable ? (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">
          Couldn&apos;t reach the holiday service. The rest of your settings are
          unaffected — try Apply again in a moment.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">
          No public holidays listed for this selection.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-100">
            {shown.map((h) => (
              <li
                key={`${h.date}-${h.name}`}
                className="flex items-center gap-4 px-5 py-2.5"
              >
                <span
                  className="w-16 shrink-0 text-sm font-medium text-zinc-900"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {longDate(h.date)}
                </span>
                <span className="w-10 shrink-0 text-xs text-zinc-400">
                  {weekday(h.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">
                  {h.localName}
                  {h.localName !== h.name ? (
                    <span className="ml-2 text-xs text-zinc-400">{h.name}</span>
                  ) : null}
                </span>
                {h.global ? (
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                    Nationwide
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {h.counties?.map(regionName).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
            {shown.length} holiday{shown.length === 1 ? '' : 's'} in {year}
            {activeRegion ? ` · nationwide plus ${regionName(activeRegion)}` : ' · nationwide only'}
            {isExtraCountry(country)
              ? ' · from Google Calendar, so observances are included'
              : ' · from Nager.Date'}
          </p>
        </>
      )}

          <ManualHolidays year={year} entries={entries} />
    </section>
  )
}
