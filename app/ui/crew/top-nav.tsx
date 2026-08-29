'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoMark } from '@/app/ui/logo-mark'
import { signOut } from '@/app/actions/auth'

const NAV = [
  { href: '/crew', label: 'Overview' },
  { href: '/crew/timesheet', label: 'Timesheet' },
  { href: '/crew/leave', label: 'Leave' },
  { href: '/crew/expenses', label: 'Expenses' },
  { href: '/crew/payslips', label: 'Payslips' },
]

function SignOutIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M15 17l5-5-5-5M20 12H9M12 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h6" />
    </svg>
  )
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

/** Horizontal menu — the crew portal is a shallow, few-page space, so a top
 *  bar suits it better than the admin's rail. */
export function CrewTopNav({ person }: { person: { name: string; role: string } }) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/crew"
          className="flex shrink-0 items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"
        >
          <LogoMark className="size-9 shrink-0 text-indigo-600" />
          <span className="hidden text-xl font-semibold tracking-tight text-zinc-900 sm:block">
            Work à Rail
          </span>
        </Link>

        <nav aria-label="Crew" className="min-w-0 flex-1">
          <ul className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((item) => {
              // '/crew' would otherwise match every child route.
              const current =
                item.href === '/crew'
                  ? pathname === '/crew'
                  : pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={`block shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                      current
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="hidden text-right sm:block">
            <span className="block text-sm font-medium text-zinc-900">
              {person.name}
            </span>
            <span className="block text-xs text-zinc-500">{person.role}</span>
          </span>
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
          >
            {initials(person.name)}
          </span>

          {/* A plain form posting to the sign-out action, so it still works
              without client JavaScript and clears the session server-side. */}
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              <SignOutIcon />
              <span className="hidden lg:block">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
