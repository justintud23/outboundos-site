import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { InboxClient } from './inbox-client'
import { getInboxThreads } from '@/features/inbox/server/get-inbox-threads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function InboxPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { threads, total } = await getInboxThreads({ organizationId: org.id, limit: 25 })

  return (
    <>
      <Header title="Inbox" />
      <div className="flex-1 overflow-hidden">
        <InboxClient initialThreads={threads} initialTotal={total} />
      </div>
    </>
  )
}
