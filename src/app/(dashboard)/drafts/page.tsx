import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { DraftsClient } from './drafts-client'
import { getDrafts } from '@/features/drafts/server/get-drafts'

export default async function DraftsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const { drafts, total } = await getDrafts({ organizationId: orgId })

  return (
    <>
      <Header title="Drafts" />
      <div className="flex-1 p-6">
        <DraftsClient initialDrafts={drafts} initialTotal={total} />
      </div>
    </>
  )
}
