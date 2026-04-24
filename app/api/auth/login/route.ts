import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  url.pathname = '/login'
  return NextResponse.redirect(url, { status: 302 })
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  if (!supabaseUrl || !supabaseKey) {
    const errorUrl = new URL(req.url)
    errorUrl.pathname = '/login'
    errorUrl.searchParams.set('error', 'Server configuration error')
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  const formData = await req.formData()
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const nextPath =
    String(formData.get('next') ?? '/dashboard').startsWith('/')
      ? String(formData.get('next'))
      : '/dashboard'

  // Use regular supabase-js client for auth (not SSR)
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.session) {
    console.log('LOGIN error:', error?.message || 'No session')
    const errorUrl = new URL(req.url)
    errorUrl.pathname = '/login'
    errorUrl.searchParams.set('error', error?.message || 'Authentication failed')
    errorUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  try {
    const admin = createServiceClient()
    const { data: profileRow } = await admin
      .from('users')
      .select('active')
      .eq('id', data.session.user.id)
      .maybeSingle()
    if (profileRow && profileRow.active === false) {
      const errorUrl = new URL(req.url)
      errorUrl.pathname = '/login'
      errorUrl.searchParams.set(
        'error',
        'This account has been disabled. Contact your administrator.'
      )
      errorUrl.searchParams.set('next', nextPath)
      return NextResponse.redirect(errorUrl, { status: 303 })
    }
  } catch (e) {
    console.error('LOGIN active check:', e)
  }

  // Build redirect URL
  const redirectUrl = new URL(req.url)
  redirectUrl.pathname = nextPath
  redirectUrl.search = ''

  // CREATE RESPONSE
  const res = NextResponse.redirect(redirectUrl, { status: 303 })

  // Get project ref from URL for cookie name
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  // Determine if we're on HTTPS
  const isSecure = req.url.startsWith('https')

  // Create the session cookie value
  const cookieValue = JSON.stringify({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.session.user,
  })

  // Check if we need to chunk (cookies have ~4KB limit)
  const maxChunkSize = 3500

  if (cookieValue.length <= maxChunkSize) {
    // Single cookie
    res.cookies.set(cookieName, cookieValue, {
      path: '/',
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    console.log('LOGIN: Set single cookie', cookieName, 'length:', cookieValue.length)
  } else {
    // Chunk the cookie
    const chunks: string[] = []
    for (let i = 0; i < cookieValue.length; i += maxChunkSize) {
      chunks.push(cookieValue.slice(i, i + maxChunkSize))
    }
    
    chunks.forEach((chunk, index) => {
      const chunkName = `${cookieName}.${index}`
      res.cookies.set(chunkName, chunk, {
        path: '/',
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
      })
      console.log('LOGIN: Set chunk cookie', chunkName, 'length:', chunk.length)
    })
  }

  console.log('LOGIN success for', email, '- redirecting to', nextPath)
  return res
}
