import { prisma } from '@/lib/db/prisma'
import type { PromptType } from '@prisma/client'
import type { TemplateDTO } from '../types'

export async function getTemplates({
  organizationId,
  promptType,
}: {
  organizationId: string
  promptType?: PromptType
}): Promise<{ templates: TemplateDTO[]; total: number }> {
  const templates = await prisma.promptTemplate.findMany({
    where: { organizationId, ...(promptType && { promptType }) },
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
