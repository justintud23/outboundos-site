'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  Mail,
  Building2,
  Briefcase,
  Phone,
  LinkIcon,
  MoreHorizontal,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatEnumLabel, relativeTime } from '@/lib/format'
import type { LeadDetailDTO } from '../types'
import type { EngagementScore } from '../utils/compute-engagement-score'
import type { LeadStatus } from '@prisma/client'

const TIER_CONFIG = {
  hot: { label: 'Hot', variant: 'danger' as const, color: 'text-[var(--status-danger)]' },
  warm: { label: 'Warm', variant: 'warning' as const, color: 'text-[var(--status-warning)]' },
  cold: { label: 'Cold', variant: 'muted' as const, color: 'text-[var(--text-muted)]' },
}

const STATUS_VARIANT: Record<LeadStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  NEW: 'default',
  CONTACTED: 'warning',
  REPLIED: 'success',
  BOUNCED: 'danger',
  UNSUBSCRIBED: 'danger',
  CONVERTED: 'success',
  INTERESTED: 'success',
  NOT_INTERESTED: 'danger',
}

interface LeadHeaderProps {
  lead: LeadDetailDTO
  statusOverride?: LeadStatus | null
  engagement?: EngagementScore | null
}

export function LeadHeader({ lead, statusOverride, engagement }: LeadHeaderProps) {
  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)] animate-fade-in-up">
      {/* Back nav */}
      <div className="flex items-center gap-2 mb-4">
        <Link
          href="/leads"
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-[var(--transition-fast)] flex items-center gap-1 text-xs"
        >
          <ArrowLeft size={14} />
          Back to Leads
        </Link>
      </div>

      {/* Main header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-[var(--text-primary)] text-xl font-semibold truncate">
              {name}
            </h1>
            <Badge variant={STATUS_VARIANT[statusOverride ?? lead.status]}>
              {formatEnumLabel(statusOverride ?? lead.status)}
            </Badge>
            {lead.score !== null && (
              <Badge
                variant={
                  lead.score >= 70 ? 'success' : lead.score >= 40 ? 'warning' : 'danger'
                }
                showIcon
              >
                {lead.score}
              </Badge>
            )}
            {engagement && (
              <Badge variant={TIER_CONFIG[engagement.tier].variant}>
                {TIER_CONFIG[engagement.tier].label} {engagement.score}
              </Badge>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[var(--text-secondary)] text-sm">
            <span className="flex items-center gap-1.5">
              <Mail size={13} className="text-[var(--text-muted)]" />
              {lead.email}
            </span>
            {lead.company && (
              <span className="flex items-center gap-1.5">
                <Building2 size={13} className="text-[var(--text-muted)]" />
                {lead.company}
              </span>
            )}
            {lead.title && (
              <span className="flex items-center gap-1.5">
                <Briefcase size={13} className="text-[var(--text-muted)]" />
                {lead.title}
              </span>
            )}
            {lead.phone && (
              <span className="flex items-center gap-1.5">
                <Phone size={13} className="text-[var(--text-muted)]" />
                {lead.phone}
              </span>
            )}
            {lead.linkedinUrl && (
              <a
                href={lead.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-[var(--accent-indigo)] transition-colors"
              >
                <LinkIcon size={13} className="text-[var(--text-muted)]" />
                LinkedIn
              </a>
            )}
          </div>

          {/* Last activity */}
          <p className="text-[var(--text-muted)] text-xs mt-2">
            Last activity {relativeTime(lead.lastActivityAt)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm">
            <MoreHorizontal size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}
