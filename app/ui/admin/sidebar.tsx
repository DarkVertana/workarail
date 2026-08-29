'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType } from 'react'
import { LogoMark } from '@/app/ui/logo-mark'
import { signOut } from '@/app/actions/auth'


export type NavItem = {
  href: string
  label: string
  icon: ComponentType
  badge?: number
}

export type NavGroup = { label: string; items: NavItem[] }

export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { href: '/admin/dashboard', label: 'Dashboard', icon: GridIcon },
      { href: '/admin/crews', label: 'Crews', icon: UsersIcon },
      { href: '/admin/timesheets', label: 'Timesheets', icon: ClockIcon },
      // Badges count what actually needs a decision, so they can't go stale.
      {
        href: '/admin/leaves',
        label: 'Leaves',
        icon: CalendarIcon,
      },
      // Birthdays and work anniversaries.
      { href: '/admin/celebrations', label: 'Celebrations', icon: CakeIcon },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/invoices', label: 'Invoices', icon: InvoiceIcon },
      {
        href: '/admin/expenses',
        label: 'Expenses',
        icon: ReceiptIcon,
      },
      { href: '/admin/payroll', label: 'Payroll', icon: CardIcon },
      { href: '/admin/analytics', label: 'Analytics', icon: ChartIcon },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/admin/settings', label: 'Settings', icon: CogIcon }],
  },
]

// On the indigo panel an indigo focus ring would disappear — ring in white.
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

function Brand({ subtitle, home }: { subtitle: string; home: string }) {
  return (
    <Link
      href={home}
      className={`flex items-center gap-3 rounded-lg px-2 py-1 ${FOCUS}`}
    >
      <LogoMark className="size-9 shrink-0 text-indigo-600" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xl leading-tight font-semibold tracking-tight text-white">
          Work à Rail
        </span>
        <span className="truncate text-center text-[10px] leading-tight font-normal tracking-wide text-indigo-200 uppercase">
          {subtitle}
        </span>
      </span>
    </Link>
  )
}

function NavLinks({
  groups,
  onNavigate,
}: {
  groups: NavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <nav aria-label="Admin" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <h2 className="px-3 pb-1 text-xs font-medium tracking-wide text-indigo-300 uppercase">
            {group.label}
          </h2>
          {group.items.map((item) => {
            const current = pathname === item.href
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${FOCUS} ${
                  current
                    ? 'bg-white font-medium text-indigo-950'
                    : 'text-indigo-100/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span
                  className={
                    current
                      ? 'text-indigo-950'
                      : 'text-indigo-300 group-hover:text-white'
                  }
                >
                  <Icon />
                </span>
                {item.label}
                {item.badge ? (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
                      current
                        ? 'bg-indigo-950/10 text-indigo-950'
                        : 'bg-white/10 text-indigo-100'
                    }`}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function AccountBlock({
  user,
}: {
  user?: {
    name?: string | null
    email: string
    avatarUrl?: string | null
  }
}) {
  const name = user?.name || 'Admin'
  const email = user?.email || 'admin@workarail.com'
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AD'

  return (
    <div className="flex items-center gap-3 px-1">
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={name}
          className="size-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white"
        >
          {initials}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{name}</p>
        <p className="truncate text-xs text-indigo-200">{email}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className={`shrink-0 rounded-md p-1.5 text-indigo-200 transition hover:bg-white/10 hover:text-white ${FOCUS}`}
        >
          <SignOutIcon />
        </button>
      </form>
    </div>
  )
}

/**
 * The panel body. Same cover artwork and indigo treatment as the sign-in page,
 * so the admin rail reads as a vertical slice of that screen.
 */
function SidebarPanel({
  groups,
  subtitle,
  home,
  user,
}: {
  groups: NavGroup[]
  subtitle: string
  home: string
  user?: {
    name?: string | null
    email: string
    avatarUrl?: string | null
  }
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-indigo-950">
      {/* Brand pinned top, account pinned bottom, nav scrolls between them. */}
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-18 shrink-0 items-center px-4">
          <Brand subtitle={subtitle} home={home} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <NavLinks groups={groups} />
        </div>

        <div className="shrink-0 border-t border-white/10 px-3 py-3">
          <AccountBlock user={user} />
        </div>
      </div>
    </div>
  )
}

/** Desktop rail. */
export function AdminSidebar({
  groups,
  subtitle = 'Operations admin',
  home = '/admin/dashboard',
  user,
  pendingLeaves,
  pendingExpenses,
}: {
  groups?: NavGroup[]
  subtitle?: string
  home?: string
  user?: {
    name?: string | null
    email: string
    avatarUrl?: string | null
  }
  pendingLeaves?: number
  pendingExpenses?: number
}) {
  const dynamicGroups: NavGroup[] = groups || [
    {
      label: 'Operations',
      items: [
        { href: '/admin/dashboard', label: 'Dashboard', icon: GridIcon },
        { href: '/admin/crews', label: 'Crews', icon: UsersIcon },
        { href: '/admin/timesheets', label: 'Timesheets', icon: ClockIcon },
        {
          href: '/admin/leaves',
          label: 'Leaves',
          icon: CalendarIcon,
          badge: pendingLeaves && pendingLeaves > 0 ? pendingLeaves : undefined,
        },
        { href: '/admin/celebrations', label: 'Celebrations', icon: CakeIcon },
      ],
    },
    {
      label: 'Finance',
      items: [
        { href: '/admin/invoices', label: 'Invoices', icon: InvoiceIcon },
        {
          href: '/admin/expenses',
          label: 'Expenses',
          icon: ReceiptIcon,
          badge: pendingExpenses && pendingExpenses > 0 ? pendingExpenses : undefined,
        },
        { href: '/admin/payroll', label: 'Payroll', icon: CardIcon },
        { href: '/admin/analytics', label: 'Analytics', icon: ChartIcon },
      ],
    },
    {
      label: 'Account',
      items: [{ href: '/admin/settings', label: 'Settings', icon: CogIcon }],
    },
  ];

  return <SidebarPanel groups={dynamicGroups} subtitle={subtitle} home={home} user={user} />
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

function UsersIcon() {
  return (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M2.75 19.5a6.25 6.25 0 0 1 12.5 0" />
      <path d="M16 5.5a3.25 3.25 0 0 1 0 6M17.5 14.2a6.25 6.25 0 0 1 3.75 5.3" />
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
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
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

function CakeIcon() {
  return (
    <svg {...ICON}>
      <path d="M4.5 20.5h15" />
      <path d="M6 20.5v-7h12v7" />
      <path d="M6 16.5c1.2 0 1.2 1 2.4 1s1.2-1 2.4-1 1.2 1 2.4 1 1.2-1 2.4-1" />
      <path d="M12 13.5v-3" />
      <circle cx="12" cy="8.8" r="1.2" />
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

function CogIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg {...ICON} className="size-4">
      <path d="M15 17l5-5-5-5M20 12H9M12 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h6" />
    </svg>
  )
}

