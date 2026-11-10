export const dynamic = "force-dynamic"
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { saveGoogleConnection } from '@/lib/google-calendar'
import { acceptOAuthCallback, isSignedOAuthState } from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Connect started on a company web address: check the signed ticket and park the code on it (no cookie here, no
 * connection stored yet), then send the browser to its company's own finish step, which only completes in the
 * browser that started the connect and for the ticket's own user (lib/google-oauth-state.ts).
 */
async function handleSignedState(request: NextRequest, state: string, code: string | null): Promise<NextResponse> {
  const check = await acceptOAuthCallback(createServiceClient(), state, code)
  if (!check.ok) {
    console.error('Google OAuth signed state refused:', check.reason)
    return NextResponse.redirect(new URL(`/settings?error=${check.reason === 'unavailable' ? 'callback_failed' : 'invalid_state'}`, request.url))
  }
  if (!code) return NextResponse.redirect(new URL('/settings?error=oauth_denied', check.returnOrigin))
  const finish = new URL('/api/auth/google/finish', check.returnOrigin)
  finish.searchParams.set('nonce', check.nonce)
  return NextResponse.redirect(finish)
}

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
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
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state') // legacy: user id; company address: signed ticket
    const error = searchParams.get('error')

    if (error) {
      console.error('Google OAuth error:', error)
      // Signed ticket: burn it and send the user back to their own company address (the cookie lives there).
      if (state && isSignedOAuthState(state)) return await handleSignedState(request, state, null)
      return NextResponse.redirect(new URL('/settings?error=oauth_denied', request.url))
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/settings?error=missing_params', request.url))
    }

    if (isSignedOAuthState(state)) return await handleSignedState(request, state, code)

    const { client: authClient, accessToken } = getAuthClient(request)
    const adminClient = createServiceClient()
    
    // Verify the user is authenticated and matches the state
    const { data: { user } } = await authClient.auth.getUser(accessToken || '')
    if (!user || user.id !== state) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Get user's org_id using admin client
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.redirect(new URL('/settings?error=no_profile', request.url))
    }

    if (!(await saveGoogleConnection(adminClient, code, user.id, profile.org_id))) {
      return NextResponse.redirect(new URL('/settings?error=token_storage', request.url))
    }

    // Success - redirect back to settings page
    return NextResponse.redirect(new URL('/settings?success=calendar_connected', request.url))
  } catch (error) {
    console.error('Google callback error:', error)
    return NextResponse.redirect(new URL('/settings?error=callback_failed', request.url))
  }
}
