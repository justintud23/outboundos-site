import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { RepliesClient } from './replies-client'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function RepliesPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { replies, total } = await getReplies({ organizationId: org.id, limit: 200 })

  return (
    <>
      <Header title="Replies" />
      <div className="flex-1 p-6">
        <RepliesClient initialReplies={replies} initialTotal={total} />
      </div>
    </>
  )
}
