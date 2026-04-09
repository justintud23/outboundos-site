import { prisma } from '@/lib/db/prisma'
import type { TemplateDTO } from '../types'
import { TemplateNotFoundError } from '../types'

interface SetActiveTemplateInput {
  organizationId: string
  templateId: string
}

export async function setActiveTemplate({
  organizationId,
  templateId,
}: SetActiveTemplateInput): Promise<TemplateDTO> {
  const template = await prisma.promptTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: { id: true, promptType: true },
  })

  if (!template) {
    throw new TemplateNotFoundError(templateId)
  }

  return prisma.$transaction(async (tx) => {
    // Deactivate all templates of this type
    await tx.promptTemplate.updateMany({
      where: { organizationId, promptType: template.promptType, isActive: true },
      data: { isActive: false },
    })

    // Activate the selected one
    return tx.promptTemplate.update({
      where: { id: templateId },
      data: { isActive: true },
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
  })
}
