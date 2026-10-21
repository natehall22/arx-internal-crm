/** @jest-environment node */
/**
 * /api/ops/jobs/[id]/notes — Phase 0 security (2026-10-21):
 *  - only users who can open the job page (job-board access) may read or post notes
 *  - @mentions are exact (no "@Ste" fan-out)
 *  - mentioned users' email addresses are never written to server logs
 */

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))

let canJobBoard = true
jest.mock('@/lib/ops-access', () => {
  const actual = jest.requireActual('@/lib/ops-access')
  return {
    ...actual,
    // The caller ('u-ops') follows the test's switch; mentioned recipients follow their role.
    resolveOpsAccess: jest.fn(async (_admin: unknown, userId: string, profile: { role: string }) => ({
      canJobBoard: userId === 'u-ops' ? canJobBoard : ['admin', 'operations'].includes(profile.role),
    })),
  }
})

const sendMail = jest.fn(async (_mail: Record<string, unknown>) => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))

const ORG_USERS = [
  { id: 'u-steve', full_name: 'Steve Potts', email: 'steve@example.test', active: true, role: 'operations', custom_role_id: null },
  { id: 'u-stephanie', full_name: 'Stephanie Reyes', email: 'steph@example.test', active: true, role: 'setter', custom_role_id: null },
  { id: 'u-sten', full_name: 'Sten Olsen', email: 'sten@example.test', active: true, role: 'setter', custom_role_id: null },
  { id: 'u-gone', full_name: 'Gone User', email: 'gone@example.test', active: false, role: 'admin', custom_role_id: null },
  { id: 'u-noemail', full_name: 'No Email', email: null, active: true, role: 'admin', custom_role_id: null },
]
const tablesRead: string[] = []

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      tablesRead.push(table)
      const q: Record<string, any> = {}
      const chain = () => q
      Object.assign(q, { select: chain, eq: chain, not: chain, order: chain, insert: chain })
      q.single = async () => {
        if (table === 'production_jobs')
          return { data: { id: 'job-1', org_id: 'org-1', job_number: '26-0042', address_text: '12 Elm St', customer_id: 'cust-1' }, error: null }
        if (table === 'production_job_notes') return { data: { id: 'n1', note: 'x', created_at: 'now' }, error: null }
        return { data: null, error: null }
      }
      q.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'users') return resolve({ data: ORG_USERS, error: null })
        if (table === 'production_job_notes') return resolve({ data: [{ id: 'n1', note: 'secret' }], error: null })
        return resolve({ data: [], error: null })
      }
      return q
    },
  }),
}))

import { GET, POST } from '@/app/api/ops/jobs/[id]/notes/route'

const ctx = { params: { id: 'job-1' } }
const opsUser = {
  authUser: { id: 'u-ops', email: null },
  profile: { id: 'u-ops', org_id: 'org-1', role: 'operations', full_name: 'Ops <b>Person</b>' },
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://crm.example/api/ops/jobs/job-1/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
const mailTo = (addr: string) => sendMail.mock.calls.map((c) => c[0]).find((m) => m.to === addr) as Record<string, string>

let logSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
beforeEach(() => {
  authResult = opsUser
  canJobBoard = true
  sendMail.mockClear()
  tablesRead.length = 0
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  logSpy.mockRestore()
  errSpy.mockRestore()
})

describe('job notes are readable only by people who can open the job page', () => {
  it('GET 403s for a user without job-board access and never reads notes', async () => {
    canJobBoard = false
    const res = await GET(new Request('https://crm.example/x'), ctx)
    expect(res.status).toBe(403)
    expect(tablesRead).not.toContain('production_job_notes')
  })

  it('POST 403s for a user without job-board access and writes nothing', async () => {
    canJobBoard = false
    const res = await POST(post({ note: '@Steve Potts hi' }), ctx)
    expect(res.status).toBe(403)
    expect(tablesRead).not.toContain('production_job_notes')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('GET works for job-board users', async () => {
    const res = await GET(new Request('https://crm.example/x'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).notes).toHaveLength(1)
  })

  it('401 when signed out', async () => {
    authResult = null
    expect((await GET(new Request('https://crm.example/x'), ctx)).status).toBe(401)
  })
})

describe('@mention emails', () => {
  it('"@Ste" emails nobody', async () => {
    const res = await POST(post({ note: '@Ste can you look?' }), ctx)
    expect(res.status).toBe(200)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('an exact full name emails exactly that person', async () => {
    await POST(post({ note: '@Steve Potts can you look?' }), ctx)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'steve@example.test' })
  })

  it('a client-sent id alone does not email someone not named in the note', async () => {
    await POST(post({ note: 'no mentions', mentioned_user_ids: ['u-stephanie'] }), ctx)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('never logs the mentioned users’ email addresses', async () => {
    await POST(post({ note: '@Steve Potts and @Sten Olsen' }), ctx)
    expect(sendMail).toHaveBeenCalledTimes(2)
    const logged = JSON.stringify([...logSpy.mock.calls, ...errSpy.mock.calls])
    for (const u of ORG_USERS) if (u.email) expect(logged).not.toContain(u.email)
  })

  it('inactive users and users without an email are never mention targets', async () => {
    await POST(post({ note: '@Gone User and @No Email' }), ctx)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('mention email content follows the RECIPIENT’s access', () => {
  const NOTE = 'Pricing is $14,200 — @Steve Potts @Stephanie Reyes please check'

  it('a recipient who can read job notes (operations) gets the note text', async () => {
    await POST(post({ note: NOTE, customer_name: 'Pat Doe' }), ctx)
    const m = mailTo('steve@example.test')
    expect(m.html).toContain('$14,200')
    expect(m.text).toContain('$14,200')
    expect(m.subject).toBe('Pat Doe • 26-0042 • New tagged note')
  })

  it('a setter recipient gets "{Sender} mentioned you on Job {#} – {address}" and the link, no note text', async () => {
    await POST(post({ note: NOTE, customer_name: 'Pat Doe' }), ctx)
    const m = mailTo('steph@example.test')
    expect(m.subject).toBe('Ops <b>Person</b> mentioned you on Job 26-0042 – 12 Elm St')
    for (const part of [m.html, m.text, m.subject]) {
      expect(part).not.toContain('14,200')
      expect(part).not.toContain('please check')
      expect(part).not.toContain('/customers/')
    }
    expect(m.text).toContain('/ops/jobs/job-1')
  })
})

describe('mention email links and escaping', () => {
  const OLD_ENV = process.env.NEXT_PUBLIC_APP_URL
  beforeAll(() => { process.env.NEXT_PUBLIC_APP_URL = 'https://crm.arx.test/' })
  afterAll(() => { process.env.NEXT_PUBLIC_APP_URL = OLD_ENV })

  it('links use the configured app URL, never the Origin header or a client page_url', async () => {
    await POST(
      post({ note: '@Steve Potts look', page_url: 'https://evil.test/x' }, { origin: 'https://evil.test' }),
      ctx
    )
    const m = mailTo('steve@example.test')
    expect(m.html).not.toContain('evil.test')
    expect(m.text).not.toContain('evil.test')
    expect(m.html).toContain('href="https://crm.arx.test/ops/jobs/job-1"')
    expect(m.html).toContain('href="https://crm.arx.test/customers/cust-1"')
  })

  it('sender and recipient names are HTML-escaped', async () => {
    await POST(post({ note: '@Steve Potts look' }), ctx)
    const m = mailTo('steve@example.test')
    expect(m.html).toContain('Ops &lt;b&gt;Person&lt;/b&gt;')
    expect(m.html).not.toContain('<b>Person</b>')
  })
})
