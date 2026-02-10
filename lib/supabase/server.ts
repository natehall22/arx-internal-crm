import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Get project ref for cookie name
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  // Try to get the auth cookie (might be single or chunked)
  let sessionData: any = null
  
  const allCookies = cookieStore.getAll()
  const singleCookie = allCookies.find(c => c.name === cookieName)
  
  if (singleCookie?.value) {
    try {
      sessionData = JSON.parse(singleCookie.value)
    } catch {
      // Failed to parse
    }
  }

  // Try chunked cookies if single didn't work
  if (!sessionData) {
    const chunks: string[] = []
    let i = 0
    while (true) {
      const chunk = allCookies.find(c => c.name === `${cookieName}.${i}`)
      if (!chunk?.value) break
      chunks.push(chunk.value)
      i++
    }
    if (chunks.length > 0) {
      try {
        sessionData = JSON.parse(chunks.join(''))
      } catch {
        // Failed to parse
      }
    }
  }

  // Create client with access token if available
  const client = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: sessionData?.access_token
      ? {
          headers: {
            Authorization: `Bearer ${sessionData.access_token}`,
          },
        }
      : undefined,
  })

  return client
}

export { createClient as createServerClient }
