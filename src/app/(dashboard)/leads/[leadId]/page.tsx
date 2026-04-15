import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadCommandCenter } from './lead-client'
import { getLead } from '@/features/leads/server/get-lead'
import { getLeadTimeline } from '@/features/leads/server/get-lead-timeline'
import { getThreadDetail } from '@/features/inbox/server/get-thread-detail'
import { getLeadSequence } from '@/features/leads/server/get-lead-sequence'
import { getNextActions } from '@/features/actions/server/get-next-actions'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { LeadNotFoundError } from '@/features/leads/types'

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) {
    redirect('/dashboard')
  }

  const { leadId } = await params
  const org = await resolveOrganization(orgId)

  let lead
  try {
    lead = await getLead({ organizationId: org.id, leadId })
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      notFound()
    }
    throw error
  }

  const [timeline, threadDetail, sequence, actions] = await Promise.all([
    getLeadTimeline({ organizationId: org.id, leadId }),
    getThreadDetail({ organizationId: org.id, leadId }),
    getLeadSequence({ organizationId: org.id, leadId }),
    getNextActions({ organizationId: org.id, leadId, limit: 5 }),
  ])

  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

  return (
    <>
      <Header title={name} />
      <div className="flex-1 p-6 lg:p-8">
        <LeadCommandCenter
          lead={lead}
          timeline={timeline}
          messages={threadDetail.messages}
          sequence={sequence}
          actions={actions}
        />
      </div>
    </>
  )
}
