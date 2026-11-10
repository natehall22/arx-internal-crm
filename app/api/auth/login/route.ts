import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { fenceAllowsOrg, resolveCompanyFence } from '@/lib/company-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  url.pathname = '/login'
  return NextResponse.redirect(url, { status: 302 })
}

/**
 * Same words Supabase uses for a wrong password, so a right password for an account in ANOTHER company is
 * indistinguishable from a wrong one (no account / company enumeration).
 */
const GENERIC_LOGIN_ERROR = 'Invalid login credentials'

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

  const loginError = (message: string) => {
    const errorUrl = new URL(req.url)
    errorUrl.pathname = '/login'
    errorUrl.searchParams.set('error', message)
    errorUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  // Which company this address belongs to (lib/company-host.ts). The bare product domain has no company;
  // an unknown company address never signs anyone in. Web sign-in reads the host only — no company-code header.
  const fence = await resolveCompanyFence({ host: req.headers.get('host') ?? req.nextUrl.host })
  if (fence.kind === 'closed') {
    if (fence.reason === 'apex') return loginError("Open your company's web address to sign in.")
    if (fence.reason === 'lookup_error') return loginError('Sign-in is unavailable right now. Please try again.')
    return loginError(GENERIC_LOGIN_ERROR)
  }

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

  if (fence.kind === 'org') {
    // Fenced address: the profile must be readable AND in this company, checked before anything that would
    // tell the caller more (e.g. "disabled"). Fail closed if the profile can't be read.
    let profileOrgId: string | null = null
    try {
      const { data: row, error: rowError } = await createServiceClient()
        .from('users')
        .select('org_id')
        .eq('id', data.session.user.id)
        .maybeSingle()
      if (rowError) throw rowError
      profileOrgId = (row?.org_id as string | null | undefined) ?? null
    } catch (e) {
      console.error('LOGIN company check:', e)
      profileOrgId = null
    }
    if (!fenceAllowsOrg(fence, profileOrgId)) {
      console.log('LOGIN refused: account is not in this company', data.session.user.id)
      // Revoke only the session just created (scope 'local'), never the user's other devices.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      return loginError(GENERIC_LOGIN_ERROR)
    }
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
