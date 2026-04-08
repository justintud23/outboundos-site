import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PipelineClient } from './pipeline-client'
import { getPipelineLeads } from '@/features/leads/server/get-pipeline-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function PipelinePage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const leads = await getPipelineLeads({ organizationId: org.id })

  return (
    <>
      <Header title="Pipeline" />
      <div className="flex-1 p-6 overflow-hidden">
        <PipelineClient initialLeads={leads} />
      </div>
    </>
  )
}
