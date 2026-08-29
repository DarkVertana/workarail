import { NextResponse } from 'next/server'

import { getCrewDashboardData, saveCrewTimesheet } from '@/app/actions/crew'
import { errorResponse } from '@/app/lib/errors'

/**
 * The actions below resolve the caller from the session and authorise
 * themselves, so this route no longer repeats a role check that could drift
 * out of step with them. Failures go through `errorResponse`, which maps known
 * errors to real status codes and keeps raw messages (previously echoed
 * straight from Prisma with a 500) server-side.
 */

export async function GET() {
  try {
    const data = await getCrewDashboardData()
    return NextResponse.json({
      today: data.today,
      attendanceWeek: data.attendanceWeek,
      codes: data.codes,
      hours: data.hours,
    })
  } catch (err) {
    return errorResponse(err, 'GET /api/crew/timesheet')
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { codes } = body
    if (!Array.isArray(codes)) {
      return NextResponse.json(
        { error: "Invalid request body: 'codes' must be an array." },
        { status: 400 },
      )
    }

    const result = await saveCrewTimesheet(codes)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    return errorResponse(err, 'POST /api/crew/timesheet')
  }
}
