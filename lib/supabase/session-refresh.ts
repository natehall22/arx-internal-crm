import type { NextResponse } from 'next/server'

/**
 * Session refresh helpers — shared by middleware.ts and /api/auth/refresh.
 * Edge-runtime safe (fetch only, no Node APIs).
 * Cookie format must stay in sync with app/api/auth/login/route.ts
 * and lib/supabase/session-cookie.ts.
 */

const MAX_CHUNK_SIZE = 3500
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days — matches login route

/** Refresh when the access token is within this many seconds of expiry. */
export const REFRESH_BUFFER_SECONDS = 5 * 60

export type SupabaseSession = {
  access_token: string
  refresh_token: string
  expires_at?: number // unix seconds
  expires_in?: number
  token_type?: string
  user?: unknown
}

export function getSessionCookieName(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  return `sb-${projectRef}-auth-token`
}

export function isExpiringSoon(
  expiresAt: number | undefined,
  bufferSeconds: number = REFRESH_BUFFER_SECONDS
): boolean {
  if (!expiresAt) return false
  return Date.now() > (expiresAt - bufferSeconds) * 1000
}

export function isExpired(expiresAt: number | undefined): boolean {
  if (!expiresAt) return false
  return Date.now() > expiresAt * 1000
}

/**
 * Exchange a refresh token for a new session via the Supabase GoTrue
 * token endpoint. Returns null on any failure (caller decides fallback).
 * Note: Supabase rotates refresh tokens; the old token is reusable only
 * within the project's reuse interval (~10s default), which absorbs
 * near-simultaneous refreshes from parallel requests.
 */
export async function refreshSupabaseSession(
  refreshToken: string
): Promise<SupabaseSession | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return null

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.log('session-refresh: token endpoint returned', res.status)
      return null
    }

    const data = await res.json()
    if (!data?.access_token || !data?.refresh_token) return null

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at:
        data.expires_at ??
        (data.expires_in
          ? Math.floor(Date.now() / 1000) + Number(data.expires_in)
          : undefined),
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user,
    }
  } catch (e) {
    console.log('session-refresh: fetch failed', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Write the session onto a response as a single or chunked cookie
 * (same layout the login route produces), and expire any leftover
 * cookies from a previous single/chunked layout so parsing never
 * picks up stale chunks.
 */
export function writeSessionCookies(
  res: NextResponse,
  existingCookieNames: string[],
  session: SupabaseSession,
  isSecure: boolean
): void {
  const cookieName = getSessionCookieName()
  const value = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type ?? 'bearer',
    user: session.user,
  })

  const options = {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax' as const,
    maxAge: COOKIE_MAX_AGE,
  }

  const written = new Set<string>()

  if (value.length <= MAX_CHUNK_SIZE) {
    res.cookies.set(cookieName, value, options)
    written.add(cookieName)
  } else {
    for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
      const chunkName = `${cookieName}.${i}`
      res.cookies.set(
        chunkName,
        value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
        options
      )
      written.add(chunkName)
    }
  }

  for (const name of existingCookieNames) {
    if (
      !written.has(name) &&
      (name === cookieName || name.startsWith(`${cookieName}.`))
    ) {
      res.cookies.set(name, '', { ...options, maxAge: 0 })
    }
  }
}
