'use client'

import { useEffect, useRef, useState } from 'react'
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

/**
 * Account menu behind the avatar.
 *
 * Sign-out used to sit in the bar as a permanently visible button, next to the
 * navigation links. On a five-item nav that put a destructive, one-click action
 * within a few pixels of the thing people press most often. Tucking it behind
 * the avatar keeps it discoverable in the place people already look for account
 * actions, without it being a mis-tap away.
 */
function AccountMenu({
  person,
}: {
  person: { name: string; role: string; email: string }
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Send focus back to the trigger, or a keyboard user is left with none.
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${person.name}`}
        className="flex items-center gap-2.5 rounded-lg px-1 py-1 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        <span className="hidden text-right sm:block">
          <span className="block text-sm font-medium text-zinc-900">
            {person.name}
          </span>
          <span className="block text-xs text-zinc-500">{person.role}</span>
        </span>
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
        >
          {initials(person.name)}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
        >
          {/* Repeated here because the trigger hides the name below `sm`. */}
          <div className="border-b border-zinc-100 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-zinc-900">
              {person.name}
            </p>
            <p className="truncate text-xs text-zinc-500">{person.email}</p>
          </div>

          {/* Still a plain form posting to the action, so the session is
              cleared server-side rather than by anything on the client. */}
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 focus-visible:bg-zinc-50 focus-visible:outline-none"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

/** Horizontal menu — the crew portal is a shallow, few-page space, so a top
 *  bar suits it better than the admin's rail. */
export function CrewTopNav({
  person,
}: {
  person: { name: string; role: string; email: string }
}) {
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

        <AccountMenu person={person} />
      </div>
    </header>
  )
}
