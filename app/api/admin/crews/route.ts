import { addCrew, getCrews } from '@/app/actions/admin'
import { handle, handleAction } from '@/app/lib/api-handler'

export const GET = () => handle('GET /api/admin/crews', getCrews)

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  return handleAction(
    'POST /api/admin/crews',
    () => addCrew(body?.name),
    { status: 201 },
  )
}
