import { redirect } from 'next/navigation'
import { getActor } from '@/app/lib/authz'
import { landingPathFor } from '@/app/actions/auth'
import { getPendingCounts } from '@/app/actions/admin'
import { PageActionProvider } from '@/app/ui/admin/page-action'
import { SmallScreenNotice } from '@/app/ui/admin/small-screen-notice'
import { FinanceSidebar, FinanceTopbar } from '@/app/ui/finance/nav-config'

const RAIL = 'w-64'

/** Same shell as the admin area, with the finance role's own menu. */
export default async function FinanceLayout({ children }: LayoutProps<'/finance'>) {
  const actor = await getActor()

  if (!actor) {
    redirect('/signin')
  }

  // Finance is now a distinct role rather than a second door onto admin.
  if (actor.user.role !== 'ADMIN' && actor.user.role !== 'FINANCE') {
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
      <SmallScreenNotice />

      <div className="hidden flex-1 flex-col bg-zinc-50 lg:flex">
        <aside
          className={`lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block ${RAIL}`}
        >
          <FinanceSidebar
            user={user}
            pendingLeaves={pendingLeaves}
            pendingExpenses={pendingExpenses}
          />
        </aside>

        <PageActionProvider>
          <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
            <FinanceTopbar />
            <main className="flex-1 px-4 py-5 lg:px-8 lg:py-8">{children}</main>
          </div>
        </PageActionProvider>
      </div>
    </>
  )
}
