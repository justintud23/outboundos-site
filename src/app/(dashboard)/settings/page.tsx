import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SettingsClient } from './settings-client'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getMailboxes } from '@/features/mailboxes/server/get-mailboxes'
import { getSendingSettings } from '@/features/settings/server/sending-settings'
import { getBusinessProfile } from '@/features/business-profile/server/profile'
import { listMembers } from '@/features/team/server/assign-owner'
import { getTeam } from '@/features/team/server/team-settings'
import { getSalesforceStatus } from '@/features/salesforce/server/settings'

export default async function SettingsPage() {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/dashboard')
  }

  const { org, member, isAdmin } = ctx
  const [mailboxes, sendingSettings, businessProfile, members, team, salesforceStatus] = await Promise.all([
    isAdmin ? getMailboxes(org.id) : Promise.resolve([]),
    isAdmin ? getSendingSettings(org.id) : Promise.resolve(null),
    isAdmin ? getBusinessProfile(org.id) : Promise.resolve(null),
    isAdmin ? listMembers(org.id) : Promise.resolve([]),
    getTeam(org.id),
    getSalesforceStatus(org.id, { includeDetails: isAdmin }),
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
          team={team}
          salesforceStatus={salesforceStatus}
          currentMember={{
            id: member.id,
            escalationEmail: member.escalationEmail,
            senderFirstName: member.senderFirstName,
            senderLastName: member.senderLastName,
          }}
        />
      </div>
    </>
  )
}
