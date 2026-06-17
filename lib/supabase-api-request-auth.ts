import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

/** Parse Supabase auth JSON from sb-<ref>-auth-token cookie (single or chunked). */
export function getSupabaseSessionFromCookies(req: NextRequest): Record<string, unknown> | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded) as Record<string, unknown>
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }

  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded) as Record<string, unknown>
    } catch {
      return null
    }
  }

  return null
}

/**
 * Prefer `Authorization: Bearer` (same token the calendar gets from /api/calendar/profile),
 * then the session cookie. Prevents 401 on PATCH when the cookie is missing or stale while
 * the client still holds a valid access token.
 */
export function getAccessTokenFromApiRequest(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  const sessionData = getSupabaseSessionFromCookies(req)
  const token = sessionData?.access_token
  return typeof token === 'string' && token.length > 0 ? token : null
}

/** Candidate tokens in priority order: Bearer header, then session cookie (deduped). */
export function getAccessTokenCandidatesFromApiRequest(req: NextRequest): string[] {
  const candidates: string[] = []
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim()
    if (t) candidates.push(t)
  }
  const sessionData = getSupabaseSessionFromCookies(req)
  const cookieToken = sessionData?.access_token
  if (typeof cookieToken === 'string' && cookieToken.length > 0 && !candidates.includes(cookieToken)) {
    candidates.push(cookieToken)
  }
  return candidates
}

/**
 * Resolve the auth user from Bearer and/or cookie tokens. When the client sends a stale
 * Bearer (common on the calendar page), fall back to a valid session cookie.
 */
export async function resolveApiRequestAuthUser(req: NextRequest): Promise<{
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }
  accessToken: string
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const tokens = getAccessTokenCandidatesFromApiRequest(req)
  if (tokens.length === 0) return null

  const authClient = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  for (const token of tokens) {
    const { data: { user }, error } = await authClient.auth.getUser(token)
    if (!error && user) {
      return { user, accessToken: token }
    }
  }
  return null
}
