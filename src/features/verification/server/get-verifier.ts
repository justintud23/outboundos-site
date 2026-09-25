import type { EmailVerifier } from '../provider'
import { createMillionVerifier } from './millionverifier'

// One platform key for now (per-org keys are out of scope). No key means
// verification is off and sending behaves exactly as before.
export function isVerificationConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.MILLIONVERIFIER_API_KEY?.trim()
}

export function getVerifier(env: NodeJS.ProcessEnv = process.env): EmailVerifier | null {
  const key = env.MILLIONVERIFIER_API_KEY?.trim()
  return key ? createMillionVerifier(key) : null
}
