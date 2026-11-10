import { type NextRequest, NextResponse } from 'next/server'
import { isPublicPath } from '@/lib/public-paths'
import {
  COMPANY_CODE_HEADER,
  COMPANY_LOOKUP_UNAVAILABLE,
  RESOLVED_LOOKUPS_HEADER,
  appBaseDomain,
  classifyHost,
  deploymentOrgId,
  lookupCompanyBySubdomain,
  normalizeSubdomain,
  signResolvedLookups,
  type ResolvedLookups,
} from '@/lib/company-host'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import {
  isExpired,
  isExpiringSoon,
  refreshSupabaseSession,
  writeSessionCookies,
} from '@/lib/supabase/session-refresh'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Company web address (<company>.<APP_BASE_DOMAIN>): a name that is no company gets a 404 on EVERY page and
  // API — public or not — so it can never show another company's login; a failed lookup is 503 with
  // code company_lookup_unavailable (never 401, so clients keep their session). Off while APP_BASE_DOMAIN is unset.
  const gate = await companyHostGate(request)
  if (gate.response) return gate.response
  // Every pass-through carries the gate's lookups (signed) and never a client-sent copy of that header.
  const pass = () => NextResponse.next({ request: { headers: gate.requestHeaders } })

  // API routes handle their own auth (no HTML redirects to API calls).
  if (pathname.startsWith('/api/')) {
    return pass()
  }

  // Dev-only test harness for the mobile checks (e2e/mobile.spec.ts). Never reachable in a production build.
  if (process.env.NODE_ENV !== 'production' && pathname.startsWith('/dev-harness')) {
    return pass()
  }

  // Public paths - no auth required
  if (isPublicPath(pathname)) {
    return pass()
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return pass()
  }

  const sessionData = getSupabaseSessionFromCookieStore(request.cookies)

  // If no session cookie found, redirect to login
  if (!sessionData?.access_token) {
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // If the access token is expired or about to expire, silently refresh it
  // using the stored refresh token instead of kicking the user to /login.
  if (isExpiringSoon(sessionData.expires_at) && sessionData.refresh_token) {
    const refreshed = await refreshSupabaseSession(sessionData.refresh_token)
    if (refreshed) {
      const res = pass()
      writeSessionCookies(
        res,
        request.cookies.getAll().map((c) => c.name),
        refreshed,
        request.url.startsWith('https')
      )
      return res
    }
    // Refresh failed. If the token still has time left (e.g. transient
    // network error during the pre-expiry buffer), let the request through
    // and retry on the next one. Only redirect once it's truly dead.
  }

  if (isExpired(sessionData.expires_at)) {
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // User has a valid session cookie - let them through
  return pass()
}

const NOT_FOUND_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Not found</title></head><body style="font-family:system-ui,sans-serif;color:#1a1917;padding:48px 20px;text-align:center">' +
  '<h1 style="font-size:22px">This address is not in use</h1>' +
  '<p style="font-size:16px">Check the web address your company gave you.</p></body></html>'

/** null = carry on; otherwise the response to send (404 unknown company, 503 lookup failure). */
function notFound(isApi: boolean): NextResponse {
  return isApi
    ? NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'cache-control': 'no-store' } })
    : new NextResponse(NOT_FOUND_HTML, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

/**
 * A company's own copy (company address, or DEPLOYMENT_ORG_ID): the product home page and the product trial sign-up
 * are not that company's pages — `/` goes to the CRM, `/trial` to sign-in. Everywhere else (legacy unfenced, bare
 * product domain) they stay as they are.
 */
function companyOnlyPages(request: NextRequest): NextResponse | null {
  const p = request.nextUrl.pathname
  if (p !== '/' && p !== '/trial') return null
  const to = request.nextUrl.clone()
  to.pathname = p === '/' ? '/today' : '/login'
  to.search = ''
  return NextResponse.redirect(to)
}

type GateResult = { response: NextResponse | null; requestHeaders: Headers }

async function companyHostGate(request: NextRequest): Promise<GateResult> {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(RESOLVED_LOOKUPS_HEADER)
  const done = (response: NextResponse | null): GateResult => ({ response, requestHeaders })

  const isApi = request.nextUrl.pathname.startsWith('/api/')
  const rawHost = request.headers.get('host') ?? request.nextUrl.host
  const host = classifyHost(rawHost)
  if (host.kind === 'invalid') return done(notFound(isApi))

  const resolved: ResolvedLookups = {}
  if (host.kind === 'company') {
    resolved.host = await lookupCompanyBySubdomain(host.subdomain)
    if (resolved.host.status === 'not_found') return done(notFound(isApi))
    if (resolved.host.status === 'error') return done(unavailable(isApi))
  }
  // iPhone company code (any host, routing on): a failed lookup is 503 here too; an unknown code is left to
  // resolveAuth (401 — a wrong code is an auth answer, not an outage).
  const code = request.headers.get(COMPANY_CODE_HEADER)
  const codeSub = code && appBaseDomain() ? normalizeSubdomain(code) : null
  if (codeSub) {
    resolved.code = await lookupCompanyBySubdomain(codeSub)
    if (resolved.code.status === 'error') return done(unavailable(isApi))
  }
  if (resolved.host || resolved.code) {
    const signed = await signResolvedLookups(rawHost, code, resolved)
    if (signed) requestHeaders.set(RESOLVED_LOOKUPS_HEADER, signed)
  }

  if (host.kind === 'company' || (host.kind !== 'apex' && deploymentOrgId())) return done(companyOnlyPages(request))
  return done(null)
}

function unavailable(isApi: boolean): NextResponse {
  const headers = { 'cache-control': 'no-store', 'retry-after': '30' }
  return isApi
    ? NextResponse.json({ error: 'Temporarily unavailable', code: COMPANY_LOOKUP_UNAVAILABLE }, { status: 503, headers })
    : new NextResponse('Temporarily unavailable. Please try again in a minute.', {
        status: 503,
        headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
      })
}

export const config = {
  // API routes run through the company gate only (see the /api/ early return); static files are excluded.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
