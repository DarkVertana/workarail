import { getExpenses } from '@/app/actions/admin'
import { handle } from '@/app/lib/api-handler'

export const GET = () => handle('GET /api/admin/expenses', getExpenses)
