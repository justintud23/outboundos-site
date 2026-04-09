import { prisma } from '@/lib/db/prisma'
import type { TemplateDTO } from '../types'

export async function getTemplates({
  organizationId,
}: {
  organizationId: string
}): Promise<{ templates: TemplateDTO[]; total: number }> {
  const templates = await prisma.promptTemplate.findMany({
    where: { organizationId },
    orderBy: [{ promptType: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      name: true,
      promptType: true,
      version: true,
      body: true,
      isActive: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return { templates, total: templates.length }
}
