/** @jest-environment node */
import { NextRequest } from 'next/server'

const send = jest.fn(async (..._a: unknown[]) => ({ ok: true }))
let fence: unknown = { kind: 'org', orgId: 'A', source: 'host' }
let users: Array<Record<string, unknown>> = []
jest.mock('@/lib/password-reset-email', () => ({ sendPasswordResetEmail: (...a: unknown[]) => send(...a) }))
const background: Array<Promise<unknown>> = []
jest.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { background.push(p) } }))
jest.mock('@/lib/password-reset-timing', () => ({ padPasswordResetAnswer: async () => undefined }))
jest.mock('@/lib/company-host', () => ({
  COMPANY_CODE_HEADER: 'x-c', RESOLVED_LOOKUPS_HEADER: 'x-r',
  verifyResolvedLookups: async () => null,
  resolveCompanyFence: async () => fence,
  fenceAllowsOrg: (f: { kind: string; orgId?: string }, o: string) => f.kind === 'open' || (f.kind === 'org' && f.orgId === o),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => { let org: unknown = null; const q: any = { select: () => q, ilike: () => q, eq: (_c: string, v: unknown) => { org = v; return q }, limit: async () => ({ data: org == null ? users : users.filter((u) => u.org_id === org) }) }; return q } }), // eslint-disable-line @typescript-eslint/no-explicit-any
}))
import { POST } from '@/app/api/auth/forgot-password/route'
import { resetPublicEstimateRateLimitForTests } from '@/lib/public-estimate-rate-limit'

const call = async (email: unknown, ip = '1.1.1.1') => {
  const res = await POST(new NextRequest('https://a.example.com/api/auth/forgot-password', { method: 'POST', headers: { 'x-forwarded-for': ip, host: 'a.example.com' }, body: JSON.stringify({ email }) }))
  await Promise.all(background.splice(0))
  return res
}

beforeEach(() => { send.mockClear(); resetPublicEstimateRateLimitForTests(); fence = { kind: 'org', orgId: 'A', source: 'host' }; users = [{ org_id: 'A', email: 'u@a.com', active: true }] })

test('known user of this company: mailed; answer identical to an unknown email', async () => {
  const known = await call('U@a.com')
  const unknown = await call('nobody@a.com', '2.2.2.2')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][1]).toMatchObject({ orgId: 'A', email: 'u@a.com' })
  expect(await known.json()).toEqual(await unknown.json())
  expect(known.status).toBe(200)
})

test('a user of company B on company A address gets nothing but the same answer', async () => {
  users = [{ org_id: 'B', email: 'u@a.com', active: true }]
  const res = await call('u@a.com')
  expect(send).not.toHaveBeenCalled()
  expect(res.status).toBe(200)
})

test('disabled user and closed fence: nothing sent', async () => {
  users = [{ org_id: 'A', email: 'u@a.com', active: false }]
  await call('u@a.com')
  users = [{ org_id: 'A', email: 'u@a.com', active: true }]
  fence = { kind: 'closed', reason: 'apex' }
  await call('u@a.com', '3.3.3.3')
  expect(send).not.toHaveBeenCalled()
})

test('rate limit per email: 4th request in the hour sends nothing, still the same answer', async () => {
  for (let i = 0; i < 4; i++) { const r = await call('u@a.com', `9.9.9.${i}`); expect(r.status).toBe(200) }
  expect(send).toHaveBeenCalledTimes(3)
})

test('rate limit per IP', async () => {
  for (let i = 0; i < 7; i++) await call(`u${i}@a.com`, '5.5.5.5')
  expect(send.mock.calls.length).toBeLessThanOrEqual(5)
})

test('malformed email is a 400, nothing sent', async () => {
  expect((await call('nope')).status).toBe(400)
  expect(send).not.toHaveBeenCalled()
})

test('the answer does not wait for the lookup or the mail (it is sent before the background step settles)', async () => {
  let release: () => void = () => undefined
  send.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: true }) }))
  const res = await POST(new NextRequest('https://a.example.com/api/auth/forgot-password', { method: 'POST', headers: { 'x-forwarded-for': '7.7.7.7', host: 'a.example.com' }, body: JSON.stringify({ email: 'u@a.com' }) }))
  expect(res.status).toBe(200)
  release()
  await Promise.all(background.splice(0))
  expect(send).toHaveBeenCalledTimes(1)
})
