import { describe, it, expect } from 'vitest'
import { permissionErrorResponse, denyUnlessCanAct, denyUnlessAdmin } from './permission-response'
import { NotOwnerError, AdminOnlyError } from '@/features/team/permissions'

const admin = { isAdmin: true, member: { id: 'm-admin' } }
const rep = { isAdmin: false, member: { id: 'm-rep' } }

describe('permissionErrorResponse', () => {
  it('maps NotOwnerError to a 403 NOT_OWNER response', async () => {
    const res = permissionErrorResponse(new NotOwnerError())
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' })
  })

  it('maps AdminOnlyError to a 403 ADMIN_ONLY response', async () => {
    const res = permissionErrorResponse(new AdminOnlyError())
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ code: 'ADMIN_ONLY', error: 'Only an admin can do this.' })
  })

  it('returns null for any other error', () => {
    expect(permissionErrorResponse(new Error('boom'))).toBeNull()
    expect(permissionErrorResponse(undefined)).toBeNull()
  })
})

describe('denyUnlessCanAct', () => {
  it('returns null when the entity was not found (ownerId undefined) — let the route 404', () => {
    expect(denyUnlessCanAct(rep, undefined)).toBeNull()
    expect(denyUnlessCanAct(admin, undefined)).toBeNull()
  })

  it('returns null when the caller can act', () => {
    expect(denyUnlessCanAct(rep, 'm-rep')).toBeNull()
    expect(denyUnlessCanAct(admin, 'm-other')).toBeNull()
    expect(denyUnlessCanAct(admin, null)).toBeNull()
  })

  it('returns a 403 NOT_OWNER response when the caller cannot act', async () => {
    const res = denyUnlessCanAct(rep, 'm-other')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' })
  })

  it('denies a member on an unassigned (admin-only) entity', async () => {
    const res = denyUnlessCanAct(rep, null)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('uses the default message when no override is given', async () => {
    const res = denyUnlessCanAct(rep, 'm-other')
    expect(await res!.json()).toEqual({ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' })
  })

  it('uses a custom message when one is given', async () => {
    const res = denyUnlessCanAct(rep, 'm-other', 'You can only change your own settings.')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ code: 'NOT_OWNER', error: 'You can only change your own settings.' })
  })

  it('does not apply the custom message when the caller can act', () => {
    expect(denyUnlessCanAct(rep, 'm-rep', 'You can only change your own settings.')).toBeNull()
    expect(denyUnlessCanAct(admin, 'm-other', 'You can only change your own settings.')).toBeNull()
  })
})

describe('denyUnlessAdmin', () => {
  it('returns null for admins', () => {
    expect(denyUnlessAdmin(admin)).toBeNull()
  })

  it('returns a 403 ADMIN_ONLY response for members', async () => {
    const res = denyUnlessAdmin(rep)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ code: 'ADMIN_ONLY', error: 'Only an admin can do this.' })
  })
})
