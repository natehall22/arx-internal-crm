import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getGoogleAuthUrl } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Generate OAuth URL with user ID as state
    const authUrl = getGoogleAuthUrl(user.id)
    
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Google auth error:', error)
    return NextResponse.json(
      { error: 'Failed to initiate Google authentication' },
      { status: 500 }
    )
  }
}
