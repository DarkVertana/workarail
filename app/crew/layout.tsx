import { CrewTopNav } from '@/app/ui/crew/top-nav'
import { getCrewSession } from '@/app/actions/crew'

export default async function CrewLayout({ children }: LayoutProps<'/crew'>) {
  const me = await getCrewSession()

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <CrewTopNav person={{ name: me.name, role: me.role, email: me.email }} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
