import { prisma } from '@/lib/db/prisma'
import type { BusinessProfileDTO, ColumnMapping, PresetId, PropertyTypeRule, Yard } from '../types'
import { validateProfile } from '../validate-profile'
import { zipExists } from './zip-distance'

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileValidationError'
    Object.setPrototypeOf(this, ProfileValidationError.prototype)
  }
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.businessProfile.findUnique>>>

function toDTO(row: Row): BusinessProfileDTO {
  return {
    preset: row.preset as PresetId,
    companySummary: row.companySummary,
    services: row.services,
    yards: (row.yards as unknown as Yard[]) ?? [],
    alwaysZips: row.alwaysZips,
    neverZips: row.neverZips,
    propertyTypes: (row.propertyTypes as unknown as PropertyTypeRule[]) ?? [],
    decisionTitleKeywords: row.decisionTitleKeywords,
    downrankTitleKeywords: row.downrankTitleKeywords,
    bigSites: row.bigSites,
    bigAcres: row.bigAcres,
    columnMapping: (row.columnMapping as unknown as ColumnMapping) ?? {},
  }
}

export async function getBusinessProfile(organizationId: string): Promise<BusinessProfileDTO | null> {
  const row = await prisma.businessProfile.findUnique({ where: { organizationId } })
  return row ? toDTO(row) : null
}

export async function saveBusinessProfile(organizationId: string, input: unknown): Promise<BusinessProfileDTO> {
  const result = validateProfile(input, zipExists)
  if (!result.ok) throw new ProfileValidationError(result.error)
  const v = result.value
  const data = {
    preset: v.preset,
    companySummary: v.companySummary,
    services: v.services,
    yards: v.yards as unknown as object,
    alwaysZips: v.alwaysZips,
    neverZips: v.neverZips,
    propertyTypes: v.propertyTypes as unknown as object,
    decisionTitleKeywords: v.decisionTitleKeywords,
    downrankTitleKeywords: v.downrankTitleKeywords,
    bigSites: v.bigSites,
    bigAcres: v.bigAcres,
    columnMapping: v.columnMapping as unknown as object,
  }
  const row = await prisma.businessProfile.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  })
  return toDTO(row)
}
