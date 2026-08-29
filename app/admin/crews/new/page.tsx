import type { Metadata } from 'next'
import { getCrews } from '@/app/actions/admin'
import { StaffForm } from '@/app/ui/admin/staff-form'

export const metadata: Metadata = {
  title: 'Add staff member',
  description: 'Create a full employee record for Work à Rail.',
}

export default async function NewStaffPage() {
  const crews = await getCrews()
  return <StaffForm crews={crews} />
}
