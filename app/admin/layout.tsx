import { redirect } from 'next/navigation'
import { getActor } from '@/app/lib/authz'
import { landingPathFor } from '@/app/actions/auth'
import { getPendingCounts } from '@/app/actions/admin'
import { PageActionProvider } from '@/app/ui/admin/page-action'
import { AdminSidebar } from '@/app/ui/admin/sidebar'
import { SmallScreenNotice } from '@/app/ui/admin/small-screen-notice'
import { AdminTopbar } from '@/app/ui/admin/topbar'

const RAIL = 'w-64'

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const actor = await getActor()

  if (!actor) {
    redirect('/signin')
  }

  // Presentation gate only — every action and route enforces its own
  // authorization. MANAGER is admitted for the approval screens; ADMIN has
  // the full area.
  if (actor.user.role !== 'ADMIN' && actor.user.role !== 'MANAGER') {
    redirect(await landingPathFor(actor.user.role))
  }

  const user = {
    id: actor.user.id,
    name: actor.user.name,
    email: actor.user.email,
    avatarUrl: null,
  }

  const { pendingLeaves, pendingExpenses } = await getPendingCounts()

  return (
    <>
      {/* Below lg the office is gated — see SmallScreenNotice. */}
      <SmallScreenNotice />

      <div className="hidden flex-1 flex-col bg-zinc-50 lg:flex dark:bg-black">
        {/* Flush rail, pinned to the viewport edges. */}
        <aside
          className={`lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block ${RAIL}`}
        >
          <AdminSidebar
            user={user}
            pendingLeaves={pendingLeaves}
            pendingExpenses={pendingExpenses}
          />
        </aside>

        <PageActionProvider>
          <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
            <AdminTopbar />
            <main className="flex-1 px-4 py-5 lg:px-8 lg:py-8">{children}</main>
          </div>
        </PageActionProvider>
      </div>
    </>
  )
}

