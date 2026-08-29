/**
 * Encryption at rest for stored credentials.
 *
 * Secrets such as the SMTP password used to be stored in plaintext, returned
 * by the settings API and rendered into the page as an input default value.
 * They are now sealed with AES-256-GCM under a key derived from
 * SECRET_ENCRYPTION_KEY and only ever opened server-side at the point of use.
 */

import crypto from 'crypto'
import { getEnv } from './env'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const SALT = 'workarail:secret:v1'

function key(): Buffer {
  // scryptSync with a fixed application salt: the key material is the env
  // secret, the salt only needs to domain-separate this use from others.
  return crypto.scryptSync(getEnv().SECRET_ENCRYPTION_KEY, SALT, 32)
}

/** Returns `v1:<iv>:<tag>:<ciphertext>`, all base64. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(sealed: string): string {
  const parts = sealed.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed sealed secret')
  }
  const [, iv, tag, data] = parts
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** Never let a sealed or plaintext secret reach a client by accident. */
export const REDACTED = '__redacted__' as const
