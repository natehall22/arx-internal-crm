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
