import type { AuthContext } from '@/lib/auth'

/**
 * TEMPORARY rollout gate — CRM AI assistant is limited to this email allowlist.
 * Remove this file (and all call sites) when rolling out org-wide.
 *
 * Include both Nathan's CRM address and the Google account he may actually
 * authenticate with — auth email and profile email can diverge.
 */
export const AI_ASSISTANT_ALLOWLISTED_EMAILS = [
  'nathan@arxroofing.com',
  'natehall22@gmail.com',
] as const

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

/**
 * Allow if either auth or profile email is on the list.
 * Preferring auth-only would hide the assistant when Nathan signs in with
 * gmail while his CRM profile still lists nathan@arxroofing.com.
 */
export function isAiAssistantAllowlistedAuth(auth: AuthContext): boolean {
  return (
    isAiAssistantAllowlistedEmail(auth.authUser.email) ||
    isAiAssistantAllowlistedEmail(auth.profile.email)
  )
}
