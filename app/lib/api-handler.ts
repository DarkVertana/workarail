import { NextResponse } from 'next/server'

import { errorResponse, type ActionResult } from './errors'

/**
 * Wraps a route body so every endpoint reports failures the same way.
 *
 * These routes previously each carried `catch (error: any)` and returned
 * `error.message` with a 500, which turned Prisma and authorisation errors
 * into a 500 carrying internal detail. `errorResponse` maps known errors to
 * their real status and keeps the rest server-side.
 *
 * They also gated on `if (isStaff) return 403`, which admitted anyone who
 * merely had no staff record. Authorisation now belongs to the action being
 * called, so it is expressed once rather than restated per route.
 */
export async function handle<T>(
  context: string,
  fn: () => Promise<T>,
  init?: { status?: number },
): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(), { status: init?.status ?? 200 })
  } catch (err) {
    return errorResponse(err, context)
  }
}

/**
 * Same, for actions that return an `ActionResult` instead of throwing. A
 * rejected-but-valid request (a bad date, a duplicate name) is a 400, not a
 * 500, and the message is one the action chose to show a user.
 */
export async function handleAction<T>(
  context: string,
  fn: () => Promise<ActionResult<T>>,
  init?: { status?: number },
): Promise<NextResponse> {
  try {
    const result = await fn()
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 })
    }
    return NextResponse.json(result.data, { status: init?.status ?? 200 })
  } catch (err) {
    return errorResponse(err, context)
  }
}
