import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SettingsClient } from './settings-client'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getMailboxes } from '@/features/mailboxes/server/get-mailboxes'
import { getSendingSettings } from '@/features/settings/server/sending-settings'

export default async function SettingsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const [mailboxes, sendingSettings] = await Promise.all([
    getMailboxes(org.id),
    getSendingSettings(org.id),
  ])

  return (
    <>
      <Header title="Settings" />
      <div className="flex-1 p-6 lg:p-8">
        <SettingsClient initialMailboxes={mailboxes} sendingSettings={sendingSettings} />
      </div>
    </>
  )
}
