import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCrews, getStaffMember } from '@/app/actions/admin'
import { StaffForm } from '@/app/ui/admin/staff-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>
}): Promise<Metadata> {
  const { ref } = await params
  const staff = await getStaffMember(ref)
  return {
    title: staff ? `Edit ${staff.name}` : 'Edit staff member',
    description: 'Update an employee record for Work à Rail.',
  }
}

export default async function EditStaffPage({
  params,
}: {
  params: Promise<{ ref: string }>
}) {
  const { ref } = await params
  const [staff, crews] = await Promise.all([getStaffMember(ref), getCrews()])

  if (!staff) notFound()

  return <StaffForm crews={crews} staff={staff} />
}
