import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))

// A fake SignUpFuture: methods resolve { error } and mutate status/fields the
// way Clerk's resource does between calls.
const signUp = {
  status: 'missing_requirements' as string,
  missingFields: [] as string[],
  unverifiedFields: [] as string[],
  password: vi.fn(),
  finalize: vi.fn(),
  sso: vi.fn(),
  verifications: { sendEmailCode: vi.fn(), verifyEmailCode: vi.fn() },
}
const auth = { isSignedIn: false }
vi.mock('@clerk/nextjs', () => ({
  useSignUp: () => ({ signUp }),
  useAuth: () => auth,
}))

import SignUpPage from './page'

async function submitEmailPassword() {
  render(<SignUpPage />)
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'mike_snow' } })
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'rep@example.com' } })
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'correct-horse-9' } })
  fireEvent.click(screen.getByRole('button', { name: /create account/i }))
}

async function enterEmailCode() {
  fireEvent.change(await screen.findByLabelText(/verification code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: /verify email/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.isSignedIn = false
  signUp.status = 'missing_requirements'
  signUp.missingFields = []
  signUp.unverifiedFields = []
  signUp.password.mockImplementation(async () => { signUp.unverifiedFields = ['email_address']; return { error: null } })
  signUp.verifications.sendEmailCode.mockResolvedValue({ error: null })
  signUp.verifications.verifyEmailCode.mockImplementation(async () => {
    signUp.unverifiedFields = []
    signUp.status = 'complete'
    return { error: null }
  })
  signUp.finalize.mockImplementation(async ({ navigate }: { navigate: () => void }) => { navigate(); return { error: null } })
})

describe('SignUpPage', () => {
  it('sends the username with the email and password, verifies the email, then finishes', async () => {
    await submitEmailPassword()
    await waitFor(() =>
      expect(signUp.password).toHaveBeenCalledWith({ emailAddress: 'rep@example.com', password: 'correct-horse-9', username: 'mike_snow' }),
    )
    expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1)
    await enterEmailCode()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
  })

  it('shows Clerk\u2019s error when the username is taken', async () => {
    signUp.password.mockResolvedValue({ error: { message: 'That username is taken. Please try another.' } })
    await submitEmailPassword()
    expect(await screen.findByRole('alert')).toHaveTextContent(/username is taken/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('returning from Google still needing a username explains what to do instead of a stuck form', async () => {
    signUp.missingFields = ['username']
    render(<SignUpPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/email and password/i)
  })

  it('never silently resets: an unsupported requirement shows an error', async () => {
    signUp.password.mockImplementation(async () => {
      signUp.unverifiedFields = ['email_address']
      signUp.missingFields = ['phone_number']
      return { error: null }
    })
    signUp.verifications.verifyEmailCode.mockImplementation(async () => { signUp.unverifiedFields = []; return { error: null } })
    await submitEmailPassword()
    await enterEmailCode()
    expect(await screen.findByRole('alert')).toHaveTextContent(/phone_number/)
    expect(push).not.toHaveBeenCalled()
  })

  it('already signed in: redirects to the dashboard and shows a message instead of a blank page', async () => {
    auth.isSignedIn = true
    render(<SignUpPage />)
    expect(screen.getByText(/redirecting/i)).toBeInTheDocument()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
  })
})
