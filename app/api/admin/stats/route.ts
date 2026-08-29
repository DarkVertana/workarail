import { NextResponse } from 'next/server'

import { getDashboardStats } from '@/app/actions/admin'
import { errorResponse } from '@/app/lib/errors'

/**
 * The check here used to be `if (isStaff) return 403`, which granted the stats
 * to anyone who merely lacked a staff record. `getDashboardStats` requires an
 * explicit privileged role instead.
 */
export async function GET() {
  try {
    return NextResponse.json(await getDashboardStats())
  } catch (err) {
    return errorResponse(err, 'GET /api/admin/stats')
  }
}
