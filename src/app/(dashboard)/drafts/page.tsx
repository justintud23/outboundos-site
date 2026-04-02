import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { DraftsClient } from './drafts-client'
import { getDrafts } from '@/features/drafts/server/get-drafts'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function DraftsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { drafts, total } = await getDrafts({ organizationId: org.id })

  return (
    <>
      <Header title="Drafts" />
      <div className="flex-1 p-6">
        <DraftsClient initialDrafts={drafts} initialTotal={total} />
      </div>
    </>
  )
}
