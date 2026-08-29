/**
 * UK bank detail handling: validation, encryption at rest, and masking.
 *
 * Account numbers and sort codes are encrypted with AES-256-GCM under a
 * separate key derivation from other application secrets, so compromising one
 * does not expose the other. Nothing in this module returns a decrypted
 * account number to a caller that has not explicitly asked for it, and the
 * only value intended for display is the mask.
 *
 * The plaintext never appears in an audit payload. Audit entries record that a
 * change happened and what the mask became, which is enough to answer "who
 * changed these details and when" without the log itself becoming a target.
 */

import crypto from 'crypto'
import { getEnv } from './env'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
/** Domain-separated from `secrets.ts` so the two uses cannot share a key. */
const SALT = 'workarail:bank:v1'

function key(): Buffer {
  return crypto.scryptSync(getEnv().SECRET_ENCRYPTION_KEY, SALT, 32)
}

export function encryptBankValue(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptBankValue(sealed: string): string {
  const parts = sealed.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed sealed bank value')
  }
  const [, iv, tag, data] = parts
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class InvalidBankDetailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBankDetailError'
  }
}

/** Strips spaces and hyphens, which people type inconsistently. */
export function normaliseDigits(value: string): string {
  return value.replace(/[\s-]/g, '')
}

/**
 * A UK sort code is exactly six digits, conventionally written 12-34-56.
 *
 * Note this checks *shape* only. Confirming that a sort code and account
 * number pair actually exists needs HMRC/Vocalink modulus checking against
 * their published weighting table, which is out of scope — hence the
 * `verifiedAt` field, which records a human having checked.
 */
export function normaliseSortCode(raw: string): string {
  const digits = normaliseDigits(raw)
  if (!/^\d{6}$/.test(digits)) {
    throw new InvalidBankDetailError('A sort code must be six digits, like 12-34-56.')
  }
  return digits
}

/** UK account numbers are 8 digits. Shorter ones are zero-padded by the bank. */
export function normaliseAccountNumber(raw: string): string {
  const digits = normaliseDigits(raw)
  if (!/^\d{6,8}$/.test(digits)) {
    throw new InvalidBankDetailError('An account number must be 8 digits.')
  }
  return digits.padStart(8, '0')
}

/**
 * IBANs are 15-34 alphanumeric characters starting with a country code.
 * Validated with the ISO 7064 mod-97 check, which catches transcription errors.
 */
export function normaliseIban(raw: string): string {
  const value = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) {
    throw new InvalidBankDetailError('That does not look like a valid IBAN.')
  }
  // Move the first four characters to the end, convert letters to numbers,
  // then the whole thing modulo 97 must equal 1.
  const rearranged = value.slice(4) + value.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let remainder = 0
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97
  if (remainder !== 1) {
    throw new InvalidBankDetailError('That IBAN failed its checksum — please re-check it.')
  }
  return value
}

/** BIC/SWIFT: 8 or 11 characters. */
export function normaliseBic(raw: string): string {
  const value = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value)) {
    throw new InvalidBankDetailError('That does not look like a valid BIC/SWIFT code.')
  }
  return value
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/** "****5678" — the only account representation that may reach a browser. */
export function maskAccountNumber(last4: string): string {
  return `****${last4}`
}

/** "**-**-56" — enough to distinguish two accounts, not enough to pay one. */
export function maskSortCode(last2: string): string {
  return `**-**-${last2}`
}

export function maskIban(last4: string): string {
  return `••••${last4}`
}

/**
 * Turns user input into the columns `StaffBankAccount` stores.
 *
 * Returns the encrypted values plus the short plaintext tails used for
 * display. The caller never handles the raw digits again.
 */
export function prepareBankAccount(input: {
  method: 'bacs' | 'international'
  accountNumber?: string
  sortCode?: string
  iban?: string
  bic?: string
}) {
  if (input.method === 'international') {
    if (!input.iban) {
      throw new InvalidBankDetailError('An international payment needs an IBAN.')
    }
    const iban = normaliseIban(input.iban)
    const bic = input.bic ? normaliseBic(input.bic) : null

    // An IBAN embeds the domestic account details, so the BACS columns are
    // filled from its tail rather than left blank — the schema requires them
    // and the mask stays meaningful.
    return {
      accountNumberEnc: encryptBankValue(iban.slice(-8)),
      sortCodeEnc: encryptBankValue(iban.slice(4, 10)),
      accountLast4: iban.slice(-4),
      sortCodeLast2: iban.slice(-2),
      ibanEnc: encryptBankValue(iban),
      bicEnc: bic ? encryptBankValue(bic) : null,
      ibanLast4: iban.slice(-4),
    }
  }

  if (!input.accountNumber || !input.sortCode) {
    throw new InvalidBankDetailError(
      'A UK payment needs both a sort code and an account number.'
    )
  }
  const accountNumber = normaliseAccountNumber(input.accountNumber)
  const sortCode = normaliseSortCode(input.sortCode)

  return {
    accountNumberEnc: encryptBankValue(accountNumber),
    sortCodeEnc: encryptBankValue(sortCode),
    accountLast4: accountNumber.slice(-4),
    sortCodeLast2: sortCode.slice(-2),
    ibanEnc: null,
    bicEnc: null,
    ibanLast4: null,
  }
}

/** The safe projection: everything needed to render, nothing needed to pay. */
export const BANK_ACCOUNT_DISPLAY_SELECT = {
  id: true,
  staffRef: true,
  accountHolderName: true,
  bankName: true,
  method: true,
  accountLast4: true,
  sortCodeLast2: true,
  ibanLast4: true,
  isPrimary: true,
  effectiveFrom: true,
  effectiveTo: true,
  verifiedAt: true,
  createdAt: true,
} as const

export type BankAccountDisplay = {
  id: string
  staffRef: string
  accountHolderName: string
  bankName: string | null
  method: 'bacs' | 'international'
  accountMask: string
  sortCodeMask: string
  isPrimary: boolean
  verified: boolean
  effectiveFrom: string
  effectiveTo: string | null
}

/** Maps a stored row to the masked shape a client may receive. */
export function toDisplay(row: {
  id: string
  staffRef: string
  accountHolderName: string
  bankName: string | null
  method: 'bacs' | 'international'
  accountLast4: string
  sortCodeLast2: string
  ibanLast4: string | null
  isPrimary: boolean
  verifiedAt: Date | null
  effectiveFrom: Date
  effectiveTo: Date | null
}): BankAccountDisplay {
  return {
    id: row.id,
    staffRef: row.staffRef,
    accountHolderName: row.accountHolderName,
    bankName: row.bankName,
    method: row.method,
    accountMask:
      row.method === 'international' && row.ibanLast4
        ? maskIban(row.ibanLast4)
        : maskAccountNumber(row.accountLast4),
    sortCodeMask: maskSortCode(row.sortCodeLast2),
    isPrimary: row.isPrimary,
    verified: row.verifiedAt !== null,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
  }
}
