import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { TemplatesClient } from './templates-client'
import { getTemplates } from '@/features/templates/server/get-templates'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function TemplatesPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { templates } = await getTemplates({ organizationId: org.id })

  return (
    <>
      <Header title="Templates" />
      <div className="flex-1 p-6 lg:p-8">
        <TemplatesClient initialTemplates={templates} />
      </div>
    </>
  )
}
