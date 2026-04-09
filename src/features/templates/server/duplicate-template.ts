import { prisma } from '@/lib/db/prisma'
import type { TemplateDTO } from '../types'
import { TemplateNotFoundError } from '../types'

interface DuplicateTemplateInput {
  organizationId: string
  templateId: string
}

export async function duplicateTemplate({
  organizationId,
  templateId,
}: DuplicateTemplateInput): Promise<TemplateDTO> {
  const source = await prisma.promptTemplate.findFirst({
    where: { id: templateId, organizationId },
  })

  if (!source) {
    throw new TemplateNotFoundError(templateId)
  }

  // Get next version number for this prompt type
  const latest = await prisma.promptTemplate.findFirst({
    where: { organizationId, promptType: source.promptType },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const version = (latest?.version ?? 0) + 1

  const duplicate = await prisma.promptTemplate.create({
    data: {
      organizationId,
      name: `${source.name} (copy)`,
      promptType: source.promptType,
      version,
      body: source.body,
      isActive: false,
      notes: source.notes,
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

  return duplicate
}
