import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findUnique: vi.fn() } } }))
vi.mock('@/lib/cron', () => ({ getStaleJobs: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { getStaleJobs } from '@/lib/cron'
import { SystemBanner } from './system-banner'

type Fn = ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  ;(auth as Fn).mockResolvedValue({ orgId: 'test-org' })
  ;(prisma.organization.findUnique as Fn).mockResolvedValue({
    sendingPaused: false,
    pausedReason: null,
    msTenantId: 'test-tenant',
    postalAddress: '1 Main St, Buffalo, NY 14201',
  })
  ;(getStaleJobs as Fn).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SystemBanner', () => {
  it('returns null when org not found (graceful error handling)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(prisma.organization.findUnique as Fn).mockRejectedValue(new Error('DB connection failed'))

    const result = await SystemBanner()
    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('[SystemBanner]', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })

  it('returns null when org has no msTenantId', async () => {
    ;(prisma.organization.findUnique as Fn).mockResolvedValue({
      sendingPaused: false,
      pausedReason: null,
      msTenantId: null,
    })

    const result = await SystemBanner()
    expect(result).toBeNull()
  })

  it('returns banner element when org has sendingPaused true', async () => {
    ;(prisma.organization.findUnique as Fn).mockResolvedValue({
      sendingPaused: true,
      pausedReason: 'Weekly maintenance',
      msTenantId: 'test-tenant',
      postalAddress: '1 Main St, Buffalo, NY 14201',
    postalAddress: '1 Main St, Buffalo, NY 14201',
    })

    const result = await SystemBanner()
    expect(result).not.toBeNull()
  })

  it('returns null when no alerts needed', async () => {
    ;(prisma.organization.findUnique as Fn).mockResolvedValue({
      sendingPaused: false,
      pausedReason: null,
      msTenantId: 'test-tenant',
      postalAddress: '1 Main St, Buffalo, NY 14201',
    postalAddress: '1 Main St, Buffalo, NY 14201',
    })
    ;(getStaleJobs as Fn).mockResolvedValue([])

    const result = await SystemBanner()
    expect(result).toBeNull()
  })

  it('returns banner when stale jobs detected', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue(['send-queue', 'inbox-monitor'])

    const result = await SystemBanner()
    expect(result).not.toBeNull()
  })

  it('handles auth() errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(auth as Fn).mockRejectedValue(new Error('Clerk auth unavailable'))

    const result = await SystemBanner()
    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('[SystemBanner]', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })

  it('handles getStaleJobs() errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(getStaleJobs as Fn).mockRejectedValue(new Error('Stale jobs check failed'))

    const result = await SystemBanner()
    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('[SystemBanner]', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })

  it('CAN-SPAM: warns that sending is blocked when there is no mailing address', async () => {
    ;(prisma.organization.findUnique as Fn).mockResolvedValue({
      sendingPaused: false,
      pausedReason: null,
      msTenantId: 'test-tenant',
      postalAddress: null,
    })
    const result = await SystemBanner()
    render(result!)
    expect(screen.getByText(/add your business mailing address/i)).toBeInTheDocument()
  })
})
