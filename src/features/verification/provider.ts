// Provider-agnostic email verification contract. A verifier answers one
// address at a time; `account` outcomes (no credits, bad key) mean every
// further call would fail too, so the caller stops the whole run.

export type ProviderResult = 'ok' | 'catch_all' | 'unknown' | 'invalid' | 'disposable'

export type VerifyOutcome =
  | { kind: 'result'; result: ProviderResult }
  | { kind: 'retry'; reason: string }
  | { kind: 'account'; reason: 'no_credits' | 'bad_key' }

export interface EmailVerifier {
  verify(email: string): Promise<VerifyOutcome>
}
