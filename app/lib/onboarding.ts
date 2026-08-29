/**
 * What "onboarded" actually means.
 *
 * The application previously let an employee be created as `active`
 * immediately, with no tax code, no payment details and no right-to-work
 * evidence. That record looks complete in the UI and then fails at the point
 * it matters: payroll cannot pay them, and the business cannot show it checked
 * their right to work.
 *
 * This module is the single definition of what has to be true before someone
 * is genuinely employable, so the staff form, the employment-status
 * transition and the payroll run all agree.
 *
 * The requirements are deliberately split:
 *
 *   identity    — needed to have a personnel record at all
 *   payroll     — needed before anyone can be paid
 *   compliance  — needed before anyone can go on site
 *
 * A record can be complete for one and not another, which is exactly the
 * situation on a real first day: someone can start work on site before their
 * bank details have been verified, but they cannot be paid.
 */

import type { DocumentKind, EmploymentStatus } from '@/generated/prisma'

export type OnboardingRequirement = {
  key: string
  label: string
  group: 'identity' | 'payroll' | 'compliance'
  /** Why it is required, shown to whoever has to go and collect it. */
  because: string
}

export const ONBOARDING_REQUIREMENTS: OnboardingRequirement[] = [
  {
    key: 'dateOfBirth',
    label: 'Date of birth',
    group: 'identity',
    because: 'Sets the NI category and the age band for medicals.',
  },
  {
    key: 'address',
    label: 'Home address',
    group: 'identity',
    because: 'Required on the payroll record and for HMRC reporting.',
  },
  {
    key: 'emergencyContact',
    label: 'Emergency contact',
    group: 'identity',
    because: 'Required before anyone works on or near the line.',
  },
  {
    key: 'niNumber',
    label: 'National Insurance number',
    group: 'payroll',
    because: 'Without it HMRC cannot match the employee to their record.',
  },
  {
    key: 'taxCode',
    label: 'Tax code',
    group: 'payroll',
    because: 'PAYE cannot be calculated without one.',
  },
  {
    key: 'bankAccount',
    label: 'Verified bank details',
    group: 'payroll',
    because: 'Net pay cannot be sent, and unverified details are a fraud risk.',
  },
  {
    key: 'payRate',
    label: 'Pay rate',
    group: 'payroll',
    because: 'Gross pay cannot be calculated without one.',
  },
  {
    key: 'right_to_work',
    label: 'Right to work evidence',
    group: 'compliance',
    because: 'Employing someone without it is a civil penalty.',
  },
  {
    key: 'contract',
    label: 'Signed contract',
    group: 'compliance',
    because: 'Sets the terms the employment relies on.',
  },
]

/** The shape the check needs. Kept structural so callers can select narrowly. */
export type OnboardingSubject = {
  dateOfBirth: Date | null
  addressLine1: string | null
  addressPostcode: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  niNumber: string | null
  dayRatePence: number | null
  /** Any PAYE profile effective now. */
  hasTaxCode: boolean
  /** A primary bank account that has been verified. */
  hasVerifiedBankAccount: boolean
  /** Document kinds present and not rejected or expired. */
  validDocumentKinds: DocumentKind[]
}

export type OnboardingStatus = {
  complete: boolean
  /** Complete enough to be paid. */
  payrollReady: boolean
  /** Complete enough to be rostered on site. */
  siteReady: boolean
  missing: OnboardingRequirement[]
}

export function onboardingStatus(subject: OnboardingSubject): OnboardingStatus {
  const has: Record<string, boolean> = {
    dateOfBirth: subject.dateOfBirth !== null,
    address: Boolean(subject.addressLine1 && subject.addressPostcode),
    emergencyContact: Boolean(
      subject.emergencyContactName && subject.emergencyContactPhone
    ),
    niNumber: Boolean(subject.niNumber),
    taxCode: subject.hasTaxCode,
    bankAccount: subject.hasVerifiedBankAccount,
    payRate: subject.dayRatePence !== null && subject.dayRatePence > 0,
    right_to_work: subject.validDocumentKinds.includes('right_to_work'),
    contract: subject.validDocumentKinds.includes('contract'),
  }

  const missing = ONBOARDING_REQUIREMENTS.filter((r) => !has[r.key])

  return {
    complete: missing.length === 0,
    payrollReady: !missing.some((r) => r.group === 'payroll'),
    siteReady: !missing.some((r) => r.group === 'compliance'),
    missing,
  }
}

/**
 * Whether an employee may be moved into a given employment status.
 *
 * `active` is the gate that matters: it is the status that puts someone on a
 * roster and into a pay run, so it requires the compliance evidence. Payroll
 * completeness is deliberately NOT required here — someone can legitimately
 * start work while their bank details are still being verified — and is
 * enforced separately at the point of payment instead.
 */
export function canBecome(
  status: EmploymentStatus,
  onboarding: OnboardingStatus
): { allowed: boolean; reason?: string } {
  if (status !== 'active') return { allowed: true }

  const blocking = onboarding.missing.filter(
    (r) => r.group === 'compliance' || r.group === 'identity'
  )
  if (blocking.length === 0) return { allowed: true }

  return {
    allowed: false,
    reason:
      'This employee cannot be made active until the following is on file: ' +
      blocking.map((r) => r.label.toLowerCase()).join(', ') + '.',
  }
}
