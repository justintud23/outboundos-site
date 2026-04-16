'use client'

import { useState } from 'react'
import { useSignIn, useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Step = 'identifier' | 'password' | 'redirecting'

export default function SignInPage() {
  const { signIn } = useSignIn()
  const { isSignedIn } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState<Step>('identifier')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Redirect if already signed in
  if (isSignedIn) {
    router.replace('/dashboard')
    return null
  }

  if (!signIn) {
    return (
      <div className="w-full max-w-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-48" />
          <div className="h-4 bg-slate-200 rounded w-64" />
          <div className="h-10 bg-slate-200 rounded" />
          <div className="h-10 bg-slate-200 rounded" />
        </div>
      </div>
    )
  }

  async function handleOAuth(strategy: string) {
    if (!signIn) return
    setError(null)
    setStep('redirecting')
    const { error } = await signIn.sso({
      strategy: strategy as 'oauth_google',
      redirectUrl: '/sso-callback',
      redirectCallbackUrl: '/dashboard',
    })
    if (error) {
      setStep('identifier')
      setError(error.message ?? 'OAuth sign-in failed')
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!signIn || !email.trim()) return
    setError(null)
    setLoading(true)
    const { error } = await signIn.create({ identifier: email })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Invalid email address')
      return
    }
    if (signIn.status === 'needs_first_factor') {
      setStep('password')
    } else if (signIn.status === 'complete') {
      await signIn.finalize({ navigate: () => router.push('/dashboard') })
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!signIn || !password) return
    setError(null)
    setLoading(true)
    const { error } = await signIn.password({ password, identifier: email })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Incorrect password')
      return
    }
    if (signIn.status === 'complete') {
      await signIn.finalize({ navigate: () => router.push('/dashboard') })
    }
  }

  if (step === 'redirecting') {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center mb-4">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-slate-500 text-sm">Redirecting to provider...</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">
          {step === 'identifier' ? 'Sign in' : 'Enter your password'}
        </h1>
        <p className="text-slate-500 text-sm mt-1.5">
          {step === 'identifier'
            ? 'Welcome back. Sign in to your account.'
            : (
              <>
                Signing in as{' '}
                <button
                  onClick={() => { setStep('identifier'); setPassword(''); setError(null); void signIn?.reset() }}
                  className="text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
                >
                  {email}
                </button>
              </>
            )}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {step === 'identifier' && (
        <>
          {/* OAuth buttons */}
          <div className="space-y-2.5 mb-6">
            <OAuthButton onClick={() => handleOAuth('oauth_google')} icon={<GoogleIcon />} label="Continue with Google" />
            <OAuthButton onClick={() => handleOAuth('oauth_linkedin')} icon={<LinkedInIcon />} label="Continue with LinkedIn" />
            <OAuthButton onClick={() => handleOAuth('oauth_microsoft')} icon={<MicrosoftIcon />} label="Continue with Microsoft" />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Email form */}
          <form onSubmit={handleEmailSubmit}>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-base sm:text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full mt-4 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? 'Continuing...' : 'Continue'}
            </button>
          </form>
        </>
      )}

      {step === 'password' && (
        <form onSubmit={handlePasswordSubmit}>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-base sm:text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-medium cursor-pointer transition-colors"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full mt-4 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      )}

      {/* Footer */}
      <p className="text-center text-sm text-slate-500 mt-8">
        Don&apos;t have an account?{' '}
        <Link href="/sign-up" className="text-indigo-600 hover:text-indigo-700 font-medium">
          Sign up
        </Link>
      </p>
    </div>
  )
}

function OAuthButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors cursor-pointer"
    >
      {icon}
      {label}
    </button>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#0A66C2">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  )
}
