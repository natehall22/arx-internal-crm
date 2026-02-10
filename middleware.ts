import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

function getAccessTokenFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
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

  // always allow these
  if (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/contracts/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const accessToken = getAccessTokenFromRequest(req)
  if (!accessToken) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

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
