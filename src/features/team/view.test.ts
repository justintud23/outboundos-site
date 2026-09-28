import { describe, it, expect } from 'vitest'
import { resolveView, ownerFilterFor } from './view'

describe('resolveView', () => {
  it('defaults to mine for members and team for admins', () => {
    expect(resolveView(false, undefined)).toBe('mine')
    expect(resolveView(true, undefined)).toBe('team')
  })
  it('honors a valid param and ignores junk', () => {
    expect(resolveView(false, 'team')).toBe('team')
    expect(resolveView(true, 'mine')).toBe('mine')
    expect(resolveView(false, 'everything')).toBe('mine')
    expect(resolveView(true, ['mine', 'team'])).toBe('mine')
  })
})

describe('ownerFilterFor', () => {
  it('filters by me only in mine view', () => {
    expect(ownerFilterFor('mine', 'm1')).toBe('m1')
    expect(ownerFilterFor('team', 'm1')).toBeUndefined()
  })
})
