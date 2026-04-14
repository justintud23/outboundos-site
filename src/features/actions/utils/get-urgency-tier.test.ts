import { describe, it, expect } from 'vitest'
import { getUrgencyTier, ACTION_PRIORITY } from '../types'

describe('getUrgencyTier', () => {
  it('returns "high" for priority >= 90', () => {
    expect(getUrgencyTier(100)).toBe('high')
    expect(getUrgencyTier(90)).toBe('high')
  })

  it('returns "medium" for priority 70-89', () => {
    expect(getUrgencyTier(89)).toBe('medium')
    expect(getUrgencyTier(80)).toBe('medium')
    expect(getUrgencyTier(70)).toBe('medium')
  })

  it('returns "low" for priority < 70', () => {
    expect(getUrgencyTier(69)).toBe('low')
    expect(getUrgencyTier(60)).toBe('low')
    expect(getUrgencyTier(50)).toBe('low')
    expect(getUrgencyTier(0)).toBe('low')
  })

  it('maps REVIEW_REPLY to high', () => {
    expect(getUrgencyTier(ACTION_PRIORITY.REVIEW_REPLY)).toBe('high')
  })

  it('maps APPROVE_DRAFT to high', () => {
    expect(getUrgencyTier(ACTION_PRIORITY.APPROVE_DRAFT)).toBe('high')
  })

  it('maps SEND_DRAFT to medium', () => {
    expect(getUrgencyTier(ACTION_PRIORITY.SEND_DRAFT)).toBe('medium')
  })

  it('maps FOLLOW_UP to medium', () => {
    expect(getUrgencyTier(ACTION_PRIORITY.FOLLOW_UP)).toBe('medium')
  })

  it('maps ENROLL_SEQUENCE to low', () => {
    expect(getUrgencyTier(ACTION_PRIORITY.ENROLL_SEQUENCE)).toBe('low')
  })

  it('maps MARK_CONVERTED to low', () => {
    expect(getUrgencyTier(ACTION_PRIORITY.MARK_CONVERTED)).toBe('low')
  })
})
