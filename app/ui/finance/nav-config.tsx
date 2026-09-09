'use client'

import { AdminSidebar, type NavGroup } from '@/app/ui/admin/sidebar'
import { AdminTopbar } from '@/app/ui/admin/topbar'

const ICON = {
  'aria-hidden': 'true',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'size-[18px]',
} as const

function GridIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function InvoiceIcon() {
  return (
    <svg {...ICON}>
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z" />
      <path d="M14 3v4.5h4.5" />
      <path d="M9 13h6M9 16.5h4" />
    </svg>
  )
}

function ReceiptIcon() {
  return (
    <svg {...ICON}>
      <path d="M5.5 3.5h13v17l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg {...ICON}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h3" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 20.5V4" />
      <path d="M4 20.5h16.5" />
      <path d="M8 17V12M12.5 17V8M17 17v-3.5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7v5.25L15.5 14" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  )
}

/** Finance sees the money, plus the attendance and leave that drive payroll. */
export const FINANCE_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/finance', label: 'Dashboard', icon: GridIcon }],
  },
  {
    label: 'Finance',
    items: [
      { href: '/finance/invoices', label: 'Invoices', icon: InvoiceIcon },
      { href: '/finance/expenses', label: 'Expenses', icon: ReceiptIcon },
      { href: '/finance/payroll', label: 'Payroll', icon: CardIcon },
      { href: '/finance/analytics', label: 'Analytics', icon: ChartIcon },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/finance/attendance', label: 'Attendance', icon: ClockIcon },
      { href: '/finance/leave', label: 'Leave', icon: CalendarIcon },
    ],
  },
]

export const FINANCE_ACTIONS: Record<string, string> = {
  '/finance/invoices': 'New invoice',
}

/**
 * Client wrappers so the nav config never crosses the server/client boundary:
 * it holds icon components, and functions can't be serialised as props.
 */
export function FinanceSidebar({
  user,
  pendingLeaves,
  pendingExpenses,
}: {
  user?: {
    name?: string | null
    email: string
    avatarUrl?: string | null
  }
  pendingLeaves: number
  pendingExpenses: number
}) {
  return (
    <AdminSidebar
      groups={FINANCE_NAV}
      subtitle="Operations finance"
      home="/finance"
      user={user}
      pendingLeaves={pendingLeaves}
      pendingExpenses={pendingExpenses}
    />
  )
}

export function FinanceTopbar() {
  return <AdminTopbar actions={FINANCE_ACTIONS} />
}
