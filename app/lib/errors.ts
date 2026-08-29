/**
 * Error translation.
 *
 * Every route used to echo `error.message` straight to the client, which
 * leaked Prisma model names, column names and constraint names, while logging
 * nothing server-side. This module inverts that: the client gets a safe,
 * actionable sentence and a stable code; the technical detail is logged.
 */

import { NextResponse } from 'next/server'
import { AuthError } from './authz'

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 = 400,
    readonly code: string = 'bad_request',
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const BadRequest = (m: string, details?: unknown) =>
  new AppError(m, 400, 'bad_request', details)
export const NotFound = (m = 'That record no longer exists.') =>
  new AppError(m, 404, 'not_found')
export const Conflict = (m: string) => new AppError(m, 409, 'conflict')
export const Unprocessable = (m: string, details?: unknown) =>
  new AppError(m, 422, 'unprocessable', details)

type Safe = {
  message: string
  status: number
  code: string
  details?: unknown
}

/** Prisma error codes that map to a meaningful user-facing message. */
function fromPrisma(err: { code?: string; meta?: Record<string, unknown> }): Safe | null {
  const target = Array.isArray(err.meta?.target)
    ? (err.meta.target as string[]).join(', ')
    : String(err.meta?.target ?? '')

  switch (err.code) {
    case 'P2002':
      return {
        message: friendlyUnique(target),
        status: 409,
        code: 'conflict',
      }
    case 'P2003':
      return {
        message:
          'That references something that does not exist, or is still in use elsewhere.',
        status: 409,
        code: 'foreign_key',
      }
    case 'P2025':
      return {
        message: 'That record no longer exists.',
        status: 404,
        code: 'not_found',
      }
    case 'P2000':
      return {
        message: 'One of the values is too long.',
        status: 400,
        code: 'too_long',
      }
    default:
      return null
  }
}

function friendlyUnique(target: string): string {
  if (target.includes('email')) return 'That email address is already registered.'
  if (target.includes('reference')) return 'That reference is already in use.'
  if (target.includes('nameKey') || target.includes('name'))
    return 'Something with that name already exists.'
  if (target.includes('staffRef') && target.includes('date'))
    return 'There is already an entry for that person on that date.'
  if (target.includes('year') && target.includes('month'))
    return 'A payroll record already exists for that person and period.'
  return 'That value is already in use.'
}

/**
 * Converts any thrown value into something safe to return, and logs the
 * original with a correlation id so the two can be tied together.
 */
export function toSafeError(err: unknown, context: string): Safe {
  const correlationId = Math.random().toString(36).slice(2, 10)

  if (err instanceof AuthError) {
    return { message: err.message, status: err.status, code: err.code }
  }

  if (err instanceof AppError) {
    return {
      message: err.message,
      status: err.status,
      code: err.code,
      details: err.details,
    }
  }

  // Postgres CHECK / EXCLUDE constraints surface as raw driver errors.
  const raw = err as { code?: string; message?: string; meta?: Record<string, unknown> }
  if (raw?.code === '23514' || raw?.message?.includes('violates check constraint')) {
    console.error(`[${context}] check constraint violated (${correlationId})`, err)
    return {
      message: 'Those values are not allowed. Please review and try again.',
      status: 422,
      code: 'constraint',
    }
  }
  if (
    raw?.code === '23P01' ||
    raw?.message?.includes('conflicting key value violates exclusion constraint')
  ) {
    console.error(`[${context}] exclusion constraint violated (${correlationId})`, err)
    return {
      message: 'That overlaps an existing record for the same person.',
      status: 409,
      code: 'overlap',
    }
  }

  if (raw?.code?.startsWith('P2')) {
    const mapped = fromPrisma(raw)
    if (mapped) {
      console.error(`[${context}] prisma ${raw.code} (${correlationId})`, err)
      return mapped
    }
  }

  console.error(`[${context}] unhandled error (${correlationId})`, err)
  return {
    message: `Something went wrong. Quote reference ${correlationId} if you need to report it.`,
    status: 500,
    code: 'internal',
  }
}

/** Standard JSON error envelope for API routes. */
export function errorResponse(err: unknown, context: string) {
  const safe = toSafeError(err, context)
  return NextResponse.json(
    { error: safe.message, code: safe.code, details: safe.details },
    { status: safe.status }
  )
}

/**
 * Result shape Server Actions return to client components, so a form can
 * distinguish "rejected for a reason you can fix" from "it worked".
 */
export type ActionFailure = {
  ok: false
  error: string
  code: string
  details?: unknown
}

export type ActionResult<T = undefined> = { ok: true; data: T } | ActionFailure

export function actionOk(): ActionResult<undefined>
export function actionOk<T>(data: T): ActionResult<T>
export function actionOk<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data }
}

export function actionFailed(err: unknown, context: string): ActionFailure {
  const safe = toSafeError(err, context)
  return {
    ok: false,
    error: safe.message,
    code: safe.code,
    details: safe.details,
  }
}
