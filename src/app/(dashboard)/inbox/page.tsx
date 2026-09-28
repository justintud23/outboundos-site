import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { InboxClient } from './inbox-client'
import { getInboxThreads } from '@/features/inbox/server/get-inbox-threads'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'

interface InboxPageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const { threads } = await getInboxThreads({
    organizationId: ctx.org.id,
    limit: 25,
    ownerId: ownerFilterFor(view, ctx.member.id),
  })

  return (
    <>
      <Header title="Inbox" />
      <div className="flex-1 overflow-hidden">
        <InboxClient initialThreads={threads} view={view} />
      </div>
    </>
  )
}
