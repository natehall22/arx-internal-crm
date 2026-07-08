/**
 * Parse Supabase auth session from Next.js cookies (single or chunked).
 * Must stay in sync with lib/auth.ts — URL-encoded cookies are common in production.
 */
export function getSupabaseSessionFromCookieStore(cookieStore: {
  getAll: () => { name: string; value: string }[]
}): { access_token?: string; refresh_token?: string; expires_at?: number } | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  let sessionData: {
    access_token?: string
    refresh_token?: string
    expires_at?: number
  } | null = null
  const allCookies = cookieStore.getAll()
  const singleCookie = allCookies.find((c) => c.name === cookieName)

  if (singleCookie?.value) {
    try {
      sessionData = JSON.parse(decodeURIComponent(singleCookie.value))
    } catch {
      try {
        sessionData = JSON.parse(singleCookie.value)
      } catch {
        // Failed to parse
      }
    }
  }

  if (!sessionData) {
    const chunks: string[] = []
    let i = 0
    while (true) {
      const chunk = allCookies.find((c) => c.name === `${cookieName}.${i}`)
      if (!chunk?.value) break
      chunks.push(chunk.value)
      i++
    }
    if (chunks.length > 0) {
      const joined = chunks.join('')
      try {
        sessionData = JSON.parse(decodeURIComponent(joined))
      } catch {
        try {
          sessionData = JSON.parse(joined)
        } catch {
          // Failed to parse
        }
      }
    }
  }

  return sessionData
}
