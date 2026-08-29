import { NextResponse } from 'next/server'

import { getCrewDashboardData } from '@/app/actions/crew'
import { errorResponse } from '@/app/lib/errors'

export async function GET() {
  try {
    return NextResponse.json(await getCrewDashboardData())
  } catch (err) {
    return errorResponse(err, 'GET /api/crew/dashboard')
  }
}
