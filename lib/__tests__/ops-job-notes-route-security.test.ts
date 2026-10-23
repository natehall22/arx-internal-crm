/** @jest-environment node */
/**
 * /api/ops/jobs/[id]/notes — now an adapter over the deal thread (Production audience):
 *  - only users who can open the job page (job-board access) may read or post
 *  - @mentions are exact (no "@Ste" fan-out) and only reach active people with an email
 *  - the mention email/push carries text only if the RECIPIENT may read it (setters get a content-free ping)
 *  - links come from the configured app URL; names are HTML-escaped; recipients' emails are never logged
 *  - nothing is written to production_job_notes any more
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

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
    resolveOpsAccess: jest.fn(async (_admin: unknown, userId: string, profile: { role: string }) => {
      const board = userId === 'u-ops' ? canJobBoard : ['admin', 'operations'].includes(profile.role)
      return { canJobBoard: board, canEditJobs: board, canViewJobFinancials: false }
    }),
  }
})
jest.mock('@/lib/sales-doc-access', () => ({ resolveSalesDocAccessBarred: jest.fn(async (_a: unknown, _id: string, p: { role: string }) => ['setter', 'canvasser'].includes(p.role)) }))
jest.mock('@/lib/push-apns', () => ({ sendPushToUserBackground: jest.fn() }))

const sendMail = jest.fn(async (_mail: Record<string, unknown>) => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.test' }))

const USERS = [
  { id: 'u-ops', org_id: 'org-1', full_name: 'Ops <b>Person</b>', email: 'ops@example.test', active: true, role: 'operations', custom_role_id: null },
  { id: 'u-steve', org_id: 'org-1', full_name: 'Steve Potts', email: 'steve@example.test', active: true, role: 'operations', custom_role_id: null },
  { id: 'u-stephanie', org_id: 'org-1', full_name: 'Stephanie Reyes', email: 'steph@example.test', active: true, role: 'setter', custom_role_id: null },
  { id: 'u-sten', org_id: 'org-1', full_name: 'Sten Olsen', email: 'sten@example.test', active: true, role: 'setter', custom_role_id: null },
  { id: 'u-gone', org_id: 'org-1', full_name: 'Gone User', email: 'gone@example.test', active: false, role: 'admin', custom_role_id: null },
  { id: 'u-noemail', org_id: 'org-1', full_name: 'No Email', email: null, active: true, role: 'admin', custom_role_id: null },
]
let db: ReturnType<typeof createFakeDb>
const seed = () =>
  createFakeDb({
    users: USERS,
    production_jobs: [{ id: 'job-1', org_id: 'org-1', project_id: 'proj-1' }],
    projects: [{ id: 'proj-1', org_id: 'org-1', opportunity_id: 'opp-1' }],
    opportunities: [{ id: 'opp-1', org_id: 'org-1', owner_user_id: 'u-steve', setter_user_id: 'u-stephanie', customer_id: 'cust-1', lead_id: null, address_text: '12 Elm St', status: 'won' }],
    activities: [],
    threads: [],
    thread_members: [],
    notifications: [],
    production_job_notes: [],
  })
const tablesRead: string[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      tablesRead.push(t)
      return db.client.from(t)
    },
    rpc: (...a: unknown[]) => (db.client as never as { rpc: (...x: unknown[]) => unknown }).rpc(...a),
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
const OLD_SMTP = process.env.SMTP_HOST
beforeEach(() => {
  process.env.SMTP_HOST = 'smtp.example.test'
  authResult = opsUser
  canJobBoard = true
  db = seed()
  sendMail.mockClear()
  tablesRead.length = 0
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.env.SMTP_HOST = OLD_SMTP
  logSpy.mockRestore()
  errSpy.mockRestore()
})

describe('job notes are readable only by people who can open the job page', () => {
  it('GET 403s for a user without job-board access and never reads notes', async () => {
    canJobBoard = false
    const res = await GET(new Request('https://crm.example/x'), ctx)
    expect(res.status).toBe(403)
    expect(tablesRead).not.toContain('activities')
  })

  it('POST 403s for a user without job-board access and writes nothing', async () => {
    canJobBoard = false
    const res = await POST(post({ note: '@Steve Potts hi' }), ctx)
    expect(res.status).toBe(403)
    expect(db.tables.activities).toHaveLength(0)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('a posted note is a Production message on the deal, and GET returns it; production_job_notes is never written', async () => {
    const res = await POST(post({ note: 'Dumpster on the street' }), ctx)
    expect(res.status).toBe(200)
    expect(db.tables.activities).toHaveLength(1)
    expect(db.tables.activities[0]).toMatchObject({ audience: 'production', opportunity_id: 'opp-1', customer_id: 'cust-1', body: 'Dumpster on the street' })
    expect(db.tables.production_job_notes).toHaveLength(0)
    const list = await (await GET(new Request('https://crm.example/x'), ctx)).json()
    expect(list.notes.map((n: { note: string }) => n.note)).toEqual(['Dumpster on the street'])
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
    for (const u of USERS) if (u.email) expect(logged).not.toContain(u.email)
  })

  it('inactive users and users without an email are never mention targets', async () => {
    await POST(post({ note: '@Gone User and @No Email' }), ctx)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('mention content follows the RECIPIENT’s access', () => {
  const NOTE = 'Dumpster plan is fixed — @Steve Potts @Stephanie Reyes please check'

  it('a recipient who can read Production (operations) gets the note text and a needs-reply/FYI row', async () => {
    await POST(post({ note: NOTE }), ctx)
    const m = mailTo('steve@example.test')
    expect(m.text).toContain('Dumpster plan is fixed')
  })

  it('a setter recipient gets a content-free ping and is never added to the audience', async () => {
    await POST(post({ note: NOTE }), ctx)
    const m = mailTo('steph@example.test')
    for (const part of [m.html, m.text, m.subject]) {
      expect(part).not.toContain('Dumpster plan')
      expect(part).not.toContain('please check')
    }
    const notif = db.tables.notifications.find((n) => n.recipient_user_id === 'u-stephanie')!
    expect(notif.type).toBe('thread_mention_blind')
    expect(String(notif.body)).not.toContain('Dumpster')
  })
})

describe('mention email links and escaping', () => {
  const OLD_ENV = process.env.NEXT_PUBLIC_APP_URL
  beforeAll(() => { process.env.NEXT_PUBLIC_APP_URL = 'https://crm.arx.test/' })
  afterAll(() => { process.env.NEXT_PUBLIC_APP_URL = OLD_ENV })

  it('links use the configured app URL, never the Origin header or a client page_url', async () => {
    await POST(post({ note: '@Steve Potts look', page_url: 'https://evil.test/x' }, { origin: 'https://evil.test' }), ctx)
    const m = mailTo('steve@example.test')
    expect(m.html).not.toContain('evil.test')
    expect(m.text).not.toContain('evil.test')
    expect(m.html).toContain('href="https://crm.arx.test/c/cust-1/d/opp-1/overview/n/')
  })

  it('sender names are HTML-escaped', async () => {
    await POST(post({ note: '@Steve Potts look' }), ctx)
    const m = mailTo('steve@example.test')
    expect(m.html).toContain('Ops &lt;b&gt;Person&lt;/b&gt;')
    expect(m.html).not.toContain('<b>Person</b>')
  })
})
