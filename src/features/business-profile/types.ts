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
