import { NextRequest, NextResponse } from 'next/server'

import { acceptOAuthCallback, isSignedOAuthState } from '@/lib/google-oauth-state'
import { packCallback, qbReturn } from '@/lib/quickbooks/connect-flow'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Intuit's ONE redirect address (INTUIT_REDIRECT_URI). No session cookie is relied on here (a company address's cookie
 * is host-only): check the signed single-use ticket, park Intuit's one-time code + realm on it, and send the browser
 * to its own company's finish step, which only completes for the owner who started the connect, in the browser that
 * started it (lib/google-oauth-state.ts, purpose 'quickbooks'). Nothing is stored as a connection here.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const state = p.get('state')
  const code = p.get('code')
  const realmId = p.get('realmId')
  const sameOrigin = request.nextUrl.origin
  const refuse = (outcome: 'invalid_state' | 'failed' | 'use_company_address') => NextResponse.redirect(new URL(qbReturn(outcome), request.url))

  if (!state || !isSignedOAuthState(state)) return refuse('invalid_state')
  try {
    const denied = p.get('error') || !code || !realmId
    const check = await acceptOAuthCallback(createServiceClient(), state, denied ? null : packCallback(code!, realmId!), Date.now(), { purpose: 'quickbooks', sameOrigin })
    if (!check.ok) {
      console.error('QuickBooks callback refused:', check.reason)
      return refuse(check.reason === 'unavailable' ? 'failed' : check.reason === 'wrong_host' ? 'use_company_address' : 'invalid_state')
    }
    if (denied) return NextResponse.redirect(new URL(qbReturn('denied'), check.returnOrigin))
    const finish = new URL('/api/integrations/quickbooks/finish', check.returnOrigin)
    finish.searchParams.set('nonce', check.nonce)
    return NextResponse.redirect(finish)
  } catch (e) {
    console.error('QuickBooks callback error:', e instanceof Error ? e.message : e)
    return refuse('failed')
  }
}
