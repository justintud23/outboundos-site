import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { RepliesClient } from './replies-client'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'

interface RepliesPageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function RepliesPage({ searchParams }: RepliesPageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const { replies, total } = await getReplies({
    organizationId: ctx.org.id,
    limit: 200,
    ownerId: ownerFilterFor(view, ctx.member.id),
  })

  return (
    <>
      <Header title="Replies" />
      <div className="flex-1 p-6 lg:p-8">
        <RepliesClient initialReplies={replies} initialTotal={total} view={view} />
      </div>
    </>
  )
}
