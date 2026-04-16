'use client'

import { HandleSSOCallback } from '@clerk/react'
import { useRouter } from 'next/navigation'

export default function SSOCallbackPage() {
  const router = useRouter()

  return (
    <div className="w-full max-w-sm text-center">
      <div className="flex items-center justify-center mb-4">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-slate-500 text-sm">Completing sign-in...</p>
      <HandleSSOCallback
        navigateToApp={() => router.push('/dashboard')}
        navigateToSignIn={() => router.push('/sign-in')}
        navigateToSignUp={() => router.push('/sign-up')}
      />
    </div>
  )
}
