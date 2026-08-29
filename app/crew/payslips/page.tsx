import type { Metadata } from 'next'
import { getCrewSession, getCrewLatestPayslip } from '@/app/actions/crew'
import { CrewPayslips } from '@/app/ui/crew/payslips'

export const metadata: Metadata = { title: 'My payslips' }

export default async function CrewPayslipsPage() {
  const me = await getCrewSession()

  // No argument: the action resolves the subject from the session, so the page
  // cannot ask for someone else's slip.
  const formattedRecord = await getCrewLatestPayslip()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          My payslips
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Open a slip to print it or save it as a PDF.
        </p>
      </div>

      <CrewPayslips person={me} record={formattedRecord} />
    </div>
  )
}
