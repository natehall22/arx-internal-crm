import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import {
  COMPANY_CODE_HEADER,
  RESOLVED_LOOKUPS_HEADER,
  fenceAllowsOrg,
  resolveCompanyFence,
  verifyResolvedLookups,
} from '@/lib/company-host'

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
/** The only other answers: an outage and a rate limit. Neither says anything about the account. */
const UNAVAILABLE_LOGIN_ERROR = 'Sign-in is unavailable right now. Please try again.'
const RATE_LIMITED_LOGIN_ERROR = 'Too many attempts. Please wait a minute and try again.'

/**
 * Every refused sign-in (wrong password, unknown company address, account in another company) answers no sooner than
 * this after the request started, plus jitter, so the wrong-company path (extra profile read + session revoke) can't
 * be told from a wrong password by timing. Successful sign-ins are not delayed.
 */
const LOGIN_FAILURE_FLOOR_MS = 1200
const LOGIN_FAILURE_JITTER_MS = 250

async function waitForFailureFloor(startedAt: number): Promise<void> {
  const target = startedAt + LOGIN_FAILURE_FLOOR_MS + Math.floor(Math.random() * LOGIN_FAILURE_JITTER_MS)
  const wait = target - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
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

  const loginError = async (message: string) => {
    await waitForFailureFloor(startedAt)
    const errorUrl = new URL(req.url)
    errorUrl.pathname = '/login'
    errorUrl.searchParams.set('error', message)
    errorUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  // Which company this address belongs to (lib/company-host.ts; middleware's signed lookup when present). Web sign-in
  // reads the host only — no company-code header. Every refusal below waits out the same floor and says the same thing.
  const host = req.headers.get('host') ?? req.nextUrl.host
  const resolved = await verifyResolvedLookups(req.headers.get(RESOLVED_LOOKUPS_HEADER), host, req.headers.get(COMPANY_CODE_HEADER))
  const fence = await resolveCompanyFence({ host, resolved: resolved ? { host: resolved.host } : null })
  if (fence.kind === 'closed') {
    return await loginError(fence.reason === 'lookup_error' ? UNAVAILABLE_LOGIN_ERROR : GENERIC_LOGIN_ERROR)
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
    return await loginError(error?.status === 429 ? RATE_LIMITED_LOGIN_ERROR : GENERIC_LOGIN_ERROR)
  }

  // One profile read for both checks. On a fenced address it must succeed (fail closed); on the legacy address a
  // failed read lets the sign-in through, as before.
  let profile: { org_id: string | null; active: boolean | null } | null = null
  let profileReadFailed = false
  try {
    const { data: row, error: rowError } = await createServiceClient()
      .from('users')
      .select('org_id, active')
      .eq('id', data.session.user.id)
      .maybeSingle()
    if (rowError) throw rowError
    profile = (row as typeof profile) ?? null
  } catch (e) {
    console.error('LOGIN profile check:', e)
    profileReadFailed = true
  }

  const refuse = async (why: string) => {
    console.log('LOGIN refused:', why, data.session!.user.id)
    // Revoke only the session just created (scope 'local'), never the user's other devices.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    return await loginError(GENERIC_LOGIN_ERROR)
  }
  if (fence.kind === 'org' && (profileReadFailed || !fenceAllowsOrg(fence, profile?.org_id))) {
    return await refuse('account is not in this company')
  }
  if (profile?.active === false) return await refuse('account disabled')

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
