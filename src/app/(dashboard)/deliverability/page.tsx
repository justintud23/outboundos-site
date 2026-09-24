import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getDeliverabilityOverview } from '@/features/deliverability/server/get-overview'
import { DeliverabilityClient } from '@/features/deliverability/components/deliverability-client'

export default async function DeliverabilityPage() {
  const { orgId } = await auth()
  if (!orgId) redirect('/dashboard')
  const org = await resolveOrganization(orgId)

  // The deliverability suite is Microsoft-365-only — without a connected
  // tenant every mailbox would wrongly evaluate as BLOCKED, so don't even
  // load the overview.
  if (!org.msTenantId) {
    return (
      <>
        <Header title="Deliverability" />
        <div className="flex-1 p-6 lg:p-8">
          <div className="flex flex-col items-center justify-center text-center py-16 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
            <p className="text-[var(--text-primary)] text-sm font-medium">
              Connect Microsoft 365 in <Link href="/settings" className="text-[var(--accent-indigo)] underline hover:no-underline">Settings</Link> to see deliverability
            </p>
          </div>
        </div>
      </>
    )
  }

  let overview
  try {
    overview = await getDeliverabilityOverview(org.id)
  } catch (err) {
    console.error('[deliverability page]', err)
    return (
      <>
        <Header title="Deliverability" />
        <div className="flex-1 p-6 lg:p-8">
          <p role="alert" className="text-[var(--status-danger)] text-sm">Couldn&apos;t load deliverability data. Refresh the page to try again.</p>
        </div>
      </>
    )
  }
  return (
    <>
      <Header title="Deliverability" />
      <div className="flex-1 p-6 lg:p-8">
        <DeliverabilityClient overview={overview} />
      </div>
    </>
  )
}
