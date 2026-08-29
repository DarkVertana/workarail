'use server'

/**
 * Server Actions for a user's own notification inbox.
 *
 * `listNotifications`, `unreadCount` and `markNotificationRead` already
 * existed in `app/lib/notifications.ts`, were correctly scoped by `userId`,
 * and were called from nowhere. `Notification.readAt` was never written and
 * the `[userId, readAt]` index served a query nobody made — notifications were
 * written to the database and were, in the product, invisible.
 *
 * Every action here derives the recipient from the session. A notification id
 * is never trusted on its own: the update is scoped by `userId` so passing
 * someone else's id marks nothing.
 */

import { revalidatePath } from 'next/cache'

import { requireActor } from '@/app/lib/authz'
import { prisma } from '@/app/lib/prisma'
import { actionFailed, actionOk, type ActionResult } from '@/app/lib/errors'
import {
  listNotifications,
  markNotificationRead,
  unreadCount,
} from '@/app/lib/notifications'

export type NotificationView = {
  id: string
  type: string
  title: string
  body: string
  actionUrl: string | null
  read: boolean
  createdAt: string
}

/** The signed-in user's notifications, newest first. */
export async function getMyNotifications(take = 30): Promise<NotificationView[]> {
  const actor = await requireActor()
  const rows = await listNotifications(actor.user.id, take)
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    actionUrl: n.actionUrl,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  }))
}

/** Unread count for the header badge. */
export async function getMyUnreadCount(): Promise<number> {
  const actor = await requireActor()
  return unreadCount(actor.user.id)
}

export async function markRead(id: string): Promise<ActionResult<null>> {
  try {
    const actor = await requireActor()
    await markNotificationRead(actor.user.id, id)
    revalidatePath('/crew')
    revalidatePath('/admin/dashboard')
    return actionOk(null)
  } catch (err) {
    return actionFailed(err, 'markRead')
  }
}

export async function markAllRead(): Promise<ActionResult<{ marked: number }>> {
  try {
    const actor = await requireActor()
    const result = await prisma.notification.updateMany({
      where: { userId: actor.user.id, readAt: null },
      data: { readAt: new Date() },
    })
    revalidatePath('/crew')
    revalidatePath('/admin/dashboard')
    return actionOk({ marked: result.count })
  } catch (err) {
    return actionFailed(err, 'markAllRead')
  }
}
