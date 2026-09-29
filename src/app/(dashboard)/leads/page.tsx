import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadsPageClient } from './leads-client'
import { getLeads } from '@/features/leads/server/get-leads'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'

interface LeadsPageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const { leads, total } = await getLeads({
    organizationId: ctx.org.id,
    ownerId: ownerFilterFor(view, ctx.member.id),
  })

  return (
    <>
      <Header title="Leads" />
      <div className="flex-1 p-6 lg:p-8">
        <LeadsPageClient initialLeads={leads} initialTotal={total} view={view} />
      </div>
    </>
  )
}
