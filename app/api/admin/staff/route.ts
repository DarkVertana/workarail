import { addStaffMember, getStaff } from '@/app/actions/admin'
import { handle, handleAction } from '@/app/lib/api-handler'

export const GET = () => handle('GET /api/admin/staff', getStaff)

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  return handleAction('POST /api/admin/staff', () => addStaffMember(body), { status: 201 })
}
