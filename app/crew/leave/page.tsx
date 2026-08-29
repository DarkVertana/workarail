import type { Metadata } from 'next'
import { getCrewDashboardData } from '@/app/actions/crew'
import { LeaveForm } from '@/app/ui/crew/leave-form'

export const metadata: Metadata = { title: 'My leave' }

export default async function CrewLeavePage() {
  const data = await getCrewDashboardData()
  const { myLeaveRequests, today, taken, totalLeaveDays } = data

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">My leave</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {totalLeaveDays} days a year, excluding public holidays.
        </p>
      </div>

      <LeaveForm
        existing={myLeaveRequests}
        today={today}
        taken={taken}
        totalLeaveDays={totalLeaveDays}
      />
    </div>
  )
}
