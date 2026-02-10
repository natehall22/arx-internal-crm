import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

export function createClientBrowser(): SupabaseClient {
  // During SSR/prerender, return a dummy client that won't be used
  // The actual client will be created on the client side
  if (typeof window === 'undefined') {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
    )
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
