import type { Metadata } from 'next'
import Link from 'next/link'
import {
  attendanceHours,
  formatMoney,
  type AttendanceCode,
} from '@/app/lib/admin-data'
import { STAT_ICON } from '@/app/ui/admin/stat-card'
import {
  getInvoices,
  getExpenses,
  getPayrollRecords,
  getStaff,
  getLeaveRequests,
  getRequestPayPeriod,
  getMonthlyFinance,
  getTimesheetData,
} from '@/app/actions/admin'

export const metadata: Metadata = {
  title: 'Finance dashboard',
  description: 'Cash position, payroll cost and the people data behind it.',
}

export const dynamic = 'force-dynamic'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function shortDate(iso: string) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MON[Number(m) - 1]}`
}

export default async function FinanceDashboardPage() {
  const invoices = await getInvoices()
  const expenses = await getExpenses()
  const payrollRuns = await getPayrollRecords()
  const staff = await getStaff()
  const leaveRequests = await getLeaveRequests()
  const payPeriod = await getRequestPayPeriod()
  const months = await getMonthlyFinance()
  const { week: attendanceWeek, today, attendancePatterns } = await getTimesheetData()

  const nameFor = (ref: string) => staff.find((p) => p.ref === ref)?.name ?? ref

  const outstanding = invoices
    .filter((i) => i.status === 'pending' || i.status === 'overdue')
    .reduce((n, i) => n + i.amountPence, 0)
  const overdue = invoices.filter((i) => i.status === 'overdue')
  const payrollCostPence = payrollRuns.reduce((n, r) => n + r.grossPence, 0)
  const claimsToPay = expenses.filter(
    (e) =>
      e.method !== 'company_card' &&
      (e.status === 'submitted' || e.status === 'approved')
  )

  const current = months[months.length - 1]
  const net = current.earnedPence - current.spentPence

  // Attendance and leave matter here because they drive payroll cost.
  const todayIndex = attendanceWeek.indexOf(today)
  const codesToday = staff.map((p) => (attendancePatterns[p.ref]?.[todayIndex] ?? '-') as AttendanceCode)
  const weekHours = staff.reduce(
    (n, p) => {
      const pat = attendancePatterns[p.ref] || ''
      let sum = 0
      for (const c of pat) {
        sum += attendanceHours[c as AttendanceCode] || 0
      }
      return n + sum
    },
    0
  )
  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending')

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MoneyCard label="Outstanding" value={formatMoney(outstanding)} hint={`${invoices.filter((i) => i.status !== 'paid' && i.status !== 'draft').length} unpaid invoices`} tone="bg-indigo-100 text-indigo-700" icon={<InvoiceIcon />} />
        <MoneyCard label="Overdue" value={formatMoney(overdue.reduce((n, i) => n + i.amountPence, 0))} hint={`${overdue.length} past due`} tone="bg-[#d03b3b]/12 text-[#b02c2c]" icon={<AlertIcon />} />
        <MoneyCard label="Payroll cost" value={formatMoney(payrollCostPence)} hint={payPeriod.label} tone="bg-zinc-100 text-zinc-700" icon={<CardIcon />} />
        <MoneyCard label="To reimburse" value={formatMoney(claimsToPay.reduce((n, e) => n + e.amountPence, 0))} hint={`${claimsToPay.length} claims`} tone="bg-amber-100 text-amber-800" icon={<ReceiptIcon />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-900">This month</h2>
              <p className="text-sm text-zinc-500">{payPeriod.label}</p>
            </div>
            <Link href="/finance/analytics" className="rounded-sm text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
              Analytics
            </Link>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-4">
            <Figure label="Earned" value={formatMoney(current.earnedPence)} />
            <Figure label="Spent" value={formatMoney(current.spentPence)} />
            <Figure
              label="Net"
              value={formatMoney(net)}
              tone={net >= 0 ? 'text-[#006300]' : 'text-[#b02c2c]'}
            />
          </dl>

          <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
            Spend combines payroll cost with approved expense claims.
          </p>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="text-sm font-medium text-zinc-900">People costs</h2>
            <p className="mt-0.5 text-sm text-zinc-500">What drives the pay run</p>
          </div>
          <ul className="divide-y divide-zinc-100">
            <Row href="/finance/attendance" label="Hours this week" value={`${weekHours}h`} detail={`${staff.length} people`} />
            <Row href="/finance/attendance" label="In today" value={String(codesToday.filter((c) => c === 'P' || c === 'H').length)} detail={`${codesToday.filter((c) => c === 'A').length} absent`} />
            <Row href="/finance/leave" label="Leave to approve" value={String(pendingLeave.length)} detail={`${pendingLeave.reduce((n, r) => n + r.days, 0)} days requested`} />
            <Row href="/finance/payroll" label="Employees on payroll" value={String(payrollRuns.length)} detail={`${payrollRuns.filter((r) => r.status === 'draft').length} still to run`} />
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-medium text-zinc-900">Needs chasing</h2>
          <Link href="/finance/invoices" className="rounded-sm text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
            All invoices
          </Link>
        </div>
        {overdue.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">Nothing overdue.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {overdue.map((i) => (
              <li key={i.id} className="flex items-center gap-4 px-5 py-3">
                <span className="w-20 shrink-0 text-sm font-medium text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {i.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-900">{i.client}</span>
                  <span className="block truncate text-xs text-zinc-500">{i.reference}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-[#b02c2c]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  due {shortDate(i.due)}
                </span>
                <span className="w-24 shrink-0 text-right text-sm font-medium text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(i.amountPence)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-medium text-zinc-900">Claims to reimburse</h2>
          <Link href="/finance/expenses" className="rounded-sm text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
            All expenses
          </Link>
        </div>
        {claimsToPay.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">Nothing outstanding.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {claimsToPay.map((e) => (
              <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">{e.merchant}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {nameFor(e.staffRef)} · {shortDate(e.date)}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${e.status === 'approved' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>
                  {e.status}
                </span>
                <span className="w-20 shrink-0 text-right text-sm font-medium text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(e.amountPence)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ href, label, value, detail }: { href: string; label: string; value: string; detail: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-3 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-900">{label}</span>
          <span className="block truncate text-xs text-zinc-500">{detail}</span>
        </span>
        <span className="shrink-0 text-lg font-semibold tracking-tight text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
      </Link>
    </li>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-sm text-zinc-600">{label}</dt>
      <dd className={`mt-1 truncate text-xl font-semibold tracking-tight ${tone ?? 'text-zinc-900'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </dd>
    </div>
  )
}

function MoneyCard({ label, value, hint, tone, icon }: { label: string; value: string; hint: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-zinc-200 bg-white p-4">
      <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-600">{label}</p>
        <p className="truncate text-xl font-semibold tracking-tight text-zinc-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
        <p className="truncate text-xs text-zinc-500">{hint}</p>
      </div>
    </div>
  )
}

function InvoiceIcon() {
  return (<svg {...STAT_ICON}><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z" /><path d="M14 3v4.5h4.5" /></svg>)
}
function AlertIcon() {
  return (<svg {...STAT_ICON}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16h.01" /></svg>)
}
function CardIcon() {
  return (<svg {...STAT_ICON}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /></svg>)
}
function ReceiptIcon() {
  return (<svg {...STAT_ICON}><path d="M5.5 3.5h13v17l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5z" /><path d="M9 8.5h6M9 12.5h6" /></svg>)
}
