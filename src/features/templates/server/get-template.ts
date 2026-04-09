import { prisma } from '@/lib/db/prisma'
import type { TemplateDTO } from '../types'
import { TemplateNotFoundError } from '../types'

export async function getTemplate({
  organizationId,
  templateId,
}: {
  organizationId: string
  templateId: string
}): Promise<TemplateDTO> {
  const template = await prisma.promptTemplate.findFirst({
    where: { id: templateId, organizationId },
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

  if (!template) {
    throw new TemplateNotFoundError(templateId)
  }

  return template
}
