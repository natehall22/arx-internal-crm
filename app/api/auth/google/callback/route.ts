export const dynamic = "force-dynamic"
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exchangeCodeForTokens } from '@/lib/google-calendar'
import { consumeOAuthState, isSignedOAuthState } from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

type AdminClient = ReturnType<typeof createServiceClient>

/** Exchange the one-time code and store the user's tokens (both flows). Returns false when storing failed. */
async function storeGoogleTokens(adminClient: AdminClient, code: string, userId: string, orgId: string): Promise<boolean> {
  const tokens = await exchangeCodeForTokens(code)
  const { error: upsertError } = await adminClient
    .from('user_google_tokens')
    .upsert({
      user_id: userId,
      org_id: orgId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_at: tokens.expires_at.toISOString(),
      scope: tokens.scope,
    }, {
      onConflict: 'user_id'
    })
  if (upsertError) {
    console.error('Failed to store tokens:', upsertError)
    return false
  }
  return true
}

/**
 * Connect started on a company web address: authorize from the signed single-use state, never the cookie (it isn't
 * sent to this host), and return to the company's own address — validated against its org, not taken from the request.
 */
async function handleSignedState(request: NextRequest, state: string, code: string): Promise<NextResponse> {
  const adminClient = createServiceClient()
  const check = await consumeOAuthState(adminClient, state)
  if (!check.ok) {
    console.error('Google OAuth signed state refused:', check.reason)
    return NextResponse.redirect(new URL(`/settings?error=${check.reason === 'unavailable' ? 'callback_failed' : 'invalid_state'}`, request.url))
  }
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, check.returnOrigin))
  try {
    const stored = await storeGoogleTokens(adminClient, code, check.userId, check.orgId)
    return back(stored ? 'success=calendar_connected' : 'error=token_storage')
  } catch (e) {
    console.error('Google callback error (signed state):', e)
    return back('error=callback_failed')
  }
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
      if (state && isSignedOAuthState(state)) {
        // Send the user back to their own company address (the cookie lives there), burning the ticket.
        const check = await consumeOAuthState(createServiceClient(), state)
        if (check.ok) return NextResponse.redirect(new URL('/settings?error=oauth_denied', check.returnOrigin))
      }
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

    if (!(await storeGoogleTokens(adminClient, code, user.id, profile.org_id))) {
      return NextResponse.redirect(new URL('/settings?error=token_storage', request.url))
    }

    // Success - redirect back to settings page
    return NextResponse.redirect(new URL('/settings?success=calendar_connected', request.url))
  } catch (error) {
    console.error('Google callback error:', error)
    return NextResponse.redirect(new URL('/settings?error=callback_failed', request.url))
  }
}
