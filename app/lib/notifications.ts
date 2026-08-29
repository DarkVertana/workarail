/**
 * Notification subsystem.
 *
 * The settings screen has long carried notifyLeave / notifyExpenses /
 * notifyPayroll switches with nothing behind them. This is the subsystem they
 * now control.
 *
 * Two rules shape the design:
 *
 *  1. Recipients are resolved from roles and ownership, never passed in by a
 *     caller, so nobody can be notified about a record they cannot open.
 *  2. Delivery happens *after* the database transaction commits. Queueing an
 *     email inside a transaction risks announcing something that then rolls
 *     back, which is the read-your-writes bug the old toasts had.
 */

import 'server-only'

import { prisma } from '@/app/lib/prisma'
import { sendEmail } from '@/app/lib/mail'
import { getSettings } from '@/app/lib/settings'
import { formatMoney } from '@/app/lib/invoices'
import type { NotificationType } from '@/generated/prisma'

type Recipient = { userId: string; email: string; name: string }

export type NotificationInput = {
  type: NotificationType
  title: string
  body: string
  actionUrl?: string
  entity?: string
  entityId?: string
  /** Also send an email, subject to the relevant settings toggle. */
  email?: boolean
}

/** Which settings switch, if any, governs a notification type. */
const TOGGLE: Partial<Record<NotificationType, string>> = {
  leave_submitted: 'notifyLeave',
  leave_decided: 'notifyLeave',
  expense_submitted: 'notifyExpenses',
  expense_decided: 'notifyExpenses',
  expense_reimbursed: 'notifyExpenses',
  payroll_ready: 'notifyPayroll',
  payslip_available: 'notifyPayroll',
}

async function isEnabled(type: NotificationType): Promise<boolean> {
  const toggle = TOGGLE[type]
  if (!toggle) return true
  const settings = await getSettings()
  return (settings as Record<string, unknown>)[toggle] !== false
}

// --- recipient resolution ---------------------------------------------------

/** The login attached to an employee, when there is one. */
async function userForStaff(staffRef: string): Promise<Recipient | null> {
  const staff = await prisma.staff.findUnique({
    where: { ref: staffRef },
    select: { user: { select: { id: true, email: true, name: true, isActive: true } } },
  })
  if (!staff?.user || !staff.user.isActive) return null
  return { userId: staff.user.id, email: staff.user.email, name: staff.user.name }
}

/** Everyone holding one of the given roles. */
async function usersWithRole(
  ...roles: Array<'ADMIN' | 'FINANCE' | 'MANAGER'>
): Promise<Recipient[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true, email: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, email: u.email, name: u.name }))
}

/**
 * Who should approve something for this employee: their line manager if they
 * have one, otherwise everyone who can approve.
 */
async function approversFor(staffRef: string): Promise<Recipient[]> {
  const staff = await prisma.staff.findUnique({
    where: { ref: staffRef },
    select: { managerRef: true },
  })

  if (staff?.managerRef) {
    const manager = await userForStaff(staff.managerRef)
    if (manager) return [manager]
  }
  return usersWithRole('ADMIN', 'MANAGER')
}

// --- delivery ---------------------------------------------------------------

async function deliver(recipients: Recipient[], input: NotificationInput) {
  if (recipients.length === 0) return
  if (!(await isEnabled(input.type))) return

  // Deduplicate: a manager who is also an admin should be told once.
  const unique = new Map(recipients.map((r) => [r.userId, r]))

  await prisma.notification.createMany({
    data: [...unique.values()].map((r) => ({
      userId: r.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl ?? null,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
    })),
  })

  if (!input.email) return

  // Email is best-effort and must never fail the calling operation.
  await Promise.allSettled(
    [...unique.values()].map((r) =>
      sendEmail({
        to: r.email,
        subject: input.title,
        html: emailBody(r.name, input),
      })
    )
  )
}

function emailBody(name: string, input: NotificationInput): string {
  const url = input.actionUrl
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1c1917">
      <p style="font-size:1.1rem;font-weight:700;color:#4f46e5;margin:0 0 24px">Work à Rail</p>
      <h2 style="font-size:1.05rem;margin:0 0 12px">${escapeHtml(input.title)}</h2>
      <p style="font-size:.875rem;line-height:1.6;color:#57534e;margin:0 0 20px">
        Hello ${escapeHtml(name)},<br />${escapeHtml(input.body)}
      </p>
      ${
        url
          ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff;font-size:.875rem;padding:10px 18px;border-radius:8px;text-decoration:none">Open in Work à Rail</a>`
          : ''
      }
    </div>`
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}

// --- public events ----------------------------------------------------------
//
// Each function names a business event rather than a delivery mechanism, so
// callers do not decide who hears about it.

export const notify = {
  async leaveSubmitted(staffRef: string, staffName: string, id: string, days: number) {
    await deliver(await approversFor(staffRef), {
      type: 'leave_submitted',
      title: 'Leave request awaiting approval',
      body: `${staffName} has requested ${days} day(s) of leave.`,
      actionUrl: '/admin/leaves',
      entity: 'LeaveRequest',
      entityId: id,
      email: true,
    })
  },

  async leaveDecided(staffRef: string, id: string, approved: boolean, note?: string) {
    const to = await userForStaff(staffRef)
    if (!to) return
    await deliver([to], {
      type: 'leave_decided',
      title: `Your leave request was ${approved ? 'approved' : 'declined'}`,
      body: note?.trim()
        ? `${approved ? 'Approved' : 'Declined'}: ${note.trim()}`
        : `Your leave request has been ${approved ? 'approved' : 'declined'}.`,
      actionUrl: '/crew/leave',
      entity: 'LeaveRequest',
      entityId: id,
      email: true,
    })
  },

  async expenseSubmitted(staffRef: string, staffName: string, id: string, amount: string) {
    await deliver(await approversFor(staffRef), {
      type: 'expense_submitted',
      title: 'Expense claim awaiting approval',
      body: `${staffName} submitted a claim for ${amount}.`,
      actionUrl: '/admin/expenses',
      entity: 'Expense',
      entityId: id,
      email: true,
    })
  },

  async expenseDecided(staffRef: string, id: string, decision: string, reason?: string) {
    const to = await userForStaff(staffRef)
    if (!to) return
    await deliver([to], {
      type: decision === 'reimbursed' ? 'expense_reimbursed' : 'expense_decided',
      title: `Your expense claim was ${decision}`,
      body: reason?.trim()
        ? `${decision}: ${reason.trim()}`
        : `Claim ${id} has been ${decision}.`,
      actionUrl: '/crew/expenses',
      entity: 'Expense',
      entityId: id,
      email: true,
    })
  },

  async timesheetSubmitted(staffRef: string, staffName: string, id: string, week: string) {
    await deliver(await approversFor(staffRef), {
      type: 'timesheet_submitted',
      title: 'Timesheet awaiting approval',
      body: `${staffName} submitted their timesheet for the week of ${week}.`,
      actionUrl: '/admin/timesheets',
      entity: 'Timesheet',
      entityId: id,
      email: false,
    })
  },

  async timesheetDecided(staffRef: string, id: string, approved: boolean, reason?: string) {
    const to = await userForStaff(staffRef)
    if (!to) return
    await deliver([to], {
      type: 'timesheet_decided',
      title: `Your timesheet was ${approved ? 'approved' : 'returned'}`,
      body: approved
        ? 'Your timesheet has been approved and locked for payroll.'
        : `Your timesheet was returned: ${reason ?? 'please review and resubmit.'}`,
      actionUrl: '/crew/timesheet',
      entity: 'Timesheet',
      entityId: id,
      email: true,
    })
  },

  async invoiceIssued(invoiceId: string, reference: string, amountPence: number) {
    await deliver(await usersWithRole('ADMIN', 'FINANCE'), {
      type: 'invoice_issued',
      title: 'Invoice issued',
      body: `Invoice ${reference} for ${formatMoney(amountPence)} has been issued and is now a receivable.`,
      actionUrl: '/finance/invoices',
      entity: 'Invoice',
      entityId: invoiceId,
      email: false,
    })
  },

  async invoiceOverdue(invoiceId: string, reference: string, daysOverdue: number) {
    await deliver(await usersWithRole('ADMIN', 'FINANCE'), {
      type: 'invoice_overdue',
      title: `Invoice ${reference} is ${daysOverdue} days overdue`,
      body: 'This invoice has passed its due date and has not been paid in full.',
      actionUrl: '/finance/invoices',
      entity: 'Invoice',
      entityId: invoiceId,
      email: false,
    })
  },

  async paymentReceived(invoiceId: string, reference: string, amount: string) {
    await deliver(await usersWithRole('ADMIN', 'FINANCE'), {
      type: 'payment_received',
      title: 'Payment received',
      body: `${amount} received against invoice ${reference}.`,
      actionUrl: '/finance/invoices',
      entity: 'Invoice',
      entityId: invoiceId,
      email: false,
    })
  },

  async payslipAvailable(staffRef: string, payrollId: string, period: string) {
    const to = await userForStaff(staffRef)
    if (!to) return
    await deliver([to], {
      type: 'payslip_available',
      title: `Your ${period} payslip is available`,
      body: `Your payslip for ${period} has been published.`,
      actionUrl: '/crew/payslips',
      entity: 'PayrollRecord',
      entityId: payrollId,
      email: true,
    })
  },

  async documentExpiring(staffRef: string, documentId: string, kind: string, days: number) {
    const owner = await userForStaff(staffRef)
    const admins = await usersWithRole('ADMIN')
    await deliver([...(owner ? [owner] : []), ...admins], {
      type: 'document_expiring',
      title: `${kind.replace(/_/g, ' ')} expires in ${days} days`,
      body: `A safety-critical document is due to expire in ${days} days and must be renewed.`,
      actionUrl: '/admin/crews',
      entity: 'StaffDocument',
      entityId: documentId,
      email: true,
    })
  },

  async roleChanged(userId: string, email: string, name: string, role: string) {
    await deliver([{ userId, email, name }], {
      type: 'role_changed',
      title: 'Your access level changed',
      body: `Your role in Work à Rail is now ${role}. If you did not expect this, contact your administrator.`,
      email: true,
    })
  },
}

// --- reads ------------------------------------------------------------------

export async function listNotifications(userId: string, take = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  })
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } })
}

/** Scoped by userId so one user cannot mark another's notification read. */
export async function markNotificationRead(userId: string, id: string) {
  await prisma.notification.updateMany({
    where: { id, userId },
    data: { readAt: new Date() },
  })
}
