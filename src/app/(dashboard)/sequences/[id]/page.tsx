import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SequenceDetailClient } from './sequence-detail-client'
import { getSequence } from '@/features/sequences/server/get-sequence'
import { getEnrollments } from '@/features/sequences/server/get-enrollments'
import { getLeads } from '@/features/leads/server/get-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) redirect('/dashboard')

  const { id } = await params
  const org = await resolveOrganization(orgId)

  let sequence
  try {
    sequence = await getSequence({ organizationId: org.id, sequenceId: id })
  } catch {
    notFound()
  }

  const [{ enrollments }, { leads }] = await Promise.all([
    getEnrollments({ organizationId: org.id, sequenceId: id }),
    getLeads({ organizationId: org.id, limit: 200 }),
  ])

  return (
    <>
      <Header title={sequence.name} />
      <div className="flex-1 p-6">
        <SequenceDetailClient
          sequence={sequence}
          initialEnrollments={enrollments}
          leads={leads.map((l) => ({
            id: l.id,
            email: l.email,
            firstName: l.firstName,
            lastName: l.lastName,
            status: l.status,
          }))}
        />
      </div>
    </>
  )
}
