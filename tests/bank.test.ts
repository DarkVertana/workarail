/**
 * Bank detail handling: validation, encryption, masking.
 *
 * The security property under test is that nothing which could be used to
 * make a payment survives in plaintext, and that the display shape carries no
 * recoverable account number.
 */

import { describe, expect, it } from 'vitest'

// Set before the dynamic import below: `app/lib/env` validates the whole
// environment at module load, so these have to exist first.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'
process.env.APP_URL ??= 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET ??= 'test-secret-value-that-is-long-enough-000'
process.env.SECRET_ENCRYPTION_KEY ??= 'test-encryption-key-that-is-long-enough-0'

const {
  encryptBankValue,
  decryptBankValue,
  normaliseSortCode,
  normaliseAccountNumber,
  normaliseIban,
  normaliseBic,
  maskAccountNumber,
  maskSortCode,
  prepareBankAccount,
  toDisplay,
  InvalidBankDetailError,
} = await import('@/app/lib/bank')

describe('encryption', () => {
  it('round-trips a value', () => {
    const sealed = encryptBankValue('12345678')
    expect(decryptBankValue(sealed)).toBe('12345678')
  })

  it('never stores the plaintext in the ciphertext', () => {
    const sealed = encryptBankValue('12345678')
    expect(sealed).not.toContain('12345678')
    expect(sealed.startsWith('v1:')).toBe(true)
  })

  it('produces a different ciphertext each time, so equal accounts are not linkable', () => {
    expect(encryptBankValue('12345678')).not.toBe(encryptBankValue('12345678'))
  })

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const sealed = encryptBankValue('12345678')
    const parts = sealed.split(':')
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('evil').toString('base64')}`
    expect(() => decryptBankValue(tampered)).toThrow()
  })

  it('rejects a malformed envelope', () => {
    expect(() => decryptBankValue('nonsense')).toThrow('Malformed sealed bank value')
  })
})

describe('sort code and account number validation', () => {
  it('accepts a sort code however it is punctuated', () => {
    expect(normaliseSortCode('12-34-56')).toBe('123456')
    expect(normaliseSortCode('12 34 56')).toBe('123456')
    expect(normaliseSortCode('123456')).toBe('123456')
  })

  it('rejects a sort code that is not six digits', () => {
    expect(() => normaliseSortCode('12345')).toThrow(InvalidBankDetailError)
    expect(() => normaliseSortCode('1234567')).toThrow(InvalidBankDetailError)
    expect(() => normaliseSortCode('AB-CD-EF')).toThrow(InvalidBankDetailError)
  })

  it('pads a short account number to eight digits, as banks do', () => {
    expect(normaliseAccountNumber('123456')).toBe('00123456')
    expect(normaliseAccountNumber('12345678')).toBe('12345678')
  })

  it('rejects an account number that is too long', () => {
    expect(() => normaliseAccountNumber('123456789')).toThrow(InvalidBankDetailError)
  })
})

describe('IBAN and BIC validation', () => {
  it('accepts a valid IBAN and normalises spacing', () => {
    expect(normaliseIban('GB33 BUKB 2020 1555 5555 55')).toBe('GB33BUKB20201555555555')
  })

  it('rejects an IBAN that fails its mod-97 checksum', () => {
    // A single transposed digit, which is exactly what the checksum exists to catch.
    expect(() => normaliseIban('GB33BUKB20201555555556')).toThrow(InvalidBankDetailError)
  })

  it('rejects a structurally invalid IBAN', () => {
    expect(() => normaliseIban('NOTANIBAN')).toThrow(InvalidBankDetailError)
  })

  it('accepts 8 and 11 character BICs', () => {
    expect(normaliseBic('BUKBGB22')).toBe('BUKBGB22')
    expect(normaliseBic('bukbgb22xxx')).toBe('BUKBGB22XXX')
    expect(() => normaliseBic('SHORT')).toThrow(InvalidBankDetailError)
  })
})

describe('masking', () => {
  it('reveals only the last four digits of an account', () => {
    expect(maskAccountNumber('5678')).toBe('****5678')
  })

  it('reveals only the last two digits of a sort code', () => {
    expect(maskSortCode('56')).toBe('**-**-56')
  })
})

describe('prepareBankAccount', () => {
  it('encrypts both values and keeps only short tails in the clear', () => {
    const prepared = prepareBankAccount({
      method: 'bacs',
      accountNumber: '12345678',
      sortCode: '12-34-56',
    })

    expect(prepared.accountLast4).toBe('5678')
    expect(prepared.sortCodeLast2).toBe('56')
    expect(prepared.accountNumberEnc).not.toContain('12345678')
    expect(prepared.sortCodeEnc).not.toContain('123456')
    expect(decryptBankValue(prepared.accountNumberEnc)).toBe('12345678')
    expect(decryptBankValue(prepared.sortCodeEnc)).toBe('123456')
  })

  it('refuses a UK account missing either half', () => {
    expect(() =>
      prepareBankAccount({ method: 'bacs', accountNumber: '12345678' })
    ).toThrow(InvalidBankDetailError)
    expect(() =>
      prepareBankAccount({ method: 'bacs', sortCode: '123456' })
    ).toThrow(InvalidBankDetailError)
  })

  it('requires an IBAN for an international payment', () => {
    expect(() => prepareBankAccount({ method: 'international' })).toThrow(
      InvalidBankDetailError
    )
  })

  it('encrypts the IBAN and still populates the masked columns', () => {
    const prepared = prepareBankAccount({
      method: 'international',
      iban: 'GB33BUKB20201555555555',
      bic: 'BUKBGB22',
    })
    expect(prepared.ibanEnc).not.toBeNull()
    expect(prepared.ibanEnc).not.toContain('GB33BUKB')
    expect(prepared.ibanLast4).toBe('5555')
    // The schema requires these, so an international row must still fill them.
    expect(prepared.accountLast4).toHaveLength(4)
    expect(prepared.sortCodeLast2).toHaveLength(2)
  })
})

describe('display projection', () => {
  const row = {
    id: 'acc-1',
    staffRef: 'WR-010',
    accountHolderName: 'Jordan Vale',
    bankName: 'Barclays',
    method: 'bacs' as const,
    accountLast4: '5678',
    sortCodeLast2: '56',
    ibanLast4: null,
    isPrimary: true,
    verifiedAt: null,
    effectiveFrom: new Date('2026-04-06T00:00:00Z'),
    effectiveTo: null,
  }

  it('carries no field from which an account number could be reconstructed', () => {
    const display = toDisplay(row)
    const serialised = JSON.stringify(display)

    expect(serialised).not.toContain('Enc')
    expect(serialised).not.toContain('accountNumber')
    expect(display.accountMask).toBe('****5678')
    expect(display.sortCodeMask).toBe('**-**-56')
  })

  it('reports an unverified account as unverified', () => {
    expect(toDisplay(row).verified).toBe(false)
    expect(toDisplay({ ...row, verifiedAt: new Date() }).verified).toBe(true)
  })
})
