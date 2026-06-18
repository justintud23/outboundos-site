// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Select } from './select'

describe('Select', () => {
  it('renders a native select with its options and selected value', () => {
    render(
      <Select aria-label="pick" value="b" onChange={vi.fn()}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    )
    const el = screen.getByLabelText('pick') as HTMLSelectElement
    expect(el.tagName).toBe('SELECT')
    expect(el.value).toBe('b')
    cleanup()
  })

  it('fires onChange with the chosen value (native keyboard/mouse accessible)', () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="pick" value="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    )
    fireEvent.change(screen.getByLabelText('pick'), { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalled()
    cleanup()
  })

  it('merges className and forwards native props (disabled)', () => {
    render(
      <Select aria-label="pick" disabled className="w-full">
        <option value="a">A</option>
      </Select>,
    )
    const el = screen.getByLabelText('pick') as HTMLSelectElement
    expect(el.disabled).toBe(true)
    expect(el.className).toContain('w-full')
    // shares the input box treatment (focus ring token)
    expect(el.className).toContain('focus:shadow-[var(--focus-ring)]')
    cleanup()
  })
})
