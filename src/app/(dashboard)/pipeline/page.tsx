import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PipelineClient } from './pipeline-client'
import { getPipelineLeads } from '@/features/leads/server/get-pipeline-leads'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'

interface PipelinePageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const leads = await getPipelineLeads({
    organizationId: ctx.org.id,
    ownerId: ownerFilterFor(view, ctx.member.id),
  })

  return (
    <>
      <Header title="Pipeline" />
      <div className="flex-1 p-6 overflow-hidden">
        <PipelineClient initialLeads={leads} view={view} />
      </div>
    </>
  )
}
