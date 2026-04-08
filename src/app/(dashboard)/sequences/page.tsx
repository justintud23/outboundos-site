import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SequencesClient } from './sequences-client'
import { getSequences } from '@/features/sequences/server/get-sequences'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function SequencesPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const [{ sequences }, { campaigns }] = await Promise.all([
    getSequences({ organizationId: org.id }),
    getCampaigns({ organizationId: org.id }),
  ])

  return (
    <>
      <Header title="Sequences" />
      <div className="flex-1 p-6">
        <SequencesClient
          initialSequences={sequences}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </>
  )
}
