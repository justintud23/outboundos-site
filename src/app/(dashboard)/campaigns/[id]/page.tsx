import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { getCampaignDetail } from '@/features/campaigns/server/get-campaign-detail'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import type { CampaignStatus, DraftStatus, ReplyClassification } from '@prisma/client'
import type { CampaignDetailDraftDTO, CampaignDetailReplyDTO } from '@/features/campaigns/server/get-campaign-detail'

// ─── Status / classification helpers ──────────────────────────────────────────

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

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent?: 'success' | 'warning' }) {
  const valueColor =
    accent === 'success' ? 'text-[#10b981]' :
    accent === 'warning' ? 'text-[#f59e0b]' :
    'text-[#e2e8f0]'

  return (
    <div className="bg-[#13151c] border border-[#1e2130] rounded-lg p-4">
      <p className="text-[#475569] text-xs uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${valueColor}`}>{value.toLocaleString()}</p>
    </div>
  )
}

// ─── Drafts section ────────────────────────────────────────────────────────────

function DraftsSection({ drafts, draftTotal }: { drafts: CampaignDetailDraftDTO[]; draftTotal: number }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[#e2e8f0] font-semibold text-sm">
          Drafts
          <span className="ml-2 text-[#475569] font-normal">{draftTotal}</span>
        </h2>
        <Link
          href="/drafts"
          className="text-[#6366f1] text-xs hover:text-[#818cf8] transition-colors"
        >
          Review in Drafts →
        </Link>
      </div>

      <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[#475569] text-sm">No drafts for this campaign yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e2130]">
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Lead</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Subject</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const displayName =
                    [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
                    draft.lead.email

                  return (
                    <tr
                      key={draft.id}
                      className="border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors last:border-0"
                    >
                      <td className="py-3 px-4">
                        <p className="text-[#e2e8f0]">{displayName}</p>
                        {displayName !== draft.lead.email && (
                          <p className="text-[#475569] text-xs">{draft.lead.email}</p>
                        )}
                        {draft.lead.company && (
                          <p className="text-[#334155] text-xs">{draft.lead.company}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-[240px]">
                        <span className="text-[#94a3b8] text-xs block truncate">{draft.subject}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={DRAFT_STATUS_VARIANT[draft.status]}>
                          {DRAFT_STATUS_LABEL[draft.status]}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-[#475569] text-xs hidden md:table-cell">
                        {draft.createdAt.toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
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

// ─── Replies section ───────────────────────────────────────────────────────────

function RepliesSection({ replies, replyCount }: { replies: CampaignDetailReplyDTO[]; replyCount: number }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[#e2e8f0] font-semibold text-sm">
          Replies
          <span className="ml-2 text-[#475569] font-normal">{replyCount}</span>
        </h2>
        <Link
          href="/replies"
          className="text-[#6366f1] text-xs hover:text-[#818cf8] transition-colors"
        >
          View all replies →
        </Link>
      </div>

      <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
        {replies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[#475569] text-sm">No replies for this campaign yet.</p>
            <p className="text-[#334155] text-xs mt-1">Replies appear once leads respond to sent messages.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e2130]">
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Lead</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Classification</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Confidence</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Preview</th>
                  <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Received</th>
                </tr>
              </thead>
              <tbody>
                {replies.map((reply) => (
                  <tr
                    key={reply.id}
                    className={
                      reply.classification === 'POSITIVE'
                        ? 'border-b border-[#1a1d2e] bg-[#052e16]/20 hover:bg-[#052e16]/40 transition-colors last:border-0'
                        : 'border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors last:border-0'
                    }
                  >
                    <td className="py-3 px-4 text-[#e2e8f0] text-xs">{reply.leadEmail}</td>
                    <td className="py-3 px-4">
                      <Badge variant={REPLY_VARIANT[reply.classification]}>
                        {REPLY_LABEL[reply.classification]}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-[#475569] text-xs">
                      {reply.classificationConfidence !== null
                        ? `${Math.round(reply.classificationConfidence * 100)}%`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell">
                      <span className="line-clamp-1 max-w-xs block">
                        {reply.rawBody.slice(0, 100)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#475569] text-xs">
                      {reply.receivedAt.toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const { id: campaignId } = await params
  const org = await resolveOrganization(orgId)
  const campaign = await getCampaignDetail({ organizationId: org.id, campaignId })

  if (!campaign) {
    notFound()
  }

  const positiveRate =
    campaign.replyCount > 0
      ? `${((campaign.positiveReplyCount / campaign.replyCount) * 100).toFixed(0)}% positive`
      : null

  return (
    <>
      <Header title={campaign.name} />
      <div className="flex-1 p-6 space-y-8">

        {/* Back nav + header */}
        <div className="space-y-3">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-[#475569] text-xs hover:text-[#94a3b8] transition-colors"
          >
            ← Campaigns
          </Link>

          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[#e2e8f0] font-semibold text-xl">{campaign.name}</h1>
                <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>
                  {capitalize(campaign.status)}
                </Badge>
              </div>
              {campaign.description && (
                <p className="text-[#94a3b8] text-sm mt-1">{campaign.description}</p>
              )}
              <p className="text-[#334155] text-xs mt-1">
                Created {campaign.createdAt.toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Messages Sent"  value={campaign.messageCount} />
          <StatCard label="Total Drafts"   value={campaign.draftTotal} />
          <StatCard label="Pending Review" value={campaign.draftPendingCount} accent={campaign.draftPendingCount > 0 ? 'warning' : undefined} />
          <StatCard label="Replies"        value={campaign.replyCount} />
          <StatCard label="Positive"       value={campaign.positiveReplyCount} accent={campaign.positiveReplyCount > 0 ? 'success' : undefined} />
        </div>

        {/* Positive rate hint */}
        {positiveRate && (
          <p className="text-[#475569] text-xs -mt-4">
            {positiveRate} reply rate
          </p>
        )}

        {/* Pending draft CTA */}
        {campaign.draftPendingCount > 0 && (
          <div className="flex items-center justify-between bg-[#2d1f00] border border-[#f59e0b]/30 rounded-lg px-4 py-3">
            <p className="text-[#f59e0b] text-sm font-medium">
              {campaign.draftPendingCount} draft{campaign.draftPendingCount !== 1 ? 's' : ''} pending review
            </p>
            <Link
              href="/drafts"
              className="text-[#f59e0b] text-xs underline hover:no-underline transition-all"
            >
              Review now →
            </Link>
          </div>
        )}

        {/* Drafts */}
        <DraftsSection drafts={campaign.drafts} draftTotal={campaign.draftTotal} />

        {/* Replies */}
        <RepliesSection replies={campaign.replies} replyCount={campaign.replyCount} />

        {/* Footer links */}
        <div className="flex gap-4 pt-2 border-t border-[#1e2130]">
          <Link href="/analytics" className="text-[#475569] text-xs hover:text-[#94a3b8] transition-colors">
            Full analytics →
          </Link>
          <Link href="/campaigns" className="text-[#475569] text-xs hover:text-[#94a3b8] transition-colors">
            All campaigns →
          </Link>
        </div>

      </div>
    </>
  )
}
