'use client'

import { usePathname } from 'next/navigation'
import { usePageActionValue } from '@/app/ui/admin/page-action'

/** Title-case the last path segment: /admin/crews -> "Crews". */
function pageLabel(pathname: string) {
  if (pathname === '/admin/crews/new') return 'Add staff member'
  // /admin/crews/EMP-001 and /admin/crews/EMP-001/edit — the employee ID is not
  // a title, so name the page after what you are doing to it.
  const staffFile = pathname.match(/^\/admin\/crews\/(?!new$)([^/]+)(\/edit)?$/)
  if (staffFile) return staffFile[2] ? 'Edit staff member' : 'Staff profile'
  const segment = pathname.split('/').filter(Boolean).pop() ?? 'admin'
  return segment
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Desktop-only: below lg the mobile header in the layout takes over. */
/**
 * Primary action per section. Pages that register a handler override the label
 * at runtime; listing them here too means the button renders during SSR
 * instead of popping in once hydration attaches the handler.
 */
export const ADMIN_ACTIONS: Record<string, string> = {
  '/admin/crews': 'Add staff member',
  '/admin/crews/new': 'Save staff member',
  '/admin/timesheets': 'Add entry',
  '/admin/leaves': 'New request',
  '/admin/invoices': 'New invoice',
  '/admin/expenses': 'Add expense',
  '/admin/payroll': 'Add adjustment',
  '/admin/settings': 'Save changes',
}

export function AdminTopbar({
  actions = ADMIN_ACTIONS,
}: {
  actions?: Record<string, string>
}) {
  const pathname = usePathname()
  // A page-registered action wins; the map is the fallback for pages that
  // only need a label with no wired behaviour yet.
  const registered = usePageActionValue()
  const label = registered?.label ?? actions[pathname]

  return (
    <header className="sticky top-0 z-20 hidden h-18 shrink-0 border-b border-zinc-200 bg-white/80 backdrop-blur lg:block dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex h-full items-center justify-between gap-4 px-8">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {pageLabel(pathname)}
        </h1>

        <div className="flex h-9 items-center gap-2">
          {label ? (
            <button
              type="button"
              onClick={registered?.run}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              <PlusIcon />
              {label}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-4"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
