// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ActionItem } from './action-item'
import type { NextAction } from '../types'

const failed: NextAction = {
  id: 'a1',
  type: 'RETRY_FAILED_SEND',
  priority: 85,
  label: 'Failed Send',
  leadId: 'lead-1',
  leadName: 'Jane',
  draftId: 'draft-1',
  messageId: 'msg-1',
  createdAt: new Date('2026-09-20'),
}

describe('ActionItem — failed send', () => {
  it('retries inline instead of linking to Drafts (where Send would be wrong)', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ActionItem action={failed} />)
    expect(screen.queryByRole('link', { name: /retry|review/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/messages/msg-1/retry', { method: 'POST' })
    vi.unstubAllGlobals()
  })
})
