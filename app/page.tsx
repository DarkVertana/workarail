import { redirect } from 'next/navigation'
import { getActor } from '@/app/lib/authz'
import { landingPathFor } from '@/app/actions/auth'

/**
 * Session-based entry point. The landing area is chosen from the user's
 * explicit role — never inferred from whether a Staff row happens to exist.
 */
export default async function Home() {
  const actor = await getActor()
  if (!actor) redirect('/signin')
  redirect(await landingPathFor(actor.user.role))
}
