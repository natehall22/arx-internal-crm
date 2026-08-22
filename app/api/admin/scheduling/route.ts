import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

function getAuthClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  
  const authHeader = request.headers.get('authorization')
  const cookieHeader = request.headers.get('cookie')
  
  let accessToken: string | null = null
  
  if (authHeader?.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7)
  } else if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = value
      return acc
    }, {} as Record<string, string>)
    
    const tokenCookie = Object.keys(cookies).find(key => 
      key.includes('auth-token') || key.includes('sb-') && key.includes('-auth-token')
    )
    if (tokenCookie) {
      try {
        const tokenData = JSON.parse(decodeURIComponent(cookies[tokenCookie]))
        accessToken = tokenData.access_token || tokenData
      } catch {
        accessToken = cookies[tokenCookie]
      }
    }
  }
  
  const client = createAnonClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })
  
  return { client, accessToken }
}

export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Get user profile with team
    const { data: profile } = await adminClient
      .from('users')
      .select('*, teams(*)')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    // Get Google token for current user
    const { data: googleToken } = await adminClient
      .from('user_google_tokens')
      .select('*')
      .eq('user_id', user.id)
      .single()

    // Get all teams for the org
    const { data: teams } = await adminClient
      .from('teams')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('name')

    return NextResponse.json({
      profile: {
        ...profile,
        google_token: googleToken,
        team: profile.teams,
      },
      teams: teams || [],
    })

  } catch (error) {
    console.error('Scheduling API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Disconnect Google Calendar
export async function DELETE(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Delete Google token for current user
    const { error: deleteError } = await adminClient
      .from('user_google_tokens')
      .delete()
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('Failed to disconnect calendar:', deleteError)
      return NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Scheduling DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
