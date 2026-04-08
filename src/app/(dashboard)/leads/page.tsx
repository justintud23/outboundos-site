import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadsPageClient } from './leads-client'
import { getLeads } from '@/features/leads/server/get-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

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
      <div className="flex-1 p-6">
        <LeadsPageClient initialLeads={leads} initialTotal={total} />
      </div>
    </>
  )
}
