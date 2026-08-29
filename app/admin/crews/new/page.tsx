import { redirect } from 'next/navigation'

import { getActor } from '@/app/lib/authz'
import { prisma } from '@/app/lib/prisma'
import { StaffForm } from '@/app/ui/admin/staff-form'

export const metadata = { title: 'Add staff member' }

/**
 * Onboarding a new employee.
 *
 * A dedicated route rather than a modal: the form collects identity, payroll,
 * bank and compliance data across several sections, which does not belong in a
 * dialog that loses everything typed into it if the page reloads.
 *
 * Admin only. Managers can see their crew but cannot create employees, because
 * creating one also provisions a login.
 */
export default async function NewStaffPage() {
  const actor = await getActor()
  if (!actor) redirect('/signin')
  if (actor.user.role !== 'ADMIN') redirect('/admin/crews')

  const [crews, managers, lastRef] = await Promise.all([
    prisma.crew.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.staff.findMany({
      where: {
        deletedAt: null,
        employmentStatus: { in: ['active', 'onboarding'] },
      },
      select: { ref: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.staff.findFirst({
      select: { ref: true },
      orderBy: { ref: 'desc' },
    }),
  ])

  // Suggests the next reference in sequence so operators do not have to
  // remember the format or check for a clash.
  const suggestedRef = (() => {
    const match = /^([A-Za-z-]+)(\d+)$/.exec(lastRef?.ref ?? '')
    if (!match) return 'WR-001'
    const next = String(Number(match[2]) + 1).padStart(match[2].length, '0')
    return `${match[1]}${next}`
  })()

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Add staff member
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          An employee stays in <span className="font-medium">onboarding</span> until
          their right to work and signed contract are on file, and cannot be paid
          until a tax code and verified bank details are recorded.
        </p>
      </header>

      <StaffForm crews={crews} managers={managers} suggestedRef={suggestedRef} />
    </div>
  )
}
