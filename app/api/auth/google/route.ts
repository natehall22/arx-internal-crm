import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGoogleAuthUrl } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(singleCookie.value)
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
      return JSON.parse(chunks.join(''))
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
    // Check if Google OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error('Google Calendar integration not configured: GOOGLE_CLIENT_ID missing')
      return NextResponse.json(
        { error: 'Google Calendar integration is not configured. Please contact your administrator.' },
        { status: 503 }
      )
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
      console.error('Google Calendar integration not configured: GOOGLE_CLIENT_SECRET missing')
      return NextResponse.json(
        { error: 'Google Calendar integration is not configured. Please contact your administrator.' },
        { status: 503 }
      )
    }

    const { client: authClient, accessToken } = getAuthClient(request)
    
    // Get current user
    const { data: { user } } = await authClient.auth.getUser(accessToken || '')
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Generate OAuth URL with user ID as state
    const authUrl = getGoogleAuthUrl(user.id)
    
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Google auth error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to initiate Google authentication: ${errorMessage}` },
      { status: 500 }
    )
  }
}
