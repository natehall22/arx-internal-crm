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
