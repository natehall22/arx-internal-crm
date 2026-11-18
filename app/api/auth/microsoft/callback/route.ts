import { NextRequest, NextResponse } from 'next/server'

import { acceptOAuthCallback, isSignedOAuthState } from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Microsoft's ONE redirect address (MICROSOFT_REDIRECT_URI). No session cookie is relied on: check the signed
 * single-use ticket, park the one-time code on it, and send the browser to its own company's finish step, which only
 * completes for the user who started the connect, in the browser that started it. A bare/unsigned state is refused.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const state = p.get('state')
  const code = p.get('code')
  const refuse = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, request.url))
  if (!state || !isSignedOAuthState(state)) return refuse('error=invalid_state')
  try {
    const denied = p.get('error') || !code
    const check = await acceptOAuthCallback(createServiceClient(), state, denied ? null : code, Date.now(), {
      purpose: 'microsoft',
      sameOrigin: request.nextUrl.origin,
    })
    if (!check.ok) {
      console.error('Microsoft OAuth state refused:', check.reason)
      return refuse(check.reason === 'unavailable' ? 'error=callback_failed' : 'error=invalid_state')
    }
    if (denied) return NextResponse.redirect(new URL('/settings?error=oauth_denied', check.returnOrigin))
    const finish = new URL('/api/auth/microsoft/finish', check.returnOrigin)
    finish.searchParams.set('nonce', check.nonce)
    return NextResponse.redirect(finish)
  } catch (e) {
    console.error('Microsoft callback error:', e instanceof Error ? e.message : e)
    return refuse('error=callback_failed')
  }
}
