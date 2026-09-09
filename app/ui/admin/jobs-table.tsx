import Link from 'next/link'
import { type ActivityKind, type ActivityRow } from '@/app/lib/admin-data'

// Status colours are reserved and always ship with a label — never colour alone.
const STATUS: Record<string, { dot: string; text: string }> = {
  pending: { dot: '#fab219', text: 'text-zinc-700' },
  submitted: { dot: '#fab219', text: 'text-zinc-700' },
  approved: { dot: '#0ca30c', text: 'text-[#006300]' },
  paid: { dot: '#0ca30c', text: 'text-[#006300]' },
  reimbursed: { dot: '#0ca30c', text: 'text-[#006300]' },
  overdue: { dot: '#d03b3b', text: 'text-[#b02c2c]' },
  rejected: { dot: '#d03b3b', text: 'text-[#b02c2c]' },
  draft: { dot: '#d4d4d8', text: 'text-zinc-500' },
}

const KIND: Record<ActivityKind, { label: string; href: string; badge: string }> = {
  leave: { label: 'Leave', href: '/admin/leaves', badge: 'bg-indigo-100 text-indigo-700' },
  expense: { label: 'Expense', href: '/admin/expenses', badge: 'bg-amber-100 text-amber-800' },
  invoice: { label: 'Invoice', href: '/admin/invoices', badge: 'bg-zinc-100 text-zinc-700' },
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

export function JobsTable({ initialActivity }: { initialActivity: ActivityRow[] }) {
  const rows = initialActivity

  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-medium text-zinc-900">Recent activity</h2>
        <span className="text-sm text-zinc-500">{rows.length} shown</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-600">
              <th scope="col" className="px-5 py-3 font-medium">Ref</th>
              <th scope="col" className="px-5 py-3 font-medium">Item</th>
              <th scope="col" className="px-5 py-3 font-medium">Who</th>
              <th scope="col" className="px-5 py-3 font-medium">Type</th>
              <th scope="col" className="px-5 py-3 font-medium">Status</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const s = STATUS[row.status] ?? STATUS.draft
              const k = KIND[row.kind]
              return (
                <tr key={`${row.kind}-${row.ref}`} className="border-b border-zinc-100 last:border-0">
                  <td className="px-5 py-3 text-zinc-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <Link
                      href={k.href}
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                    >
                      {row.ref}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-medium text-zinc-900">{row.title}</td>
                  <td className="px-5 py-3 text-zinc-600">{row.who}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${k.badge}`}>
                      {k.label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`flex items-center gap-1.5 font-medium capitalize ${s.text}`}>
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: s.dot }} />
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {row.amount}
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {shortDate(row.date)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
