import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SequenceDetailClient } from './sequence-detail-client'
import { getSequence } from '@/features/sequences/server/get-sequence'
import { getEnrollments } from '@/features/sequences/server/get-enrollments'
import { getSubjectVariantStats } from '@/features/sequences/server/get-subject-variant-stats'
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

  // A/B subject test stats apply only to the first step (follow-ups thread).
  const firstStep = sequence.steps.find((s) => s.stepNumber === 1)

  const [{ enrollments }, { leads }, firstStepStats] = await Promise.all([
    getEnrollments({ organizationId: org.id, sequenceId: id }),
    getLeads({ organizationId: org.id, limit: 200 }),
    firstStep
      ? getSubjectVariantStats({ organizationId: org.id, sequenceStepId: firstStep.id })
      : Promise.resolve(null),
  ])

  return (
    <>
      <Header title={sequence.name} />
      <div className="flex-1 p-6 lg:p-8">
        <SequenceDetailClient
          sequence={sequence}
          firstStepStats={firstStepStats}
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
