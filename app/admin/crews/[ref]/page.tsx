import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getJobs, getStaffMember } from '@/app/actions/admin'
import { StaffProfile } from '@/app/ui/admin/staff-profile'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>
}): Promise<Metadata> {
  const { ref } = await params
  const staff = await getStaffMember(ref)
  return {
    title: staff ? staff.name : 'Staff member',
    description: staff
      ? `Employee file for ${staff.name} (${staff.ref}).`
      : 'Employee file.',
  }
}

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ ref: string }>
}) {
  const { ref } = await params
  const [staff, jobs] = await Promise.all([getStaffMember(ref), getJobs()])

  if (!staff) notFound()

  return (
    <div className="flex w-full flex-col gap-5">
      <Link
        href="/admin/crews"
        className="text-sm font-medium text-indigo-600 hover:underline"
      >
        ← Back to crews
      </Link>
      <StaffProfile staff={staff} jobs={jobs} />
    </div>
  )
}
