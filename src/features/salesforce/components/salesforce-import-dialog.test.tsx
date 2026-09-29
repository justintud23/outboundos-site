// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SalesforceImportDialog } from './salesforce-import-dialog'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

const listViews = [
  { id: 'lv-1', label: 'All Open Leads' },
  { id: 'lv-2', label: 'My Leads' },
]

const preview = {
  total: 42,
  rows: [
    { id: 'sf-1', name: 'Alice Smith', email: 'alice@acme.com', company: 'Acme', title: 'VP Eng' },
    { id: 'sf-2', name: 'Bob Jones', email: 'bob@widgets.io', company: 'Widgets', title: 'CTO' },
  ],
}

async function openAndLoadListViews() {
  render(<SalesforceImportDialog isAdmin={false} onImported={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Import from Salesforce' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/salesforce/list-views?object=Lead'))
}

describe('SalesforceImportDialog', () => {
  it('renders the labelled controls after opening', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ listViews }))
    await openAndLoadListViews()

    expect(screen.getByLabelText('Record type')).toBeInTheDocument()
    expect(await screen.findByLabelText('List view')).toBeInTheDocument()
  })

  it('loads list views for the Leads object on open', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ listViews }))
    await openAndLoadListViews()

    expect(await screen.findByRole('option', { name: 'All Open Leads' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'My Leads' })).toBeInTheDocument()
    expect(screen.getByText('Choose a list view')).toBeInTheDocument()
  })

  it('selecting a view shows the preview count and rows', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/preview')) return Promise.resolve(jsonResponse(preview))
      return Promise.resolve(jsonResponse({ listViews }))
    })
    await openAndLoadListViews()
    await screen.findByRole('option', { name: 'All Open Leads' })

    fireEvent.change(screen.getByLabelText('List view'), { target: { value: 'lv-1' } })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/salesforce/list-views/lv-1/preview?object=Lead'),
    )
    expect(await screen.findByText('42 records in this view')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('alice@acme.com')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('VP Eng')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
  })

  it('shows the 2000-cap notice when the view has more than 2000 records', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/preview')) return Promise.resolve(jsonResponse({ total: 2500, rows: [] }))
      return Promise.resolve(jsonResponse({ listViews }))
    })
    await openAndLoadListViews()
    await screen.findByRole('option', { name: 'All Open Leads' })

    fireEvent.change(screen.getByLabelText('List view'), { target: { value: 'lv-1' } })

    expect(await screen.findByText('Only the first 2,000 will be imported.')).toBeInTheDocument()
  })

  it('shows the admin checkbox only for admins', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ listViews }))
    render(<SalesforceImportDialog isAdmin onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import from Salesforce' }))

    expect(await screen.findByLabelText('Use Salesforce owners where they match a rep')).toBeInTheDocument()
  })

  it('does not show the admin checkbox for non-admins', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ listViews }))
    await openAndLoadListViews()
    await screen.findByRole('option', { name: 'All Open Leads' })

    expect(screen.queryByLabelText('Use Salesforce owners where they match a rep')).not.toBeInTheDocument()
  })

  it('the Import button is disabled before a view is chosen', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ listViews }))
    await openAndLoadListViews()
    await screen.findByRole('option', { name: 'All Open Leads' })

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('Import posts the right body and shows the success and skip lines exactly', async () => {
    const onImported = vi.fn()
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/preview')) return Promise.resolve(jsonResponse(preview))
      if (url === '/api/salesforce/import' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              batchId: 'batch-1',
              imported: 5,
              linked: 2,
              leadIds: ['l-1', 'l-2', 'l-3', 'l-4', 'l-5'],
              skipped: { customer: 8, openOpportunity: 0, optedOut: 3, converted: 0, noEmail: 1, invalid: 0 },
            },
            201,
          ),
        )
      }
      return Promise.resolve(jsonResponse({ listViews }))
    })

    render(<SalesforceImportDialog isAdmin onImported={onImported} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import from Salesforce' }))
    await screen.findByRole('option', { name: 'All Open Leads' })

    fireEvent.change(screen.getByLabelText('List view'), { target: { value: 'lv-1' } })
    await screen.findByText('42 records in this view')

    fireEvent.click(screen.getByLabelText('Use Salesforce owners where they match a rep'))

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/salesforce/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 'Lead',
          listViewId: 'lv-1',
          listViewLabel: 'All Open Leads',
          useSalesforceOwners: true,
        }),
      }),
    )

    expect(await screen.findByText('Imported 5 new leads, linked 2 existing.')).toBeInTheDocument()
    expect(screen.getByText('12 skipped: 8 customers, 3 opted out, 1 no email')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalled()
  })

  it('shows a 409 error in an alert', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/preview')) return Promise.resolve(jsonResponse(preview))
      if (url === '/api/salesforce/import') {
        return Promise.resolve(
          jsonResponse({ code: 'NOT_CONNECTED', error: 'Reconnect Salesforce in Settings.' }, 409),
        )
      }
      return Promise.resolve(jsonResponse({ listViews }))
    })

    await openAndLoadListViews()
    await screen.findByRole('option', { name: 'All Open Leads' })
    fireEvent.change(screen.getByLabelText('List view'), { target: { value: 'lv-1' } })
    await screen.findByText('42 records in this view')

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect Salesforce in Settings.')
  })
})
