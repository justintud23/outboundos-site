import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))

// A fake SignInFuture: each method resolves { error } and moves `status`,
// mirroring how Clerk mutates the signIn resource between calls.
const signIn = {
  status: 'needs_identifier' as string,
  create: vi.fn(),
  password: vi.fn(),
  finalize: vi.fn(),
  reset: vi.fn(),
  sso: vi.fn(),
  mfa: { sendEmailCode: vi.fn(), verifyEmailCode: vi.fn() },
}
vi.mock('@clerk/nextjs', () => ({
  useSignIn: () => ({ signIn }),
  useAuth: () => ({ isSignedIn: false }),
}))

import SignInPage from './page'

async function reachPasswordStep() {
  render(<SignInPage />)
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'j@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
  await screen.findByLabelText(/password/i)
}

async function submitPassword() {
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } })
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  signIn.status = 'needs_identifier'
  signIn.create.mockImplementation(async () => { signIn.status = 'needs_first_factor'; return { error: null } })
  signIn.finalize.mockImplementation(async ({ navigate }: { navigate: () => void }) => { navigate(); return { error: null } })
  signIn.mfa.sendEmailCode.mockResolvedValue({ error: null })
})

describe('SignInPage', () => {
  it('completes a normal password sign-in', async () => {
    signIn.password.mockImplementation(async () => { signIn.status = 'complete'; return { error: null } })
    await reachPasswordStep()
    await submitPassword()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
  })

  it.each(['needs_client_trust', 'needs_second_factor'])(
    'when Clerk returns %s after the password, it emails a code and finishes sign-in with it',
    async (status) => {
      signIn.password.mockImplementation(async () => { signIn.status = status; return { error: null } })
      signIn.mfa.verifyEmailCode.mockImplementation(async () => { signIn.status = 'complete'; return { error: null } })
      await reachPasswordStep()
      await submitPassword()

      const codeInput = await screen.findByLabelText(/verification code/i)
      expect(signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()

      fireEvent.change(codeInput, { target: { value: '424242' } })
      fireEvent.click(screen.getByRole('button', { name: /verify/i }))
      await waitFor(() => expect(signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({ code: '424242' }))
      await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    },
  )

  it('shows an error when the emailed code is wrong', async () => {
    signIn.password.mockImplementation(async () => { signIn.status = 'needs_client_trust'; return { error: null } })
    signIn.mfa.verifyEmailCode.mockResolvedValue({ error: { message: 'Incorrect code' } })
    await reachPasswordStep()
    await submitPassword()
    fireEvent.change(await screen.findByLabelText(/verification code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /verify/i }))
    expect(await screen.findByText('Incorrect code')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('never silently resets: an unsupported status shows an error', async () => {
    signIn.password.mockImplementation(async () => { signIn.status = 'needs_new_password'; return { error: null } })
    await reachPasswordStep()
    await submitPassword()
    expect(await screen.findByRole('alert')).toHaveTextContent(/password/i)
    expect(push).not.toHaveBeenCalled()
  })
})
