export interface Yard {
  label: string
  zip: string
  radiusMiles: number
}

export type Relationship = 'past_customer' | 'lost_quote' | 'prospect'

export interface ColumnMapping {
  propertyType?: string
  zip?: string
  city?: string
  state?: string
  sites?: string
  acres?: string
  relationship?: string
}

export interface LeadFacts {
  zip: string | null
  city: string | null
  state: string | null
  propertyType: string | null
  sites: number | null
  acres: number | null
  relationship: Relationship | null
}

export type PresetId = 'snow_paving' | 'blank'
export type PropertyTier = 'great' | 'good' | 'no_go'

export interface PropertyTypeRule {
  label: string
  keywords: string[]
  tier: PropertyTier
}

export interface BusinessProfileDTO {
  preset: PresetId
  companySummary: string
  services: string[]
  yards: Yard[]
  alwaysZips: string[]
  neverZips: string[]
  propertyTypes: PropertyTypeRule[]
  decisionTitleKeywords: string[]
  downrankTitleKeywords: string[]
  bigSites: number
  bigAcres: number | null
  columnMapping: ColumnMapping
}
