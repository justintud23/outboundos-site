import { z } from 'zod'

// CSV row — maps to spreadsheet column headers (flexible casing handled by papaparse header option)
export const CsvRowSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  linkedin_url: z.string().url().optional().or(z.literal('')),
  phone: z.string().optional(),
})

export type CsvRow = z.infer<typeof CsvRowSchema>

// Lead creation input — used by server functions
export const CreateLeadSchema = z.object({
  organizationId: z.string().min(1),
  importBatchId: z.string().optional(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  phone: z.string().optional(),
  source: z.enum(['CSV', 'MANUAL', 'HUBSPOT', 'SALESFORCE', 'API']).default('CSV'),
  customFields: z.record(z.string(), z.unknown()).optional(),
})

export type CreateLeadInput = z.infer<typeof CreateLeadSchema>
