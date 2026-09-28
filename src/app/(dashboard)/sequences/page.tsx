import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SequencesClient } from './sequences-client'
import { getSequences } from '@/features/sequences/server/get-sequences'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'
import { getSendingSettings } from '@/features/settings/server/sending-settings'
import { getBusinessProfile } from '@/features/business-profile/server/profile'
import { STARTER_SEQUENCES } from '@/features/business-profile/starter-sequences'

interface SequencesPageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function SequencesPage({ searchParams }: SequencesPageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const ownerId = ownerFilterFor(view, ctx.member.id)
  const [{ sequences }, { campaigns }, sendingSettings, profile] = await Promise.all([
    getSequences({ organizationId: ctx.org.id, ownerId }),
    getCampaigns({ organizationId: ctx.org.id }),
    getSendingSettings(ctx.org.id),
    getBusinessProfile(ctx.org.id),
  ])

  return (
    <>
      <Header title="Sequences" />
      <div className="flex-1 p-6 lg:p-8">
        <SequencesClient
          initialSequences={sequences}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          blockedPhrases={sendingSettings.guardrailBlockedPhrases}
          allowedWords={sendingSettings.guardrailAllowedWords}
          starterSequences={profile ? STARTER_SEQUENCES[profile.preset] : []}
          view={view}
        />
      </div>
    </>
  )
}
