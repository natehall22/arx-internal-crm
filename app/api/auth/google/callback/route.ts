export const dynamic = "force-dynamic"
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state') // User ID
    const error = searchParams.get('error')

    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(new URL('/admin/scheduling?error=oauth_denied', request.url))
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/admin/scheduling?error=missing_params', request.url))
    }

    const supabase = createServerClient()
    
    // Verify the user is authenticated and matches the state
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.id !== state) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Get user's org_id
    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.redirect(new URL('/admin/scheduling?error=no_profile', request.url))
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)

    // Store tokens in database
    const { error: upsertError } = await supabase
      .from('user_google_tokens')
      .upsert({
        user_id: user.id,
        org_id: profile.org_id,
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
      return NextResponse.redirect(new URL('/admin/scheduling?error=token_storage', request.url))
    }

    // Success - redirect back to scheduling page
    return NextResponse.redirect(new URL('/admin/scheduling?success=calendar_connected', request.url))
  } catch (error) {
    console.error('Google callback error:', error)
    return NextResponse.redirect(new URL('/admin/scheduling?error=callback_failed', request.url))
  }
}
