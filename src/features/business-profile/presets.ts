import type { BusinessProfileDTO, PresetId } from './types'

// Presets pre-fill the Settings form; nothing is saved until the user adds a
// yard and clicks Save. Yards are left empty on purpose — only the user knows them.
export const PRESETS: Record<PresetId, BusinessProfileDTO> = {
  snow_paving: {
    preset: 'snow_paving',
    companySummary:
      'We are a commercial snow removal, salting and paving contractor. We keep parking lots, drives and walkways clear and safe all winter, with every visit logged, and we handle asphalt paving, sealcoating, striping and repairs in the warmer months.',
    services: ['snow plowing', 'salting / de-icing', 'sidewalk clearing', 'asphalt paving', 'sealcoating', 'line striping', 'patching / crack filling'],
    yards: [],
    alwaysZips: [],
    neverZips: [],
    propertyTypes: [
      { label: 'HOA / community association', keywords: ['hoa', 'homeowners association', 'community association', 'condo association', 'condominium', 'townhome'], tier: 'great' },
      { label: 'Retail center', keywords: ['retail', 'shopping', 'plaza', 'strip mall', 'shopping mall', 'grocery'], tier: 'great' },
      { label: 'Office park', keywords: ['office', 'business park', 'corporate campus'], tier: 'great' },
      { label: 'Medical / healthcare', keywords: ['medical', 'hospital', 'clinic', 'healthcare', 'health care', 'dental', 'surgery center'], tier: 'great' },
      { label: 'Apartments / multifamily', keywords: ['apartment', 'multifamily', 'multi-family', 'residential community'], tier: 'great' },
      { label: 'Industrial / warehouse', keywords: ['industrial', 'warehouse', 'distribution', 'manufacturing', 'logistics'], tier: 'good' },
      { label: 'School / church', keywords: ['school', 'church', 'university', 'college', 'academy'], tier: 'good' },
      { label: 'Hotel', keywords: ['hotel', 'motel'], tier: 'good' },
      { label: 'Restaurant', keywords: ['restaurant', 'dining', 'cafe'], tier: 'good' },
      { label: 'Single-family home', keywords: ['single-family', 'single family', 'residential home'], tier: 'no_go' },
    ],
    decisionTitleKeywords: ['property manager', 'facilities', 'facility', 'community association manager', 'community manager', 'maintenance director', 'director of maintenance', 'owner', 'asset manager', 'operations manager', 'general manager', 'portfolio manager', 'board president'],
    downrankTitleKeywords: ['assistant', 'intern', 'coordinator', 'receptionist'],
    bigSites: 5,
    bigAcres: 2,
    columnMapping: {},
  },
  blank: {
    preset: 'blank',
    companySummary: '',
    services: [],
    yards: [],
    alwaysZips: [],
    neverZips: [],
    propertyTypes: [],
    decisionTitleKeywords: [],
    downrankTitleKeywords: [],
    bigSites: 5,
    bigAcres: null,
    columnMapping: {},
  },
}

export const PRESET_OPTIONS: { id: PresetId; label: string }[] = [
  { id: 'snow_paving', label: 'Commercial snow & paving' },
  { id: 'blank', label: 'Start blank (another trade)' },
]
