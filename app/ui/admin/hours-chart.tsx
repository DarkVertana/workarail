'use client'

import { useId, useState } from 'react'
import { type DayHours } from '@/app/lib/admin-data'

const W = 1200
const H = 260
const PAD = { top: 16, right: 8, bottom: 28, left: 40 }
const GAP = 2 // surface gap between stacked segments
const R = 4 // rounded data-end

const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const TICK_STEP = 20

const SERIES = [
  { key: 'full', label: 'Full days', color: 'var(--viz-series-1)' },
  { key: 'half', label: 'Half days', color: 'var(--viz-series-2)' },
] as const

/** Ceiling snapped to TICK_STEP, so every tick is a whole number. */
function axisMax(rows: DayHours[]) {
  const peak = Math.max(...rows.map((d) => d.full + d.half), TICK_STEP)
  return Math.ceil(peak / TICK_STEP) * TICK_STEP
}

/** Bar with only its top corners rounded — the data-end — square on the baseline. */
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(R, h, w / 2)
  if (h <= 0) return ''
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

export function HoursChart({
  initialHours,
  todayDate,
}: {
  initialHours: DayHours[]
  todayDate: string
}) {
  const data = initialHours
  const activeToday = todayDate
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const titleId = useId()

  const max = axisMax(data)
  const ticks = Array.from({ length: max / TICK_STEP + 1 }, (_, i) => i * TICK_STEP)
  const band = PLOT_W / data.length
  const barW = Math.min(40, band * 0.62)

  const x = (i: number) => PAD.left + band * i + (band - barW) / 2
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H
  const total = (d: DayHours) => d.full + d.half

  const hovered = active === null ? null : data[active]

  return (
    <section className="viz rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-sm font-medium text-zinc-900">
            Hours logged
          </h2>
          <p className="text-sm text-zinc-500">This week, across the team</p>
        </div>

        <div className="flex items-center gap-4">
          {/* Legend: always present at 2+ series, so identity is never colour alone. */}
          <ul className="flex items-center gap-3">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-xs text-zinc-600">
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>

      {showTable ? (
        <ChartTable data={data} />
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={titleId}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'}
                  strokeWidth={1}
                />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {t}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const bx = x(i)
              const hasHalf = d.half > 0
              // Full days sit on the baseline; half days stack on top with a
              // 2px gap. Whichever segment is topmost carries the rounded end.
              const fullH = (d.full / max) * PLOT_H
              const halfH = (d.half / max) * PLOT_H
              const halfY = y(total(d))
              const fullY = y(d.full)
              const dim = active !== null && active !== i
              const isToday = d.date === activeToday

              return (
                <g key={d.date} opacity={dim ? 0.45 : 1}>
                  {hasHalf ? (
                    <path d={topRounded(bx, halfY, barW, Math.max(halfH - GAP, 0))} fill="var(--viz-series-2)" />
                  ) : null}
                  {hasHalf ? (
                    <rect x={bx} y={fullY} width={barW} height={Math.max(fullH, 0)} fill="var(--viz-series-1)" />
                  ) : (
                    <path d={topRounded(bx, fullY, barW, fullH)} fill="var(--viz-series-1)" />
                  )}
                  <text
                    x={bx + barW / 2}
                    y={H - 10}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={isToday ? 600 : 400}
                    fill={isToday ? 'var(--viz-series-1)' : 'var(--viz-muted)'}
                  >
                    {d.day}
                  </text>
                </g>
              )
            })}

            {/* Hit targets: full-height bands, wider than the marks. */}
            {data.map((d, i) => (
              <rect
                key={`hit-${d.date}`}
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={PLOT_H}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </svg>

          {hovered ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm"
              style={{
                left: `${((PAD.left + band * (active as number) + band / 2) / W) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <p className="font-medium text-zinc-900">{hovered.day}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="mt-1 flex items-center gap-1.5 text-zinc-600">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                  <span className="ml-auto pl-3 font-medium text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {hovered[s.key]}h
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function ChartTable({ data }: { data: DayHours[] }) {
  return (
    <div className="mt-4 max-h-72 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-zinc-200">
            <th className="py-2 pr-4 font-medium text-zinc-600">Day</th>
            <th className="py-2 pr-4 text-right font-medium text-zinc-600">Full days</th>
            <th className="py-2 pr-4 text-right font-medium text-zinc-600">Half days</th>
            <th className="py-2 text-right font-medium text-zinc-600">Total</th>
          </tr>
        </thead>
        <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
          {data.map((d) => (
            <tr key={d.date} className="border-b border-zinc-100 last:border-0">
              <td className="py-2 pr-4 text-zinc-700">{d.day}</td>
              <td className="py-2 pr-4 text-right text-zinc-700">{d.full}</td>
              <td className="py-2 pr-4 text-right text-zinc-700">{d.half}</td>
              <td className="py-2 text-right font-medium text-zinc-900">{d.full + d.half}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
