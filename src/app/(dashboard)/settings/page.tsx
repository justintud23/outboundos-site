import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SettingsClient } from './settings-client'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getMailboxes } from '@/features/mailboxes/server/get-mailboxes'

export default async function SettingsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const mailboxes = await getMailboxes(org.id)

  return (
    <>
      <Header title="Settings" />
      <div className="flex-1 p-6">
        <SettingsClient initialMailboxes={mailboxes} />
      </div>
    </>
  )
}
