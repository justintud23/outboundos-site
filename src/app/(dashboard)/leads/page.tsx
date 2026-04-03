import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { getLeads } from '@/features/leads/server/get-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import type { LeadDTO } from '@/features/leads/types'
import type { LeadStatus } from '@prisma/client'

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<LeadStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  NEW:          'default',
  CONTACTED:    'warning',
  REPLIED:      'success',
  BOUNCED:      'danger',
  UNSUBSCRIBED: 'danger',
  CONVERTED:    'success',
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {capitalize(status)}
    </Badge>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[#475569] text-sm">No leads yet.</p>
      <p className="text-[#334155] text-xs mt-1">Import a CSV to get started.</p>
    </div>
  )
}

// ─── Leads table (server-rendered) ───────────────────────────────────────────

function LeadsTable({ leads }: { leads: LeadDTO[] }) {
  if (leads.length === 0) return <EmptyState />

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Email</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Source</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const name =
              [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

            return (
              <tr
                key={lead.id}
                className="border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors"
              >
                <td className="py-3 px-4 text-[#e2e8f0] font-medium">{name}</td>
                <td className="py-3 px-4 text-[#94a3b8] text-xs">{lead.email}</td>
                <td className="py-3 px-4 text-[#94a3b8]">{lead.company ?? '—'}</td>
                <td className="py-3 px-4 text-[#94a3b8]">{lead.title ?? '—'}</td>
                <td className="py-3 px-4">
                  <StatusBadge status={lead.status} />
                </td>
                <td className="py-3 px-4 text-[#94a3b8]">
                  {lead.score !== null ? lead.score : '—'}
                </td>
                <td className="py-3 px-4 text-[#94a3b8]">
                  {capitalize(lead.source)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LeadsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { leads, total } = await getLeads({ organizationId: org.id })

  return (
    <>
      <Header title="Leads" />
      <div className="flex-1 p-6 space-y-4">
        <p className="text-[#94a3b8] text-sm">
          {total.toLocaleString()} lead{total !== 1 ? 's' : ''}
        </p>

        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <LeadsTable leads={leads} />
        </div>
      </div>
    </>
  )
}
