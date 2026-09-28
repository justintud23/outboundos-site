import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SettingsClient } from './settings-client'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getMailboxes } from '@/features/mailboxes/server/get-mailboxes'
import { getSendingSettings } from '@/features/settings/server/sending-settings'
import { getBusinessProfile } from '@/features/business-profile/server/profile'
import { listMembers } from '@/features/team/server/assign-owner'

export default async function SettingsPage() {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const { org, isAdmin } = ctx
  const [mailboxes, sendingSettings, businessProfile, members] = await Promise.all([
    getMailboxes(org.id),
    getSendingSettings(org.id),
    getBusinessProfile(org.id),
    isAdmin ? listMembers(org.id) : Promise.resolve([]),
  ])

  return (
    <>
      <Header title="Settings" />
      <div className="flex-1 p-6 lg:p-8">
        <SettingsClient
          initialMailboxes={mailboxes}
          sendingSettings={sendingSettings}
          businessProfile={businessProfile}
          isAdmin={isAdmin}
          members={members}
        />
      </div>
    </>
  )
}
