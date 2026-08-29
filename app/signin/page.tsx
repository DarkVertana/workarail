import type { Metadata } from 'next'
import { AuthShell } from '@/app/ui/auth-shell'
import { SignInForm } from '@/app/ui/signin-form'
import { redirect } from 'next/navigation'
import { getActor } from '@/app/lib/authz'
import { landingPathFor } from '@/app/actions/auth'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Work à Rail account.',
}

interface PageProps {
  searchParams: Promise<{ reset?: string }>
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams
  const resetSuccess = params.reset === 'success'

  // An already-signed-in visitor goes to the area their role entitles them to.
  const actor = await getActor()
  if (actor) {
    redirect(await landingPathFor(actor.user.role))
  }

  return (
    <AuthShell
      title="Sign in to Work à Rail"
      subtitle={resetSuccess ? "Password updated. Enter your details to continue." : "Welcome back. Enter your details to continue."}
    >
      <SignInForm resetSuccess={resetSuccess} />
    </AuthShell>
  )
}
