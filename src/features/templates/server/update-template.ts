import { prisma } from '@/lib/db/prisma'
import type { TemplateDTO } from '../types'
import { TemplateNotFoundError } from '../types'

interface UpdateTemplateInput {
  organizationId: string
  templateId: string
  name?: string
  body?: string
  notes?: string | null
}

export async function updateTemplate(input: UpdateTemplateInput): Promise<TemplateDTO> {
  const { organizationId, templateId, name, body, notes } = input

  const existing = await prisma.promptTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: { id: true },
  })

  if (!existing) {
    throw new TemplateNotFoundError(templateId)
  }

  return prisma.promptTemplate.update({
    where: { id: templateId },
    data: {
      ...(name !== undefined && { name }),
      ...(body !== undefined && { body }),
      ...(notes !== undefined && { notes }),
    },
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
}
