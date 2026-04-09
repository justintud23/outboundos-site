import { prisma } from '@/lib/db/prisma'
import type { PromptType } from '@prisma/client'
import type { TemplateDTO } from '../types'

interface CreateTemplateInput {
  organizationId: string
  name: string
  promptType: PromptType
  body: string
  notes?: string
}

export async function createTemplate(input: CreateTemplateInput): Promise<TemplateDTO> {
  const { organizationId, name, promptType, body, notes } = input

  // Determine next version number
  const latest = await prisma.promptTemplate.findFirst({
    where: { organizationId, promptType },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const version = (latest?.version ?? 0) + 1

  const template = await prisma.$transaction(async (tx) => {
    // Deactivate any existing active template for this type
    await tx.promptTemplate.updateMany({
      where: { organizationId, promptType, isActive: true },
      data: { isActive: false },
    })

    return tx.promptTemplate.create({
      data: {
        organizationId,
        name,
        promptType,
        version,
        body,
        isActive: true,
        notes: notes ?? null,
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
  })

  return template
}
