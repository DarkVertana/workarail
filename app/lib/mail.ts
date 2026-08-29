import 'server-only'

import nodemailer from 'nodemailer'
import { getSmtpCredentials } from './settings'

export interface SendEmailArgs {
  to: string
  subject: string
  html: string
}

/**
 * Sends mail using the credentials held in the settings store, falling back to
 * environment variables when the store has not been configured.
 *
 * Returns whether the message was actually handed to a mail server, so callers
 * can tell the difference between "sent" and "silently dropped because SMTP is
 * not configured" — previously both looked identical to the caller.
 */
export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<boolean> {
  const stored = await getSmtpCredentials()

  const host = stored?.host ?? process.env.SMTP_HOST ?? ''
  const port = stored?.port ?? Number(process.env.SMTP_PORT) ?? 587
  const user = stored?.user ?? process.env.SMTP_USER ?? ''
  const pass = stored?.pass ?? process.env.SMTP_PASS ?? ''
  const from = stored?.from ?? process.env.SMTP_FROM ?? 'noreply@workarail.com'

  if (!host || !user || !pass) {
    console.warn('[mail] SMTP is not configured; message not sent', { to, subject })
    return false
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      // Implicit TLS on 465; STARTTLS on 587 and friends.
      secure: port === 465,
      auth: { user, pass },
    })

    const fromName = process.env.SMTP_FROM_NAME || 'Work à Rail'
    await transporter.sendMail({
      from: `"${fromName}" <${from}>`,
      to,
      subject,
      html,
    })
    return true
  } catch (err) {
    console.error('[mail] delivery failed', { to, subject, err })
    return false
  }
}
