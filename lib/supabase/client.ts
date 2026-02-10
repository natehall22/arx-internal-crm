import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

export function createClientBrowser(): SupabaseClient {
  // Check if we're in the browser
  if (typeof window === 'undefined') {
    throw new Error('createClientBrowser() must be called in the browser only.')
  }

  // Return cached client if it exists
  if (browserClient) return browserClient

  // Create new client
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  return browserClient
}

// Safe version that returns null on server
export function getClientBrowser(): SupabaseClient | null {
  if (typeof window === 'undefined') {
    return null
  }
  return createClientBrowser()
}

// Backwards compatibility (in case something still imports createClient)
export const createClient = createClientBrowser
