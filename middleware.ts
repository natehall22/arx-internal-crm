import { NextRequest, NextResponse } from 'next/server'

function getAccessTokenFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl) return null
  
  let projectRef = ''
  try {
    const host = new URL(supabaseUrl).hostname
    projectRef = host.split('.')[0] || ''
  } catch {
    projectRef = ''
  }
  if (!projectRef) return null

  const cookie = req.cookies.get(`sb-${projectRef}-auth-token`)
  if (!cookie?.value) return null

  try {
    const parsed = JSON.parse(cookie.value)
    return typeof parsed?.access_token === 'string' ? parsed.access_token : null
  } catch {
    return null
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow these paths - no auth check needed
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/contracts/') ||
    pathname.startsWith('/sub-portal/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.endsWith('.json') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next()
  }

  // Check if env vars are available
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    // If env vars missing, allow through (will fail at page level with better error)
    console.error('Middleware: Missing Supabase env vars')
    return NextResponse.next()
  }

  const accessToken = getAccessTokenFromRequest(req)
  if (!accessToken) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // Dynamically import to avoid top-level initialization issues
  const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
  
  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data?.user) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
