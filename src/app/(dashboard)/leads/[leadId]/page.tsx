import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadCommandCenter } from './lead-client'
import { getLead } from '@/features/leads/server/get-lead'
import { getLeadTimeline } from '@/features/leads/server/get-lead-timeline'
import { getThreadDetail } from '@/features/inbox/server/get-thread-detail'
import { getLeadSequence } from '@/features/leads/server/get-lead-sequence'
import { getNextActions } from '@/features/actions/server/get-next-actions'
import { resolveMember } from '@/lib/auth/resolve-member'
import { listMembers } from '@/features/team/server/assign-owner'
import { getConnection } from '@/features/salesforce/server/connection'
import { LeadNotFoundError } from '@/features/leads/types'

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const ctx = await resolveMember()
  if (!ctx) {
    redirect('/dashboard')
  }

  const { leadId } = await params
  const { org, isAdmin } = ctx

  let lead
  try {
    lead = await getLead({ organizationId: org.id, leadId })
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      notFound()
    }
    throw error
  }

  const [timeline, threadDetail, sequence, actions, members, connection] = await Promise.all([
    getLeadTimeline({ organizationId: org.id, leadId }),
    getThreadDetail({ organizationId: org.id, leadId }),
    getLeadSequence({ organizationId: org.id, leadId }),
    getNextActions({ organizationId: org.id, leadId, limit: 5 }),
    isAdmin ? listMembers(org.id) : Promise.resolve([]),
    getConnection(org.id),
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
          isAdmin={isAdmin}
          members={members}
          salesforceInstanceUrl={connection?.instanceUrl ?? null}
        />
      </div>
    </>
  )
}
