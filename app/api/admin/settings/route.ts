import { getSettings, saveSettings } from '@/app/actions/admin'
import { handle, handleAction } from '@/app/lib/api-handler'

export const GET = () => handle('GET /api/admin/settings', getSettings)

/**
 * `saveSettings` applies a patch rather than replacing the document, so a
 * client sending one field no longer blanks the rest, and an omitted SMTP
 * password leaves the stored one intact.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  return handleAction('POST /api/admin/settings', () => saveSettings(body))
}
