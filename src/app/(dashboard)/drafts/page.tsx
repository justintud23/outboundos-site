import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { DraftsClient } from './drafts-client'
import { getDrafts } from '@/features/drafts/server/get-drafts'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'

interface DraftsPageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function DraftsPage({ searchParams }: DraftsPageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const { drafts, total } = await getDrafts({
    organizationId: ctx.org.id,
    ownerId: ownerFilterFor(view, ctx.member.id),
  })

  return (
    <>
      <Header title="Drafts" />
      <div className="flex-1 p-6 lg:p-8">
        <DraftsClient initialDrafts={drafts} initialTotal={total} view={view} />
      </div>
    </>
  )
}
