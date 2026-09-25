import { describe, it, expect } from 'vitest'
import { stepItems, variantItem, evaluateItems } from './campaign-content'

const BODY = 'Hi {firstName|there},\n\n{personalization}\n\nWe handle plowing, salting and sealcoating for commercial lots across Buffalo. Would a quick quote for next season help?\n\nThanks'

describe('campaign content items', () => {
  it('keys steps by sequence and number; only step 1 is a first step', () => {
    const items = stepItems('seq-1', 'Fall outreach', [
      { stepNumber: 1, subject: 'Snow plan', body: BODY },
      { stepNumber: 2, subject: 'Re: Snow plan', body: BODY },
    ])
    expect(items.map((i) => [i.key, i.isFirstStep, i.label])).toEqual([
      ['step:seq-1:1', true, 'Fall outreach — step 1'],
      ['step:seq-1:2', false, 'Fall outreach — step 2'],
    ])
  })

  it('keys variants by sequence and variant, scored against the first step body', () => {
    expect(variantItem('seq-1', 'Fall outreach', 'v-1', 'Quick question', BODY)).toEqual({
      key: 'variant:seq-1:v-1', label: 'Fall outreach — subject variant "Quick question"', subject: 'Quick question', body: BODY, isFirstStep: true,
    })
  })

  it('evaluates to the worst item level', () => {
    const items = [...stepItems('s', 'S', [{ stepNumber: 1, subject: 'Snow plan', body: BODY }]), variantItem('s', 'S', 'v', 'Re: hi', BODY)]
    const res = evaluateItems(items, [], [])
    expect(res.level).toBe('HIGH')
    expect(res.items.find((i) => i.key === 'variant:s:v')!.level).toBe('HIGH')
    expect(res.items.find((i) => i.key === 'step:s:1')!.level).toBe('LOW')
  })

  it('an empty campaign is LOW', () => {
    expect(evaluateItems([], [], []).level).toBe('LOW')
  })
})
