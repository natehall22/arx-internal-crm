/** @jest-environment node */
/**
 * Company web address at the edges: middleware 404s unknown company names (never another company's login),
 * the login route refuses an account from another company with the SAME error as a wrong password and sets
 * no cookie, and every session cookie is host-only (no Domain attribute) so a session can't cross companies.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

const signOut = jest.fn(async () => ({ error: null }))
let profileOrg: string | null = 'org-acme'
let signInOk = true

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () =>
        signInOk
          ? {
              data: {
                session: {
                  access_token: 'at',
                  refresh_token: 'rt',
                  expires_at: Math.floor(Date.now() / 1000) + 3600,
                  expires_in: 3600,
                  token_type: 'bearer',
                  user: { id: 'u-1' },
                },
              },
              error: null,
            }
          : { data: { session: null }, error: { message: 'Invalid login credentials' } },
      signOut,
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: cols.includes('org_id') ? { org_id: profileOrg } : { active: true },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

import { POST as loginPost } from '@/app/api/auth/login/route'
import { middleware } from '@/middleware'
import { __resetCompanyHostCacheForTests } from '@/lib/company-host'
import { writeSessionCookies } from '@/lib/supabase/session-refresh'

const ORGS: Record<string, string> = { acme: 'org-acme', roofco: 'org-roofco' }
const ENV_KEYS = ['APP_BASE_DOMAIN', 'DEPLOYMENT_ORG_ID'] as const
const saved: Record<string, string | undefined> = {}
let fetchMock: jest.Mock

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
})
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.APP_BASE_DOMAIN = 'crm-product.test'
  delete process.env.DEPLOYMENT_ORG_ID
  __resetCompanyHostCacheForTests()
  profileOrg = 'org-acme'
  signInOk = true
  signOut.mockClear()
  fetchMock = jest.fn(async (_u: string, init: { body: string }) => ({
    ok: true,
    status: 200,
    json: async () => ORGS[JSON.parse(init.body).p_subdomain] ?? null,
  }))
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

function pageReq(host: string, p: string, cookie?: string) {
  return new NextRequest(`https://${host}${p}`, { headers: { host, ...(cookie ? { cookie } : {}) } })
}

function loginReq(host: string) {
  const form = new FormData()
  form.set('email', 'u1@example.test')
  form.set('password', 'pw')
  form.set('next', '/today')
  return new NextRequest(`https://${host}/api/auth/login`, { method: 'POST', body: form, headers: { host } })
}

describe('middleware company gate', () => {
  test('unknown company → 404 on login AND public pages; nothing else runs', async () => {
    for (const p of ['/login', '/r/some-token', '/crew/t', '/today']) {
      const res = await middleware(pageReq('nobody.crm-product.test', p))
      expect(res.status).toBe(404)
      expect(await res.text()).not.toMatch(/sign in|password/i)
    }
    expect((await middleware(pageReq('a.b.crm-product.test', '/login'))).status).toBe(404)
  })

  test('known company → login served; root goes to the CRM, not the marketing page', async () => {
    const res = await middleware(pageReq('acme.crm-product.test', '/login'))
    expect(res.status).toBe(200)
    const root = await middleware(pageReq('acme.crm-product.test', '/'))
    expect(root.status).toBe(307)
    expect(root.headers.get('location')).toBe('https://acme.crm-product.test/today')
  })

  test('lookup failure → 503, not a login page', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    expect((await middleware(pageReq('acme.crm-product.test', '/login'))).status).toBe(503)
  })

  test('legacy address and routing-off make no lookup and behave as before', async () => {
    expect((await middleware(pageReq('old-app.vercel.app', '/login'))).status).toBe(200)
    delete process.env.APP_BASE_DOMAIN
    expect((await middleware(pageReq('acme.crm-product.test', '/'))).status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('login route', () => {
  function errorOf(res: Response) {
    return new URL(res.headers.get('location') ?? 'http://x').searchParams.get('error')
  }

  test('own company → session cookie, host-only (no Domain)', async () => {
    const res = await loginPost(loginReq('acme.crm-product.test'))
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/today')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('sb-proj-auth-token')
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).not.toMatch(/domain=/i)
  })

  test('account from another company → same error as a wrong password, no cookie, session revoked locally', async () => {
    profileOrg = 'org-roofco'
    const res = await loginPost(loginReq('acme.crm-product.test'))
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(errorOf(res)).toBe('Invalid login credentials')
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })

    signInOk = false
    const wrongPw = await loginPost(loginReq('acme.crm-product.test'))
    expect(errorOf(wrongPw)).toBe(errorOf(res))
  })

  test('profile unreadable on a company address → refused (fail closed)', async () => {
    profileOrg = null
    const res = await loginPost(loginReq('acme.crm-product.test'))
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(errorOf(res)).toBe('Invalid login credentials')
  })

  test('unknown company / bare domain → refused before any password check', async () => {
    const unknown = await loginPost(loginReq('nobody.crm-product.test'))
    expect(errorOf(unknown)).toBe('Invalid login credentials')
    const apex = await loginPost(loginReq('crm-product.test'))
    expect(errorOf(apex)).toMatch(/company's web address/)
    expect(apex.headers.get('set-cookie')).toBeNull()
  })

  test('legacy address unchanged: any company signs in', async () => {
    profileOrg = 'org-roofco'
    const res = await loginPost(loginReq('old-app.vercel.app'))
    expect(res.headers.get('set-cookie')).toContain('sb-proj-auth-token')
  })
})

describe('cookie scope', () => {
  test('session refresh cookies are host-only too', () => {
    const res = NextResponse.next()
    writeSessionCookies(res, ['sb-proj-auth-token.0'], { access_token: 'a', refresh_token: 'r', expires_at: 1 }, true)
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain('sb-proj-auth-token')
    expect(sc).not.toMatch(/domain=/i)
  })

  test('no code sets a cookie Domain (a shared-parent cookie would carry one company’s session to another)', () => {
    const roots = ['app', 'lib', 'components', 'hooks', 'middleware.ts']
    const offenders: string[] = []
    const walk = (p: string) => {
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        if (p.includes('__tests__') || p.endsWith('node_modules')) return
        for (const f of fs.readdirSync(p)) walk(path.join(p, f))
        return
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(p)) return
      const src = fs.readFileSync(p, 'utf8')
      if (!/cookies\.set\(|cookieStore\.set\(|createBrowserClient\(|createServerClient\(|document\.cookie/.test(src)) return
      if (/\bdomain\s*[:=]|Domain=/.test(src)) offenders.push(p)
    }
    for (const r of roots) walk(path.join(process.cwd(), r))
    expect(offenders).toEqual([])
  })
})
