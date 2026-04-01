import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadsPageClient } from './leads-client'
import { getLeads } from '@/features/leads/server/get-leads'

export default async function LeadsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const { leads, total } = await getLeads({ organizationId: orgId })

  return (
    <>
      <Header title="Leads" />
      <div className="flex-1 p-6">
        <LeadsPageClient initialLeads={leads} initialTotal={total} />
      </div>
    </>
  )
}
