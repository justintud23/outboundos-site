import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { getCampaignDetail } from '@/features/campaigns/server/get-campaign-detail'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import type { CampaignStatus, DraftStatus, ReplyClassification } from '@prisma/client'
import type { CampaignDetailDraftDTO, CampaignDetailReplyDTO } from '@/features/campaigns/server/get-campaign-detail'

const CAMPAIGN_STATUS_VARIANT: Record<CampaignStatus, 'default' | 'success' | 'warning' | 'muted'> = {
  DRAFT:     'muted',
  ACTIVE:    'success',
  PAUSED:    'warning',
  COMPLETED: 'default',
  ARCHIVED:  'muted',
}

const DRAFT_STATUS_VARIANT: Record<DraftStatus, 'warning' | 'success' | 'danger'> = {
  PENDING_REVIEW: 'warning',
  APPROVED:       'success',
  REJECTED:       'danger',
}

const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  PENDING_REVIEW: 'Pending Review',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
}

const REPLY_VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE:            'success',
  NEUTRAL:             'muted',
  NEGATIVE:            'danger',
  OUT_OF_OFFICE:       'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL:            'default',
  UNKNOWN:             'muted',
}

const REPLY_LABEL: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function DraftsSection({ drafts, draftTotal }: { drafts: CampaignDetailDraftDTO[]; draftTotal: number }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">
          Drafts
          <span className="ml-2 text-[var(--text-muted)] font-normal">{draftTotal}</span>
        </h2>
        <Link href="/drafts" className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors">
          Review in Drafts &rarr;
        </Link>
      </div>
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[var(--text-muted)] text-sm">No drafts for this campaign yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Subject</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const displayName = [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') || draft.lead.email
                  return (
                    <tr key={draft.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] last:border-0">
                      <td className="py-3 px-4">
                        <p className="text-[var(--text-primary)]">{displayName}</p>
                        {displayName !== draft.lead.email && <p className="text-[var(--text-muted)] text-xs">{draft.lead.email}</p>}
                        {draft.lead.company && <p className="text-[var(--text-muted)] text-xs opacity-60">{draft.lead.company}</p>}
                      </td>
                      <td className="py-3 px-4 max-w-[240px]"><span className="text-[var(--text-secondary)] text-xs block truncate">{draft.subject}</span></td>
                      <td className="py-3 px-4"><Badge variant={DRAFT_STATUS_VARIANT[draft.status]}>{DRAFT_STATUS_LABEL[draft.status]}</Badge></td>
                      <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden md:table-cell">{draft.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function RepliesSection({ replies, replyCount }: { replies: CampaignDetailReplyDTO[]; replyCount: number }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">
          Replies
          <span className="ml-2 text-[var(--text-muted)] font-normal">{replyCount}</span>
        </h2>
        <Link href="/replies" className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors">
          View all replies &rarr;
        </Link>
      </div>
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        {replies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[var(--text-muted)] text-sm">No replies for this campaign yet.</p>
            <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Replies appear once leads respond to sent messages.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Classification</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Confidence</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Preview</th>
                  <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Received</th>
                </tr>
              </thead>
              <tbody>
                {replies.map((reply) => (
                  <tr key={reply.id} className={reply.classification === 'POSITIVE' ? 'border-b border-[var(--border-subtle)] bg-[var(--status-success-bg)] hover:bg-[var(--status-success-bg)] transition-colors duration-[var(--transition-fast)] last:border-0' : 'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] last:border-0'}>
                    <td className="py-3 px-4 text-[var(--text-primary)] text-xs">{reply.leadEmail}</td>
                    <td className="py-3 px-4"><Badge variant={REPLY_VARIANT[reply.classification]}>{REPLY_LABEL[reply.classification]}</Badge></td>
                    <td className="py-3 px-4 text-[var(--text-muted)] text-xs">{reply.classificationConfidence !== null ? `${Math.round(reply.classificationConfidence * 100)}%` : '\u2014'}</td>
                    <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden lg:table-cell"><span className="line-clamp-1 max-w-xs block">{reply.rawBody.slice(0, 100)}</span></td>
                    <td className="py-3 px-4 text-[var(--text-muted)] text-xs">{reply.receivedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) redirect('/dashboard')

  const { id: campaignId } = await params
  const org = await resolveOrganization(orgId)
  const campaign = await getCampaignDetail({ organizationId: org.id, campaignId })
  if (!campaign) notFound()

  const positiveRate = campaign.replyCount > 0 ? `${((campaign.positiveReplyCount / campaign.replyCount) * 100).toFixed(0)}% positive` : null

  return (
    <>
      <Header title={campaign.name} />
      <div className="flex-1 p-6 space-y-8">
        <div className="space-y-3">
          <Link href="/campaigns" className="inline-flex items-center gap-1 text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">&larr; Campaigns</Link>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[var(--text-primary)] font-semibold text-xl">{campaign.name}</h1>
                <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>{capitalize(campaign.status)}</Badge>
              </div>
              {campaign.description && <p className="text-[var(--text-secondary)] text-sm mt-1">{campaign.description}</p>}
              <p className="text-[var(--text-muted)] text-xs mt-1">Created {campaign.createdAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Messages Sent" value={campaign.messageCount} />
          <StatCard label="Total Drafts" value={campaign.draftTotal} />
          <StatCard label="Pending Review" value={campaign.draftPendingCount} accent={campaign.draftPendingCount > 0 ? 'warning' : undefined} />
          <StatCard label="Replies" value={campaign.replyCount} />
          <StatCard label="Positive" value={campaign.positiveReplyCount} accent={campaign.positiveReplyCount > 0 ? 'success' : undefined} />
        </div>

        {positiveRate && <p className="text-[var(--text-muted)] text-xs -mt-4">{positiveRate} reply rate</p>}

        {campaign.draftPendingCount > 0 && (
          <div className="flex items-center justify-between bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 rounded-[var(--radius-card)] px-4 py-3">
            <p className="text-[var(--status-warning)] text-sm font-medium">{campaign.draftPendingCount} draft{campaign.draftPendingCount !== 1 ? 's' : ''} pending review</p>
            <Link href="/drafts" className="text-[var(--status-warning)] text-xs underline hover:no-underline transition-all">Review now &rarr;</Link>
          </div>
        )}

        <DraftsSection drafts={campaign.drafts} draftTotal={campaign.draftTotal} />
        <RepliesSection replies={campaign.replies} replyCount={campaign.replyCount} />

        <div className="flex gap-4 pt-2 border-t border-[var(--border-default)]">
          <Link href="/analytics" className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">Full analytics &rarr;</Link>
          <Link href="/campaigns" className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">All campaigns &rarr;</Link>
        </div>
      </div>
    </>
  )
}
