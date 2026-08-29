/**
 * Onboarding completeness rules.
 *
 * The behaviour that matters: an employee cannot be presented as `active`
 * while the evidence that makes employing them lawful is missing, and payroll
 * readiness is assessed separately from site readiness.
 */

import { describe, expect, it } from 'vitest'
import {
  onboardingStatus,
  canBecome,
  ONBOARDING_REQUIREMENTS,
  type OnboardingSubject,
} from '@/app/lib/onboarding'

const complete: OnboardingSubject = {
  dateOfBirth: new Date('1990-01-01'),
  addressLine1: '1 Beech Road',
  addressPostcode: 'DN1 2AB',
  emergencyContactName: 'Sam Reed',
  emergencyContactPhone: '07700 900000',
  niNumber: 'AB123456C',
  dayRatePence: 18_500,
  hasTaxCode: true,
  hasVerifiedBankAccount: true,
  validDocumentKinds: ['right_to_work', 'contract'],
}

describe('completeness', () => {
  it('reports a fully populated record as complete', () => {
    const status = onboardingStatus(complete)
    expect(status.complete).toBe(true)
    expect(status.payrollReady).toBe(true)
    expect(status.siteReady).toBe(true)
    expect(status.missing).toHaveLength(0)
  })

  it('lists exactly what is missing, with a reason', () => {
    const status = onboardingStatus({ ...complete, niNumber: null, hasTaxCode: false })
    expect(status.complete).toBe(false)
    expect(status.missing.map((m) => m.key).sort()).toEqual(['niNumber', 'taxCode'])
    for (const m of status.missing) expect(m.because).toBeTruthy()
  })

  it('treats a partial address as no address', () => {
    expect(
      onboardingStatus({ ...complete, addressPostcode: null }).missing.map((m) => m.key)
    ).toContain('address')
  })

  it('treats a contact name without a phone number as no emergency contact', () => {
    expect(
      onboardingStatus({ ...complete, emergencyContactPhone: null }).missing.map((m) => m.key)
    ).toContain('emergencyContact')
  })

  it('does not accept a zero pay rate as a pay rate', () => {
    expect(
      onboardingStatus({ ...complete, dayRatePence: 0 }).missing.map((m) => m.key)
    ).toContain('payRate')
  })
})

describe('payroll readiness is separate from site readiness', () => {
  it('is site-ready but not payroll-ready without verified bank details', () => {
    const status = onboardingStatus({ ...complete, hasVerifiedBankAccount: false })
    expect(status.siteReady).toBe(true)
    expect(status.payrollReady).toBe(false)
  })

  it('is payroll-ready but not site-ready without right-to-work evidence', () => {
    const status = onboardingStatus({ ...complete, validDocumentKinds: ['contract'] })
    expect(status.payrollReady).toBe(true)
    expect(status.siteReady).toBe(false)
  })

  it('does not count a document that is merely uploaded but not valid', () => {
    // `validDocumentKinds` carries only documents that passed review; an
    // uploaded-but-unchecked scan must not satisfy the requirement.
    const status = onboardingStatus({ ...complete, validDocumentKinds: [] })
    expect(status.siteReady).toBe(false)
    expect(status.missing.map((m) => m.key)).toEqual(
      expect.arrayContaining(['right_to_work', 'contract'])
    )
  })
})

describe('becoming active', () => {
  it('allows a complete record to become active', () => {
    expect(canBecome('active', onboardingStatus(complete)).allowed).toBe(true)
  })

  it('blocks active without right-to-work evidence, and explains why', () => {
    const gate = canBecome(
      'active',
      onboardingStatus({ ...complete, validDocumentKinds: ['contract'] })
    )
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain('right to work')
  })

  it('does NOT block active merely because bank details are unverified', () => {
    // Someone can legitimately start on site before finance has checked their
    // account. The payment itself is what gets blocked, not the employment.
    const gate = canBecome(
      'active',
      onboardingStatus({ ...complete, hasVerifiedBankAccount: false })
    )
    expect(gate.allowed).toBe(true)
  })

  it('places no requirements on any other status', () => {
    const empty = onboardingStatus({
      ...complete,
      niNumber: null,
      hasTaxCode: false,
      validDocumentKinds: [],
    })
    for (const status of ['onboarding', 'suspended', 'notice', 'leaver', 'archived'] as const) {
      expect(canBecome(status, empty).allowed).toBe(true)
    }
  })
})

describe('the requirement catalogue', () => {
  it('has a unique key and a stated reason for every requirement', () => {
    const keys = ONBOARDING_REQUIREMENTS.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of ONBOARDING_REQUIREMENTS) {
      expect(r.label).toBeTruthy()
      expect(r.because).toBeTruthy()
      expect(['identity', 'payroll', 'compliance']).toContain(r.group)
    }
  })
})
