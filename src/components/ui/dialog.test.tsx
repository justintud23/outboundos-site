// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { Dialog } from './dialog'

describe('Dialog', () => {
  it('renders as an accessible modal dialog labelled by its title', () => {
    render(
      <Dialog title="My Dialog" onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // aria-labelledby points at the heading.
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId as string)?.textContent).toBe('My Dialog')
    cleanup()
  })

  it('renders footer content and body children', () => {
    render(
      <Dialog title="T" onClose={vi.fn()} footer={<button>Save</button>}>
        <p>Hello body</p>
      </Dialog>,
    )
    expect(screen.getByText('Hello body')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
    cleanup()
  })

  it('closes on Escape, the close button, and backdrop click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Dialog title="T" onClose={onClose}>
        <p>x</p>
      </Dialog>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(2)

    // Backdrop is the aria-hidden overlay.
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(3)
    cleanup()
  })

  it('does NOT close (Escape / backdrop / button) while busy', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Dialog title="T" onClose={onClose} busy>
        <p>x</p>
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(container.querySelector('[aria-hidden="true"]') as HTMLElement)
    const closeBtn = screen.getByLabelText('Close') as HTMLButtonElement
    expect(closeBtn.disabled).toBe(true)
    fireEvent.click(closeBtn)
    expect(onClose).not.toHaveBeenCalled()
    cleanup()
  })

  it('moves focus into the panel on open', () => {
    render(
      <Dialog title="T" onClose={vi.fn()}>
        <input aria-label="field" />
      </Dialog>,
    )
    // Focus is inside the dialog (the panel itself, tabIndex=-1).
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    cleanup()
  })

  it('restores focus to the previously-focused element when closed', () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && (
            <Dialog title="T" onClose={() => setOpen(false)}>
              <p>x</p>
            </Dialog>
          )}
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    // sanity: dialog open
    expect(screen.getByRole('dialog')).toBeDefined()
    // close via Escape → unmount → focus restored to opener
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
    cleanup()
  })

  it('traps Tab focus within the panel (wraps last → first)', () => {
    render(
      <Dialog title="T" onClose={vi.fn()} footer={<button>last-btn</button>}>
        <input aria-label="first-field" />
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    const last = screen.getByRole('button', { name: 'last-btn' })
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    // Wrapped back to the first focusable (the close button).
    expect(document.activeElement).toBe(screen.getByLabelText('Close'))
    cleanup()
  })
})
