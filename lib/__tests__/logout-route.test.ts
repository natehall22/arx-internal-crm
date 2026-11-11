/** @jest-environment node */
import { NextRequest } from 'next/server'

import { GET, POST } from '@/app/api/auth/logout/route'
import { sessionCookieNamesToClear } from '@/lib/supabase/session-refresh'

const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://projref.supabase.co'
})
afterAll(() => {
  if (OLD === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = OLD
})

const NAME = 'sb-projref-auth-token'

function req(method: string, cookies: string[]) {
  return new NextRequest('https://old.example.test/api/auth/logout', {
    method,
    headers: { cookie: cookies.map((c) => `${c}=v`).join('; ') },
  })
}

function expired(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0/i.test(c))
    .map((c) => c.split('=')[0])
    .sort()
}

describe('sessionCookieNamesToClear', () => {
  it('takes the single cookie and every chunk, nothing else', () => {
    expect(sessionCookieNamesToClear(['other', `${NAME}.0`, `${NAME}.1`, `${NAME}x`, 'sb-otherref-auth-token'], NAME).sort()).toEqual([NAME, `${NAME}.0`, `${NAME}.1`])
  })
})

describe('/api/auth/logout', () => {
  it('POST expires the real (project-derived) cookie and all its chunks', async () => {
    const res = await POST(req('POST', [`${NAME}.0`, `${NAME}.1`, `${NAME}.2`, 'unrelated']))
    expect(res.status).toBe(200)
    expect(expired(res)).toEqual([NAME, `${NAME}.0`, `${NAME}.1`, `${NAME}.2`])
    const header = res.headers.getSetCookie().join('\n')
    expect(header).toMatch(/Path=\//)
    expect(header).toMatch(/HttpOnly/i)
    expect(header).not.toMatch(/unrelated/)
  })
  it('GET redirects RELATIVELY to /login, so it never leaves the host it was opened on', async () => {
    const res = await GET(req('GET', [NAME]))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login')
    expect(expired(res)).toEqual([NAME])
  })
})

describe('/api/auth/logout ends the Supabase session', () => {
  const realFetch = global.fetch
  const OLDKEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  })
  afterEach(() => {
    global.fetch = realFetch
    if (OLDKEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = OLDKEY
  })
  function withSession(method: string, session: object, chunked = false) {
    const json = encodeURIComponent(JSON.stringify(session))
    const cookie = chunked ? `${NAME}.0=${json}` : `${NAME}=${json}`
    return new NextRequest('https://x.example.test/api/auth/logout', { method, headers: { cookie } })
  }
  it('calls GoTrue logout (local scope) with the access token, then clears every cookie', async () => {
    const calls: { url: string; auth: string }[] = []
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), auth: init.headers.Authorization })
      return new Response(null, { status: 204 })
    }) as any
    const res = await POST(withSession('POST', { access_token: 'AT', refresh_token: 'RT', expires_at: Math.floor(Date.now() / 1000) + 3600 }, true))
    expect(calls).toEqual([{ url: 'https://projref.supabase.co/auth/v1/logout?scope=local', auth: 'Bearer AT' }])
    expect(expired(res)).toContain(`${NAME}.0`)
    expect(res.status).toBe(200)
  })
  it('refreshes an expired access token first, then revokes with the fresh one', async () => {
    const urls: string[] = []
    global.fetch = jest.fn(async (url: any, init: any) => {
      urls.push(String(url))
      if (String(url).includes('grant_type=refresh_token')) {
        return new Response(JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }), { status: 200 })
      }
      expect(init.headers.Authorization).toBe('Bearer AT2')
      return new Response(null, { status: 204 })
    }) as any
    await GET(withSession('GET', { access_token: 'AT', refresh_token: 'RT', expires_at: 1 }))
    expect(urls[0]).toContain('grant_type=refresh_token')
    expect(urls[1]).toContain('/auth/v1/logout?scope=local')
  })
  it('still clears cookies when Supabase is down or there is no session', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('down')
    }) as any
    const res = await POST(withSession('POST', { access_token: 'AT', refresh_token: 'RT', expires_at: Math.floor(Date.now() / 1000) + 3600 }))
    expect(res.status).toBe(200)
    expect(expired(res)).toEqual([NAME])
    const none = await POST(req('POST', []))
    expect(none.status).toBe(200)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1)
  })
})
