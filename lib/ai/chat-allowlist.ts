import type { AuthContext } from '@/lib/auth'

/**
 * TEMPORARY rollout gate — CRM AI assistant is limited to this email allowlist.
 * Remove this file (and all call sites) when rolling out org-wide.
 */
export const AI_ASSISTANT_ALLOWLISTED_EMAILS = ['nathan@arxroofing.com'] as const

export function normalizeAiAssistantEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export function isAiAssistantAllowlistedEmail(email: string | null | undefined): boolean {
  const normalized = normalizeAiAssistantEmail(email)
  if (!normalized) return false
  return AI_ASSISTANT_ALLOWLISTED_EMAILS.some((allowed) => allowed === normalized)
}

/** Prefer Supabase auth email; fall back to CRM profile email when present. */
export function resolveAiAssistantEmail(auth: {
  authUser: { email: string | null }
  profile: { email?: string | null }
}): string | null {
  return auth.authUser.email ?? auth.profile.email ?? null
}

export function isAiAssistantAllowlistedAuth(auth: AuthContext): boolean {
  return isAiAssistantAllowlistedEmail(resolveAiAssistantEmail(auth))
}
