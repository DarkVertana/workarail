import type { Metadata } from 'next'
import { CrewsTable } from '@/app/ui/admin/crews-table'
import { getJobs, getStaff } from '@/app/actions/admin'

export const metadata: Metadata = {
  title: 'Crews',
  description: 'Crew roster, assignments and contact details for Work à Rail.',
}

// The title and primary action live in the topbar (app/ui/admin/topbar.tsx).
export default async function CrewsPage() {
  const [staffData, jobs] = await Promise.all([getStaff(), getJobs()])
  const today = new Date().toISOString().split('T')[0]
  return <CrewsTable initialStaff={staffData} jobs={jobs} todayDate={today} />
}
