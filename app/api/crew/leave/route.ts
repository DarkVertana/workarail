import { NextResponse } from 'next/server'
import { submitCrewLeaveRequest } from '@/app/actions/crew'
import { errorResponse } from '@/app/lib/errors'

/**
 * Submits leave for the signed-in employee.
 *
 * The request body no longer carries `days`: the deduction is recomputed
 * server-side from the dates, the working pattern and the holiday table, so a
 * caller cannot book a fortnight and declare it costs half a day.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Send a JSON body.', code: 'bad_request' },
        { status: 400 }
      )
    }

    const { type, from, to, reason, startAt, endAt } = body as Record<string, unknown>

    const result = await submitCrewLeaveRequest({
      type: String(type ?? ''),
      from: String(from ?? ''),
      to: String(to ?? ''),
      reason: reason === undefined ? undefined : String(reason),
      startAt: startAt === undefined ? undefined : String(startAt),
      endAt: endAt === undefined ? undefined : String(endAt),
    })

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error, code: 'validation' },
        { status: 422 }
      )
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/crew/leave')
  }
}
