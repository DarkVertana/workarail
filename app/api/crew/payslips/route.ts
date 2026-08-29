import { NextResponse } from 'next/server'

import { getPayslips } from '@/app/actions/crew'
import { errorResponse } from '@/app/lib/errors'

/**
 * Delegates to the action rather than querying PayrollRecord directly, so the
 * ownership check and field selection live in one place. The previous version
 * returned whole payroll rows, including columns the crew view never needs.
 */
export async function GET() {
  try {
    return NextResponse.json(await getPayslips())
  } catch (err) {
    return errorResponse(err, 'GET /api/crew/payslips')
  }
}
