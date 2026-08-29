import { addInvoice, getInvoices } from '@/app/actions/admin'
import { handle, handleAction } from '@/app/lib/api-handler'

export const GET = () => handle('GET /api/admin/invoices', getInvoices)

/**
 * The body is passed through untouched: `addInvoice` validates it against the
 * invoice schema. The hand-rolled presence checks that used to live here
 * accepted shapes the action then rejected, and rejected some it accepts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  return handleAction('POST /api/admin/invoices', () => addInvoice(body), { status: 201 })
}
