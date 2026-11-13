/** @jest-environment node */
/** Website form snippet → existing webhook → a lead with its service field, routed; JSON integrations unchanged. */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { buildLeadFormSnippet, LEAD_FORM_TEXT } from '@/lib/lead-form-snippet'
import { LEAD_FORM_HONEYPOT_FIELD } from '@/lib/lead-intake'
import { resetPublicEstimateRateLimitForTests } from '@/lib/public-estimate-rate-limit'

const sendMail = jest.fn(async (_m: { to: string }) => ({}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }))
jest.mock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: () => 'crm@example.com' }))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST } from '@/app/api/webhooks/leads/route'

const ORG = '11111111-1111-4111-8111-111111111111'
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const TOKEN = 'tok-site'
const SERVICES = ['Weekly lawn care', 'Pressure washing']

const rotate = (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
  const ptrs = (t.lead_routing_pointers ??= [])
  let p = ptrs.find((r) => r.scope === args.p_scope)
  if (!p) ptrs.push((p = { scope: args.p_scope, last_user_id: null }))
  const ids = args.p_user_ids as string[]
  p.last_user_id = ids[(ids.indexOf(p.last_user_id as string) + 1) % ids.length]
  return p.last_user_id
}

/** JS mirror of the shared counter (portal_take_attempt): true while within the limit. */
const takeAttempt = (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
  const rows = (t.portal_rate_limits ??= [])
  let r = rows.find((x) => x.key === args.p_key)
  if (!r) rows.push((r = { key: args.p_key, attempts: 0 }))
  r.attempts = (r.attempts as number) + 1
  return (r.attempts as number) <= (args.p_limit as number)
}

function seed(orgSettings: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
  db = createFakeDb(
    {
      orgs: [{ id: ORG, settings: orgSettings }],
      lead_sources: [{ id: 'ls1', org_id: ORG, name: 'Website', source_type: 'website', webhook_token: TOKEN, webhook_enabled: true, is_active: true, service_options: SERVICES, ...source }],
      users: [
        { id: A, org_id: ORG, active: true, role: 'sales_rep', email: 'a@x.test' },
        { id: B, org_id: ORG, active: true, role: 'sales_rep', email: 'b@x.test' },
        { id: 'adm', org_id: ORG, role: 'admin', active: true, email: 'adm@x.test', created_at: '2026-01-01' },
      ],
    },
    { rpc: { lead_routing_next: rotate, portal_take_attempt: takeAttempt } }
  )
}
const post = (body: Record<string, unknown>, ip = '203.0.113.5') =>
  POST(new NextRequest(`https://crm.example/api/webhooks/leads?token=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }))

/** What the pasted form's script sends: every named field in the snippet, as typed by a visitor (blank honeypot included). */
function formPayload(values: Record<string, string>) {
  const html = buildLeadFormSnippet({ endpoint: 'https://crm.example', token: TOKEN, services: SERVICES })
  const names = Array.from(html.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)).map((m) => m[1])
  return Object.fromEntries(names.map((n) => [n, values[n] ?? '']))
}

beforeEach(() => {
  resetPublicEstimateRateLimitForTests()
  sendMail.mockClear()
  seed()
})

describe('the snippet', () => {
  const html = buildLeadFormSnippet({ endpoint: 'https://crm.example/', token: TOKEN, services: ['Lawn <b>care</b>', 'Mulch'] })
  test('posts to this source\'s webhook, has every field, the honeypot and the dropdown', () => {
    expect(html).toContain('https://crm.example/api/webhooks/leads?token=tok-site')
    for (const n of ['name', 'phone', 'email', 'address', 'service_requested', 'message', LEAD_FORM_HONEYPOT_FIELD]) expect(html).toContain(`name="${n}"`)
    expect(html).toContain(LEAD_FORM_TEXT.success)
    expect(html).toContain(LEAD_FORM_TEXT.error)
  })
  test('service choices are escaped; no dropdown when there are none', () => {
    expect(html).toContain('<option>Lawn &lt;b&gt;care&lt;/b&gt;</option>')
    expect(buildLeadFormSnippet({ endpoint: 'https://crm.example', token: 'x', services: [] })).not.toContain('service_requested')
  })
  test('a token can never close the script tag', () => {
    expect(buildLeadFormSnippet({ endpoint: 'https://a.test', token: '</script><script>x', services: [] })).not.toContain('</script><script>x')
  })
})

describe('snippet → webhook → lead', () => {
  test('the lead keeps its service as a field (and still in the notes), source and owner', async () => {
    const res = await post(formPayload({ name: 'Pat Lee', phone: '850-555-0100', service_requested: 'Pressure washing', message: 'Driveway' }))
    expect(res.status).toBe(200)
    expect(db.tables.leads).toEqual([expect.objectContaining({ org_id: ORG, homeowner_name: 'Pat Lee', service_requested: 'Pressure washing', lead_source_id: 'ls1', source: 'Website', owner_user_id: 'adm' })])
    expect(String(db.tables.leads[0].notes)).toContain('Service requested: Pressure washing')
    expect(db.tables.notifications).toEqual([expect.objectContaining({ recipient_user_id: 'adm', type: 'new_lead' })])
  })
  test('routing by service sends it to that person, who gets the new-lead bell and email', async () => {
    seed({ leadIntake: { mode: 'service', userIds: [], rules: [{ service: 'Pressure washing', userIds: [B] }] } })
    await post(formPayload({ name: 'Pat Lee', email: 'p@x.test', service_requested: 'Pressure washing' }))
    expect(db.tables.leads[0].owner_user_id).toBe(B)
    expect(db.tables.notifications[0]).toEqual(expect.objectContaining({ recipient_user_id: B, type: 'new_lead' }))
    expect(sendMail.mock.calls[0][0].to).toBe('b@x.test')
  })
  test('routing by category: the form’s category (slug or label) or the source default picks the person; free text is dropped', async () => {
    seed({ leadIntake: { mode: 'category', userIds: [], rules: [], categoryRules: [{ category: 'commercial', userIds: [B] }] } }, { default_category: 'residential' })
    await post({ name: 'Plaza', phone: '1', category: 'Commercial' })
    await post({ name: 'Home', phone: '2' }) // the source default (residential): no rule → the fallback
    await post({ name: 'Bot', phone: '3', category: 'whatever you like' }) // not on the list → the source default
    expect(db.tables.leads.map((l) => [l.homeowner_name, l.category, l.owner_user_id])).toEqual([
      ['Plaza', 'commercial', B],
      ['Home', 'residential', 'adm'],
      ['Bot', 'residential', 'adm'],
    ])
  })
  test('taking turns across two form posts', async () => {
    seed({ leadIntake: { mode: 'rotate', userIds: [A, B], rules: [] } })
    await post(formPayload({ name: 'One', phone: '1' }))
    await post(formPayload({ name: 'Two', phone: '2' }))
    expect(db.tables.leads.map((l) => l.owner_user_id)).toEqual([A, B])
  })
  test('a source override beats the company setting', async () => {
    seed({ leadIntake: { mode: 'rotate', userIds: [A, B], rules: [] } }, { routing: { mode: 'person', userIds: [], rules: [] }, auto_assign_user_id: B })
    await post(formPayload({ name: 'One', phone: '1' }))
    expect(db.tables.leads[0].owner_user_id).toBe(B)
  })
})

describe('form protection', () => {
  test('a filled honeypot looks like success and writes nothing', async () => {
    const res = await post(formPayload({ name: 'Bot', phone: '1', [LEAD_FORM_HONEYPOT_FIELD]: 'http://spam' }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(db.tables.leads ?? []).toHaveLength(0)
  })
  test('too many form posts from one address → 429 with plain text; another address is fine', async () => {
    for (let i = 0; i < 5; i++) expect((await post(formPayload({ name: 'P' + i, phone: '1' }))).status).toBe(200)
    const limited = await post(formPayload({ name: 'Six', phone: '1' }))
    expect(limited.status).toBe(429)
    expect((await limited.json()).error).toBe(LEAD_FORM_TEXT.tooMany)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await post(formPayload({ name: 'Elsewhere', phone: '1' }), '198.51.100.9')).status).toBe(200)
  })
  test('a form with no name or no way to reach them is refused in plain words', async () => {
    const res = await post(formPayload({ name: 'No Contact' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(LEAD_FORM_TEXT.missing)
    expect(db.tables.leads ?? []).toHaveLength(0)
  })
})

describe('a public website form source (public_form)', () => {
  const pub = (extra: Record<string, unknown> = {}) => seed({}, { public_form: true, ...extra })
  test('always needs the honeypot field: a plain JSON post without it is refused', async () => {
    pub()
    const res = await post({ name: 'Bot', phone: '1' })
    expect(res.status).toBe(400)
    expect(db.tables.leads ?? []).toHaveLength(0)
  })
  test('always needs a name and a phone or email', async () => {
    pub()
    expect((await post({ name: 'No Contact', [LEAD_FORM_HONEYPOT_FIELD]: '' })).status).toBe(400)
  })
  test('the limit is counted in the database: 5 per address, then 429; a second address is separate', async () => {
    pub()
    for (let i = 0; i < 5; i++) expect((await post(formPayload({ name: 'P' + i, phone: '1' }))).status).toBe(200)
    expect((await post(formPayload({ name: 'Six', phone: '1' }))).status).toBe(429)
    expect((await post(formPayload({ name: 'Elsewhere', phone: '1' }), '198.51.100.9')).status).toBe(200)
    expect(db.tables.portal_rate_limits.some((r) => String(r.key).startsWith('leadform:ls1:'))).toBe(true)
    // the in-memory limiter is not what decided it
    resetPublicEstimateRateLimitForTests()
    expect((await post(formPayload({ name: 'Still six', phone: '1' }))).status).toBe(429)
  })
  test('a daily cap per source (default 200; the company can set it) stops a flood from many addresses', async () => {
    pub({ form_daily_cap: 3 })
    for (let i = 0; i < 3; i++) expect((await post(formPayload({ name: 'N' + i, phone: '1' }), `198.51.100.${i + 1}`)).status).toBe(200)
    expect((await post(formPayload({ name: 'Over', phone: '1' }), '198.51.100.50')).status).toBe(429)
  })
})

describe('the JSON webhook is unchanged', () => {
  test('no limit, no extra required fields, old service wording still works', async () => {
    for (let i = 0; i < 8; i++) expect((await post({ message: 'hi ' + i })).status).toBe(200)
    expect(db.tables.leads).toHaveLength(8)
    await post({ name: 'Zap', service_type: 'pressure  washing' })
    await post({ name: 'Zap2', service_type: 'Gutters' })
    const last = db.tables.leads[8]
    expect(last.service_requested).toBe('Pressure washing') // matched to the source's choice, as written there
    expect(String(last.notes)).toContain('Service requested: pressure  washing')
    // not one of the choices: no structured value; the text stays in the notes and the raw payload
    const other = db.tables.leads[9]
    expect(other.service_requested).toBeNull()
    expect(String(other.notes)).toContain('Service requested: Gutters')
    expect((other.raw_payload as Record<string, unknown>).service_type).toBe('Gutters')
  })
  test('nothing stored = the same owner as before (source person else the oldest admin)', async () => {
    seed({}, { auto_assign_user_id: A })
    await post({ name: 'Zap' })
    expect(db.tables.leads[0].owner_user_id).toBe(A)
    expect(db.tables.lead_routing_pointers ?? []).toHaveLength(0)
  })
})
