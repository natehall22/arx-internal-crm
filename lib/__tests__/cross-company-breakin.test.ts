/** @jest-environment node */
/**
 * S4 cross-company break-in suite. Signed in as company B's owner (admin + super admin — the most a company user can
 * hold), call EVERY exported method of EVERY app/api route with company A's ids in the path, query and body, and
 * assert: no A data in the response, no A row changed/deleted, no row inserted into A, no storage object / auth user /
 * email / outbound call of A's touched. Harness + fixtures: lib/test-helpers/breakin-harness.ts.
 *
 * A route that cannot be exercised here is listed in NOT_EXERCISED with the reason and the code-read verdict.
 */
import fs from 'node:fs'
import { join, sep } from 'node:path'
import { NextRequest } from 'next/server'
import { __resetCompanyHostCacheForTests } from '@/lib/company-host'
import {
  ATTACKER_TOKEN, BRAVO_PUBLIC_TOKEN, BRAVO_ROW_ID, ORG_A, ORG_B, SERVICE_KEY, VICTIM_ID, companyTables, createWorld, crossReferences, crossings, findings, routePathOf, tablesInCode, walk,
  type Finding, type World,
} from '@/lib/test-helpers/breakin-harness'

const ROOT = join(__dirname, '..', '..')
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-test'
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
process.env.CRON_SECRET = 'cron-secret-the-attacker-does-not-have'
delete process.env.DEPLOYMENT_ORG_ID
delete process.env.APP_BASE_DOMAIN

/**
 * BREAKIN_SELF=1 runs the same calls with company B's OWN ids. It is the control for this suite: it shows which routes
 * actually reach a record when the id is right (`readsOfBRecord` / "Bravo" in the body), so a 404 in the attack run means
 * "refused A's record", not "never got past input parsing". The same no-A-data assertions still apply.
 */
const SELF = !!process.env.BREAKIN_SELF
const TARGET = SELF ? BRAVO_ROW_ID : VICTIM_ID
const TARGET_ORG = SELF ? ORG_B : ORG_A
const TABLES = tablesInCode(ROOT)
const ORG_TABLES = companyTables(ROOT)
let mockWorld: World
let mockReq: { headers: Headers; cookies: Array<{ name: string; value: string }> } = { headers: new Headers(), cookies: [] }

jest.mock('next/headers', () => ({
  headers: () => mockReq.headers,
  cookies: () => ({
    get: (n: string) => mockReq.cookies.find((c) => c.name === n),
    getAll: () => mockReq.cookies,
    has: (n: string) => mockReq.cookies.some((c) => c.name === n),
    set: () => undefined,
    delete: () => undefined,
  }),
  draftMode: () => ({ isEnabled: false }),
}))
jest.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: `NEXT_REDIRECT;${to}` }) },
  notFound: () => { throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' }) },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) },
  useRouter: () => ({}), usePathname: () => '/', useSearchParams: () => new URLSearchParams(),
}))
jest.mock('nodemailer', () => {
  const t = { sendMail: async (m: unknown) => { mockWorld.outbound.push(`mail ${JSON.stringify(m)}`); return { messageId: 'x' } }, verify: async () => true }
  return { __esModule: true, default: { createTransport: () => t }, createTransport: () => t }
})
jest.mock('@supabase/supabase-js', () => {
  const { ORG_A: A, ORG_B: B, ATTACKER_ID, ATTACKER_TOKEN: TOK, SERVICE_KEY: SK, ownerOf } = jest.requireActual('@/lib/test-helpers/breakin-harness')
  const userFor = (t?: string | null) => (t === TOK ? { id: ATTACKER_ID, email: 'boss@bravo.test', user_metadata: {}, app_metadata: {} } : null)
  return {
    createClient: (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
      const bearer = opts?.global?.headers?.Authorization?.replace(/^Bearer /, '') ?? null
      const w = () => mockWorld
      type Data = { from: (t: string) => unknown; rpc: (n: string, a: Record<string, unknown>) => unknown }
      const data = (): Data =>
        key === SK
          ? w().db.client
          : w().db.viewClient((table: string, r: Record<string, unknown>) => {
              const o = ownerOf(table, r)
              if (o !== A && o !== B) return true
              return bearer === TOK && o === B
            })
      const logAdmin = (op: string) => async (...args: unknown[]) => {
        w().authAdmin.push({ op, arg: JSON.stringify(args) })
        return { data: { user: null, users: [], properties: {} }, error: { message: 'auth admin disabled in test' } }
      }
      const bucket = (b: string) => {
        const log = (op: string) => async (...args: unknown[]) => {
          w().storage.push({ bucket: b, op, arg: JSON.stringify(args) })
          const path = typeof args[0] === 'string' ? args[0] : ''
          return { data: { signedUrl: `https://storage.test/${b}/${path}`, path, publicUrl: `https://storage.test/${b}/${path}` }, error: null }
        }
        return {
          upload: log('upload'), download: log('download'), createSignedUrl: log('createSignedUrl'), createSignedUrls: log('createSignedUrls'),
          remove: log('remove'), list: log('list'), move: log('move'), copy: log('copy'), update: log('update'),
          createSignedUploadUrl: log('createSignedUploadUrl'), uploadToSignedUrl: log('uploadToSignedUrl'),
          getPublicUrl: (p: string) => { w().storage.push({ bucket: b, op: 'getPublicUrl', arg: p }); return { data: { publicUrl: `https://storage.test/${b}/${p}` } } },
        }
      }
      return {
        from: (t: string) => data().from(t),
        rpc: (n: string, a: Record<string, unknown>) => data().rpc(n, a),
        storage: { from: bucket },
        auth: {
          getUser: async (t?: string) => { const u = userFor(t ?? bearer); return { data: { user: u }, error: u ? null : { message: 'invalid' } } },
          getSession: async () => ({ data: { session: null }, error: null }),
          signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }),
          signOut: async () => ({ error: null }),
          resetPasswordForEmail: async () => ({ error: null }),
          exchangeCodeForSession: async () => ({ data: {}, error: { message: 'no' } }),
          verifyOtp: async () => ({ data: {}, error: { message: 'no' } }),
          setSession: async () => ({ data: {}, error: { message: 'no' } }),
          updateUser: logAdmin('updateUser(self)'),
          admin: {
            getUserById: logAdmin('getUserById'), listUsers: logAdmin('listUsers'), createUser: logAdmin('createUser'),
            deleteUser: logAdmin('deleteUser'), updateUserById: logAdmin('updateUserById'), inviteUserByEmail: logAdmin('inviteUserByEmail'),
            generateLink: logAdmin('generateLink'), signOut: logAdmin('signOut'),
          },
        },
        channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
        removeChannel: () => undefined,
      }
    },
  }
})

// React's server-only `cache` is missing from the client build jest loads; per-request memo is irrelevant here.
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: (fn: unknown) => fn }))
// ESM-only or native packages jest cannot load; none of them decides who may see what.
jest.mock('jose', () => ({ SignJWT: class { setProtectedHeader() { return this } setIssuedAt() { return this } setIssuer() { return this } async sign() { return 'jwt' } }, importPKCS8: async () => ({}) }))
jest.mock('geotiff', () => ({ fromArrayBuffer: async () => { throw new Error('geotiff disabled in test') } }))
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document', Page: 'Page', Text: 'Text', View: 'View', Image: 'Image', Link: 'Link', Svg: 'Svg', Path: 'Path', Font: { register: () => undefined, registerHyphenationCallback: () => undefined },
  StyleSheet: { create: (s: unknown) => s }, renderToBuffer: async () => Buffer.from('%PDF-test'), renderToStream: async () => null, pdf: () => ({ toBuffer: async () => Buffer.from('%PDF-test'), toBlob: async () => new Blob(['%PDF']) }),
}))

const realFetch = global.fetch
beforeAll(() => {
  global.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    // Company address lookup (lib/company-host.ts → rpc org_id_for_subdomain): alpha = A, bravo = B.
    if (String(input).endsWith('/rest/v1/rpc/org_id_for_subdomain')) {
      const sub = (JSON.parse(bodyText || '{}') as { p_subdomain?: string }).p_subdomain
      const org = sub === 'alpha' ? ORG_A : sub === 'bravo' ? ORG_B : null
      return new Response(JSON.stringify(org), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    mockWorld?.outbound.push(`fetch ${String(input)} ${bodyText}`)
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterAll(() => {
  global.fetch = realFetch
  delete process.env.APP_BASE_DOMAIN
  __resetCompanyHostCacheForTests()
})

/**
 * Routes this suite does not exercise, with why and what reading the code showed. Everything else is called.
 * Keep the reasons honest: a route only belongs here if calling it with the fake DB proves nothing.
 */
const NOT_EXERCISED: Record<string, string> = {}

const ID_KEYS = [
  'id', 'lead_id', 'leadId', 'job_id', 'jobId', 'opportunity_id', 'opportunityId', 'customer_id', 'customerId', 'deal_id', 'dealId',
  'user_id', 'userId', 'project_id', 'projectId', 'proposal_id', 'proposalId', 'appointment_id', 'appointmentId',
  'work_order_id', 'workOrderId', 'invoice_id', 'invoiceId', 'contract_id', 'contractId', 'change_order_id', 'changeOrderId',
  'report_id', 'reportId', 'file_id', 'fileId', 'photo_id', 'photoId', 'document_id', 'documentId', 'production_job_id',
  'productionJobId', 'sub_id', 'subId', 'subcontractor_id', 'crew_id', 'pricebook_id', 'pricebookId', 'item_id', 'itemId',
  'template_id', 'templateId', 'territory_id', 'territoryId', 'team_id', 'teamId', 'period_id', 'periodId',
  'payroll_period_id', 'comp_plan_id', 'closer_user_id', 'setter_user_id', 'owner_user_id', 'assigned_user_id',
  'target_user_id', 'targetUserId', 'measurement_id', 'measurementId', 'inspection_id', 'activity_id', 'thread_id',
  'payment_id', 'paymentId', 'line_id', 'lineId', 'checkup_id', 'checkupId', 'estimate_id', 'campaign_id', 'saved_report_id',
  'original_appointment_id', 'scheduled_appointment_id', 'roofing_type_id', 'financing_program_id', 'announcement_id',
]
const idBag = () => {
  const o: Record<string, unknown> = {}
  for (const k of ID_KEYS) o[k] = TARGET
  return o
}
const body = () => ({
  ...idBag(),
  org_id: TARGET_ORG, orgId: TARGET_ORG,
  ids: [TARGET], leadIds: [TARGET], lead_ids: [TARGET], jobIds: [TARGET], job_ids: [TARGET], userIds: [TARGET], user_ids: [TARGET],
  data: idBag(), updates: idBag(), patch: idBag(), item: idBag(), record: idBag(), lead: idBag(), job: idBag(),
  token: BRAVO_PUBLIC_TOKEN, path: `org/${TARGET_ORG}/x.pdf`, storage_path: `org/${TARGET_ORG}/x.pdf`,
  status: 'cancelled', notes: 'bravo was here', name: 'bravo', body: 'bravo', reason: 'other', action: 'delete', type: 'note',
})

/**
 * How company B reaches the app. `own` = B's own token on an unfenced address (the strongest position: auth succeeds,
 * so every refusal below comes from the route's own org checks). `a-address` = B's token on company A's web address
 * (host routing on). `a-code` = B's token with the iPhone header `X-Company-Code: alpha` (host routing on, legacy
 * host). In the last two the company fence (lib/company-host.ts) should refuse B before any route code runs.
 */
type Mode = { name: string; host: string; baseDomain?: string; code?: string }
const MODES: Mode[] = SELF
  ? [{ name: 'own (self-check, B ids)', host: 'bravo.crm.test' }]
  : [
      { name: 'own', host: 'bravo.crm.test' },
      { name: 'a-address', host: 'alpha.crm.test', baseDomain: 'crm.test' },
      { name: 'a-code', host: 'legacy.example', baseDomain: 'crm.test', code: 'alpha' },
    ]
let mode: Mode = MODES[0]

type Outcome = {
  mode: string; route: string; method: string; status: number | 'threw' | 'timeout'; error?: string; findings: Finding[]; xref: string[]; readA: boolean
  rpcA: string[]; reached: boolean
}
const outcomes: Outcome[] = []

const routeFiles = walk(join(ROOT, 'app', 'api')).filter((f) => f.endsWith(`route.ts`)).sort()
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function urlFor(routePath: string) {
  const params: Record<string, string | string[]> = {}
  const path = routePath.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, rest, name: string) => {
    // A [token] gets B's own valid public token, so token routes resolve B's record and the A ids elsewhere in the
    // request test whether a link can be walked to another company's records. [kind] = a real signed-document kind.
    const v = name === 'orgId' ? TARGET_ORG : /token/i.test(name) ? BRAVO_PUBLIC_TOKEN : name === 'kind' ? 'change-order' : TARGET
    params[name] = rest ? [v] : v
    return v
  })
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(idBag())) qs.set(k, String(v))
  qs.set('org_id', TARGET_ORG)
  qs.set('orgId', TARGET_ORG)
  qs.set('token', BRAVO_PUBLIC_TOKEN)
  qs.set('path', `org/${TARGET_ORG}/x.pdf`)
  return { url: `https://${mode.host}${path}?${qs}`, params }
}

async function attack(handler: (req: NextRequest, ctx: { params: Record<string, unknown> }) => Promise<Response>, method: string, routePath: string, kind: 'json' | 'form') {
  const { url, params } = urlFor(routePath)
  const cookieValue = encodeURIComponent(JSON.stringify({ access_token: ATTACKER_TOKEN }))
  const headers = new Headers({
    authorization: `Bearer ${ATTACKER_TOKEN}`,
    cookie: `sb-proj-auth-token=${cookieValue}`,
    host: mode.host,
  })
  if (mode.code) headers.set('x-company-code', mode.code)
  let payload: BodyInit | undefined
  if (method !== 'GET' && method !== 'DELETE') {
    if (kind === 'json') {
      headers.set('content-type', 'application/json')
      payload = JSON.stringify(body())
    } else {
      const fd = new FormData()
      for (const [k, v] of Object.entries(body())) fd.set(k, typeof v === 'string' ? v : JSON.stringify(v))
      fd.set('file', new Blob(['x'], { type: 'image/png' }), 'x.png')
      payload = fd
    }
  }
  mockReq = { headers, cookies: [{ name: 'sb-proj-auth-token', value: cookieValue }] }
  const abort = new AbortController()
  const req = new NextRequest(url, { method, headers, body: payload, signal: abort.signal })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), 4000) })
  try {
    const res = await Promise.race([handler(req, { params }), timeout])
    if (res === 'timeout') return { status: 'timeout' as const, text: '' }
    const loc = res.headers?.get?.('location') ?? ''
    return { status: res.status, text: `${await readBody(res)} ${loc}` }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    return { status: 'threw' as const, text: msg, error: msg.slice(0, 160) }
  } finally {
    clearTimeout(timer)
    abort.abort() // ends server-sent-event streams (their abort listener clears the poll timers)
  }
}

/** Whole body, or what a stream (server-sent events) sent in its first 1.5 s — the first push is where a leak would be. */
async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const dec = new TextDecoder()
  let out = ''
  const deadline = Date.now() + 1500
  try {
    for (;;) {
      const left = deadline - Date.now()
      if (left <= 0) break
      let t: NodeJS.Timeout | undefined
      const chunk = await Promise.race([reader.read(), new Promise<'late'>((r) => { t = setTimeout(() => r('late'), left) })])
      clearTimeout(t)
      if (chunk === 'late' || chunk.done) break
      out += dec.decode(chunk.value, { stream: true })
    }
  } catch { /* stream errored */ }
  await reader.cancel().catch(() => undefined)
  return out
}

/**
 * SQL functions that are called with an id from the request, each read and confirmed to check the id against the
 * caller's own org (passed as p_org_id from the signed-in profile). Any OTHER rpc that receives company A's id fails the
 * suite until someone reads its SQL and adds it here.
 */
const VERIFIED_RPCS: Record<string, string> = {
  cancel_production_job: 'supabase/migrations/202609140001_production_job_cancellation.sql: WHERE id = p_job_id AND org_id = p_org_id, else P0002',
  uncancel_production_job: 'supabase/migrations/202609260001_uncancel_restore_only_this_cancel.sql: WHERE id = p_job_id AND org_id = p_org_id, else P0002',
}

/**
 * Company-B rows that may legitimately carry an id that happens to be company A's. Empty: a B row pointing at an A
 * record is a cross-company reference (it can squat A's unique keys or show up in A's lists), so it fails the suite.
 */
const ALLOWED_XREF: Record<string, string> = {
  'leads.external_lead_id': 'webhooks/leads: the sending system\'s own lead id (free text from the webhook body), not a CRM row reference',
}

/** The harness must catch a hole when there is one; otherwise every green route below proves nothing. */
const describeUnlessSelf = SELF ? describe.skip : describe
describeUnlessSelf('harness catches a planted hole', () => {
  const { createServiceClient } = jest.requireActual('@/lib/supabase/service') as typeof import('@/lib/supabase/service')
  const run = async (h: (req: NextRequest, ctx: { params: Record<string, unknown> }) => Promise<Response>) => {
    mockWorld = createWorld(TABLES, ORG_TABLES)
    const r = await attack(h, 'POST', '/api/planted/[id]', 'json')
    return { kinds: findings(mockWorld, r.text).map((f) => f.kind), xref: crossReferences(mockWorld) }
  }
  test('read by id with no org filter → leak', async () => {
    const out = await run(async (_req, { params }) => {
      const { data } = await createServiceClient().from('leads').select('*').eq('id', params.id as string).maybeSingle()
      return Response.json(data)
    })
    expect(out.kinds).toContain('leak')
  })
  test('update by id with no org filter → write', async () => {
    const out = await run(async (_req, { params }) => {
      await createServiceClient().from('production_jobs').update({ status: 'cancelled' }).eq('id', params.id as string)
      return Response.json({ ok: true })
    })
    expect(out.kinds).toContain('write')
  })
  test('child row on A parent → insert_into_a; B row pointing at A → cross-reference', async () => {
    const out = await run(async (_req, { params }) => {
      const db = createServiceClient()
      await db.from('job_payments').insert({ job_id: params.id, amount: 1 })
      await db.from('inspection_results').insert({ org_id: ORG_B, opportunity_id: params.id })
      return Response.json({ ok: true })
    })
    expect(out.kinds).toContain('insert_into_a')
    expect(out.xref).toContain('inspection_results.opportunity_id')
  })
  test('an RLS (user-token) read of A rows sees nothing', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => ReturnType<typeof createServiceClient> }
    mockWorld = createWorld(TABLES, ORG_TABLES)
    const c = createClient('u', 'anon-key-test', { global: { headers: { Authorization: `Bearer ${ATTACKER_TOKEN}` } } })
    const { data } = await c.from('leads').select('*')
    expect((data as Array<{ org_id: string }>).map((r) => r.org_id)).toEqual([ORG_B])
  })
})

for (const m of MODES) {
  describe(`company B (${m.name}) cannot read or change company A through any API route`, () => {
    beforeAll(() => {
      mode = m
      if (m.baseDomain) process.env.APP_BASE_DOMAIN = m.baseDomain
      else delete process.env.APP_BASE_DOMAIN
      __resetCompanyHostCacheForTests()
    })
    for (const file of routeFiles) {
      const routePath = routePathOf(ROOT, file)
      if (NOT_EXERCISED[routePath]) continue
      test(routePath, async () => {
        const problems: string[] = []
        let mod: Record<string, unknown>
        try {
          mod = require(file)
        } catch (e) {
          const msg = String((e as Error).message).slice(0, 160)
          outcomes.push({ mode: m.name, route: routePath, method: 'IMPORT', status: 'threw', error: msg, findings: [], xref: [], readA: false, rpcA: [], reached: false })
          throw new Error(`IMPORT ${routePath}: ${msg}`)
        }
        for (const method of METHODS) {
          const h = mod[method]
          if (typeof h !== 'function') continue
          mockWorld = createWorld(TABLES, ORG_TABLES)
          let r = await attack(h as never, method, routePath, 'json')
          if (r.status === 'threw' && /Content-Type was not one of/.test(r.text)) {
            mockWorld = createWorld(TABLES, ORG_TABLES)
            r = await attack(h as never, method, routePath, 'form')
          }
          const f = findings(mockWorld, r.text)
          const rpcA = mockWorld.rpcs.filter((x) => JSON.stringify(x.args).match(new RegExp(`${VICTIM_ID}|${ORG_A}`))).map((x) => x.name)
          const xref = crossReferences(mockWorld)
          const reached = mockWorld.readsOfBRecord.length > 0 || r.text.includes('Bravo')
          outcomes.push({ mode: m.name, route: routePath, method, status: r.status, error: 'error' in r ? r.error : undefined, findings: f, xref, readA: mockWorld.readsOfA.length > 0, rpcA, reached })
          for (const x of f) problems.push(`${method} ${routePath} [${r.status}] ${x.kind}: ${x.detail}`)
          for (const x of xref) if (!ALLOWED_XREF[x]) problems.push(`${method} ${routePath} [${r.status}] cross-reference: company B row ${x} = company A's id`)
          for (const n of rpcA) if (!VERIFIED_RPCS[n]) problems.push(`${method} ${routePath} [${r.status}] rpc ${n} received company A's id — read its SQL, then list it in VERIFIED_RPCS`)
        }
        expect(problems).toEqual([])
      }, 60_000)
    }
  })
}

/**
 * Background jobs run for every company at once (lib/cron-orgs.ts). Called the way Vercel calls them (the real cron
 * secret, no user), with both companies holding data: nothing written for one company may point at the other's
 * records, and no email to one company's people may carry the other's data.
 */
describeUnlessSelf('crons keep each company to itself', () => {
  beforeAll(() => {
    mode = { name: 'cron', host: 'legacy.example' }
    delete process.env.APP_BASE_DOMAIN
    __resetCompanyHostCacheForTests()
  })
  const cronFiles = routeFiles.filter((f) => routePathOf(ROOT, f).startsWith('/api/cron/'))
  test('there are crons to check', () => expect(cronFiles.length).toBeGreaterThan(5))
  for (const file of cronFiles) {
    const routePath = routePathOf(ROOT, file)
    test(routePath, async () => {
      const mod = require(file) as Record<string, unknown>
      const problems: string[] = []
      for (const method of METHODS) {
        const h = mod[method]
        if (typeof h !== 'function') continue
        mockWorld = createWorld(TABLES, ORG_TABLES)
        const headers = new Headers({ authorization: `Bearer ${process.env.CRON_SECRET}`, host: mode.host })
        if (method !== 'GET') headers.set('content-type', 'application/json')
        mockReq = { headers, cookies: [] }
        const req = new NextRequest(`https://${mode.host}${routePath}`, { method, headers, body: method === 'GET' ? undefined : '{}' })
        let status: number | string = 'threw'
        let timer: NodeJS.Timeout | undefined
        try {
          const late = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), 8000) })
          const res = await Promise.race([(h as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: {} }), late])
          status = res === 'timeout' ? 'timeout' : res.status
        } catch (e) {
          status = `threw ${String((e as Error).message).slice(0, 80)}`
        } finally {
          clearTimeout(timer)
        }
        outcomes.push({ mode: 'cron', route: routePath, method, status: typeof status === 'number' ? status : 'threw', error: typeof status === 'string' ? status : undefined, findings: [], xref: crossings(mockWorld), readA: mockWorld.readsOfA.length > 0, rpcA: [], reached: mockWorld.readsOfBRecord.length > 0 })
        for (const x of crossings(mockWorld)) problems.push(`${method} ${routePath} [${status}] ${x}`)
      }
      expect(problems).toEqual([])
    }, 60_000)
  }
})

/**
 * Server pages with an id in the address (any `[param]` folder under app, e.g. app/leads/[id]/page.tsx). The page function runs as company B's owner with
 * A's ids; the element tree it returns is rendered shallowly (async server children are awaited, client components
 * are not run) and every prop is searched for A's data — a server page hands its data to client components as props.
 * redirect / notFound count as refusals. 'use client' pages load their data from /api (covered above).
 */
const pageFiles = walk(join(ROOT, 'app'))
  .filter((f) => f.endsWith(`${sep}page.tsx`) && f.includes('[') && !f.includes(`${sep}api${sep}`) && !f.includes('dev-harness'))
  .sort()

async function renderShallow(node: unknown, depth = 0): Promise<unknown> {
  if (depth > 12 || node == null || typeof node !== 'object') return node
  if (Array.isArray(node)) return Promise.all(node.map((n) => renderShallow(n, depth + 1)))
  const el = node as { type?: unknown; props?: Record<string, unknown> }
  if (!('$$typeof' in (node as object))) return node
  const props = el.props ?? {}
  // An async function component is a server component: run it (that is where its data comes from).
  if (typeof el.type === 'function' && el.type.constructor?.name === 'AsyncFunction') {
    return renderShallow(await (el.type as (p: unknown) => Promise<unknown>)(props), depth + 1)
  }
  return { type: typeof el.type === 'string' ? el.type : (el.type as { name?: string })?.name ?? 'C', props: await renderShallow(Object.fromEntries(Object.entries(props)), depth + 1) }
}

function safeJson(v: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'object' && x !== null) {
      if (seen.has(x)) return '[circular]'
      seen.add(x)
    }
    return typeof x === 'function' ? undefined : x
  }) ?? ''
}

for (const m of MODES) {
  describe(`company B (${m.name}) cannot open company A's records through a server page`, () => {
    beforeAll(() => {
      mode = m
      if (m.baseDomain) process.env.APP_BASE_DOMAIN = m.baseDomain
      else delete process.env.APP_BASE_DOMAIN
      __resetCompanyHostCacheForTests()
    })
    for (const file of pageFiles) {
      const rel = file.slice(ROOT.length)
      const client = /^\s*['"]use client['"]/.test(fs.readFileSync(file, 'utf8'))
      ;(client ? test.skip : test)(rel, async () => {
        const routePath = routePathOf(ROOT, file).replace(/\/page\.tsx$/, '')
        const page = (require(file) as { default: (p: unknown) => unknown }).default
        mockWorld = createWorld(TABLES, ORG_TABLES)
        const { params } = urlFor(routePath)
        const searchParams = Object.fromEntries(new URL(urlFor(routePath).url).searchParams)
        const cookieValue = encodeURIComponent(JSON.stringify({ access_token: ATTACKER_TOKEN }))
        const headers = new Headers({ authorization: `Bearer ${ATTACKER_TOKEN}`, host: mode.host, cookie: `sb-proj-auth-token=${cookieValue}` })
        if (mode.code) headers.set('x-company-code', mode.code)
        mockReq = { headers, cookies: [{ name: 'sb-proj-auth-token', value: cookieValue }] }
        let text = ''
        let status = 'rendered'
        try {
          text = safeJson(await renderShallow(await page({ params, searchParams })))
        } catch (e) {
          const d = String((e as { digest?: string }).digest ?? (e as Error).message)
          status = /NEXT_REDIRECT|NEXT_NOT_FOUND/.test(d) ? d.split(';')[0] : `threw ${d.slice(0, 120)}`
        }
        const f = findings(mockWorld, text)
        const xref = crossReferences(mockWorld)
        outcomes.push({ mode: m.name, route: rel, method: 'PAGE', status: status === 'rendered' ? 200 : 'threw', error: status, findings: f, xref, readA: mockWorld.readsOfA.length > 0, rpcA: [], reached: mockWorld.readsOfBRecord.length > 0 || text.includes('Bravo') })
        expect([...f.map((x) => `${x.kind}: ${x.detail}`), ...xref.map((x) => `cross-reference ${x}`)]).toEqual([])
      }, 60_000)
    }
  })
}

afterAll(() => {
  if (!process.env.BREAKIN_REPORT) return
  // Coverage table for humans: BREAKIN_REPORT=1 npx jest cross-company-breakin
  const fs = jest.requireActual('node:fs') as typeof import('node:fs')
  fs.writeFileSync(process.env.BREAKIN_REPORT, JSON.stringify(outcomes, null, 1))
})
