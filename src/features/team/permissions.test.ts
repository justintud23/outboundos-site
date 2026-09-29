import { describe, it, expect } from 'vitest'
import { canAct, assertCanAct, assertAdmin, NotOwnerError, AdminOnlyError } from './permissions'

const admin = { isAdmin: true, member: { id: 'm-admin' } }
const rep = { isAdmin: false, member: { id: 'm-rep' } }

describe('canAct', () => {
  it('admins can act on anything, including unassigned', () => {
    expect(canAct(admin, 'm-other')).toBe(true)
    expect(canAct(admin, null)).toBe(true)
  })
  it('members can act only on what they own', () => {
    expect(canAct(rep, 'm-rep')).toBe(true)
    expect(canAct(rep, 'm-other')).toBe(false)
    expect(canAct(rep, null)).toBe(false)
  })
  it('assert helpers throw typed errors', () => {
    expect(() => assertCanAct(rep, 'm-other')).toThrow(NotOwnerError)
    expect(() => assertAdmin(rep)).toThrow(AdminOnlyError)
    expect(() => assertAdmin(admin)).not.toThrow()
  })
})
