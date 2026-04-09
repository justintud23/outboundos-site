import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { ActionCenterClient } from './action-center-client'
import { getNextActions } from '@/features/actions/server/get-next-actions'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function ActionCenterPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const actions = await getNextActions({ organizationId: org.id })

  return (
    <>
      <Header title="Action Center" />
      <div className="flex-1 p-6">
        <ActionCenterClient initialActions={actions} />
      </div>
    </>
  )
}
