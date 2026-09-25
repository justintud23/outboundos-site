import { checkContent, type Finding, type Severity } from './check-content'

const RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

export interface ContentItem {
  key: string
  label: string
  subject: string
  body: string
  isFirstStep: boolean
}

export interface ItemResult extends ContentItem {
  level: Severity
  findings: Finding[]
}

export interface CampaignContentEvaluation {
  level: Severity
  items: ItemResult[]
}

export function stepItems(
  sequenceId: string,
  sequenceName: string,
  steps: { stepNumber: number; subject: string; body: string }[],
): ContentItem[] {
  return steps.map((s) => ({
    key: `step:${sequenceId}:${s.stepNumber}`,
    label: `${sequenceName} — step ${s.stepNumber}`,
    subject: s.subject,
    body: s.body,
    isFirstStep: s.stepNumber === 1,
  }))
}

export function variantItem(sequenceId: string, sequenceName: string, variantId: string, subject: string, firstStepBody: string): ContentItem {
  return {
    key: `variant:${sequenceId}:${variantId}`,
    label: `${sequenceName} — subject variant "${subject}"`,
    subject,
    body: firstStepBody,
    isFirstStep: true,
  }
}

export function evaluateItems(items: ContentItem[], blockedPhrases: string[], allowedWords: string[]): CampaignContentEvaluation {
  const results = items.map((item) => {
    const { level, findings } = checkContent({ subject: item.subject, body: item.body, isFirstStep: item.isFirstStep, blockedPhrases, allowedWords })
    return { ...item, level, findings }
  })
  const worst = results.reduce<Severity>((max, r) => (RANK[r.level] > RANK[max] ? r.level : max), 'LOW')
  return { level: worst, items: results }
}
