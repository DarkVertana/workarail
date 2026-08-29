import { NextResponse } from 'next/server'

import { submitCrewExpense } from '@/app/actions/crew'
import { errorResponse } from '@/app/lib/errors'

/**
 * Field-presence checks used to live here and duplicated (imperfectly) what
 * the action validates. The action owns validation and authorisation now; this
 * route only translates the outcome into HTTP.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await submitCrewExpense(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 })
    }
    return NextResponse.json(result.data, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/crew/expenses')
  }
}
