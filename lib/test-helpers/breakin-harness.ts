/**
 * Cross-company break-in harness (S4). Company A (victim) and company B (attacker) share one fake database; every
 * company-A row in every table has the SAME id (`VICTIM_ID`), so any `[param]`, query or body id an attacker sends
 * lands on an A row in whichever table the route reads. A rows carry marker values (`ALPHA_SECRET`, an `alpha.test`
 * email, a 987654.32 amount, a 704-555-0199 phone) so a leak is visible in any response body, email, outbound call
 * or storage path.
 *
 * Clients: the service-role key sees everything (no RLS — the case a missing org filter turns into a leak). A
 * user-token client is EMULATED as company-scoped RLS (it sees only rows of the token's company). That emulation is an
 * assumption about the SQL policies, not proof of them; RLS policies are audited separately.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

type Row = Record<string, unknown>

export const VICTIM_ID = '0a0a0a0a-0000-4000-8000-00000000000a'
export const ORG_A = 'aaaaaaaa-0000-4000-8000-0000000000aa'
export const ORG_B = 'bbbbbbbb-0000-4000-8000-0000000000bb'
export const ATTACKER_ID = 'bbbbbbbb-0000-4000-8000-0000000000b1'
export const ATTACKER_TOKEN = 'tok-b'
/** Company B's own record id (every B row shares it) — used by the self-check run to prove a route reaches data. */
export const BRAVO_ROW_ID = '0b0b0b0b-0000-4000-8000-00000000000b'
/**
 * Company B's own VALID public token (crew link, signing link, report link, webhook key): 64 hex chars, so it passes every
 * token-format check. The attack sends it with company A's ids, i.e. "B holds a real link — can it be walked to A's records?"
 */
export const BRAVO_PUBLIC_TOKEN = 'b0'.repeat(32)
export const SERVICE_KEY = 'service-key-test'
export const MARK = 'ALPHA_SECRET'
export const A_EMAIL = 'alpha_secret@alpha.test'
export const A_PHONE = '7045550199'
export const A_AMOUNT = 987654.32
export const A_TOKEN = 'alpha-public-token-0000'
/** Any of these in a response / email / outbound call means company A's data reached company B. (A's org id and
 * public token are not in the list for responses: the attacker sends both, and routes may echo the request.) */
export const LEAK_PATTERNS = [MARK, 'alpha.test', '987654', A_PHONE]
/** Storage paths and auth-admin calls also fail on A's org id / token (the attacker cannot get those signed). */
const PATH_PATTERNS = [...LEAK_PATTERNS, ORG_A, A_TOKEN]
/** Hidden owner tag on child rows (tables with no org_id): lets the RLS emulation hide them from other companies. */
export const OWNER_TAG = '__owner_org'
/** Shared reference data — every company reads the same rows by design, so no company-A row is seeded. */
export const GLOBAL_TABLES = new Set([
  'permissions', 'preset_permissions', 'canvass_parcel_years', 'instant_estimate_calibration', 'lidar_tiles', 'solar_candidates',
  'solar_installs', 'weather_refresh_runs', 'nope',
])

/** Company tables (have org_id) — the SAME list the org-scope gate uses (scripts/org-scope-check.mjs). */
export function companyTables(root: string): Set<string> {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "import { orgTablesFromMigrations } from './scripts/org-scope-check.mjs'; console.log(JSON.stringify([...orgTablesFromMigrations()]))"],
    { cwd: root, encoding: 'utf8' }
  )
  return new Set(JSON.parse(out) as string[])
}

const FK_COLUMNS = [
  'opportunity_id', 'user_id', 'lead_id', 'job_id', 'owner_user_id', 'project_id', 'customer_id', 'closer_user_id',
  'setter_user_id', 'team_id', 'custom_role_id', 'canvasser_user_id', 'proposal_id', 'payroll_period_id', 'assigned_sub_id',
  'region_id', 'manager_user_id', 'appointment_id', 'comp_plan_id', 'salesperson_id', 'accepted_proposal_id',
  'assigned_user_id', 'recipient_user_id', 'vendor_id', 'pin_attributed_user_id', 'linked_proposal_id',
  'financing_program_id', 'production_job_id', 'actor_user_id', 'territory_id', 'work_order_id', 'report_id',
  'invoice_id', 'activity_id', 'campaign_id', 'original_appointment_id', 'scheduled_appointment_id', 'estimate_id',
  'contract_id', 'change_order_id', 'deal_id', 'file_id', 'photo_id', 'sub_id', 'subcontractor_id', 'crew_id',
  'pricebook_id', 'template_id', 'document_id', 'inspection_id', 'measurement_id', 'thread_id', 'period_id',
  'created_by', 'updated_by', 'sender_user_id', 'author_user_id', 'requested_by', 'approved_by', 'property_id',
  'service_plan_id', 'roofing_type_id', 'item_id', 'line_id', 'payment_id', 'bonus_line_id', 'cost_line_id',
]
const TEXT_MARKERS = [
  'name', 'full_name', 'first_name', 'last_name', 'title', 'description', 'notes', 'note', 'body', 'content', 'message',
  'address', 'address_text', 'address_line1', 'street', 'project_address', 'customer_name', 'homeowner_name',
  'company_name', 'label', 'summary', 'subject', 'scope', 'legal_name', 'contact_name',
]
const MONEY = ['amount', 'total', 'sale_amount', 'price', 'cost', 'project_cost', 'estimated_value', 'contract_amount', 'balance']
const PATHS = ['storage_path', 'file_path', 'pdf_url', 'pdf_path', 'url', 'photo_url', 'image_url', 'cover_image_url', 'logo_url', 'signed_pdf_url', 'path']
const TOKENS = [
  'token', 'signing_token', 'public_token', 'share_token', 'crew_token', 'crew_link_token', 'report_token', 'webhook_token',
  'access_token', 'refresh_token',
]

/** Every `.from('<table>')` name used by the server code. */
export function tablesInCode(root: string): string[] {
  const names = new Set<string>()
  for (const f of walk(join(root, 'app')).concat(walk(join(root, 'lib')))) {
    if (!/\.(ts|tsx)$/.test(f) || f.includes(`${sep}__tests__${sep}`)) continue
    for (const m of Array.from(readFileSync(f, 'utf8').matchAll(/\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)/g))) names.add(m[1])
  }
  return Array.from(names).sort()
}

export function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

export function victimRow(table: string, hasOrgId = true): Row {
  const r: Row = hasOrgId ? { id: VICTIM_ID, org_id: ORG_A } : { id: VICTIM_ID, [OWNER_TAG]: ORG_A }
  for (const k of FK_COLUMNS) r[k] = VICTIM_ID
  for (const k of TEXT_MARKERS) r[k] = `${MARK}_${table}_${k}`
  for (const k of MONEY) r[k] = A_AMOUNT
  for (const k of PATHS) r[k] = `org/${ORG_A}/${MARK}-${table}.pdf`
  for (const k of TOKENS) r[k] = A_TOKEN
  r.email = A_EMAIL
  r.phone = A_PHONE
  r.created_at = '2026-11-01T12:00:00.000Z'
  r.updated_at = '2026-11-01T12:00:00.000Z'
  return r
}

export function attackerSeed(table: string, hasOrgId = true): Row {
  const r: Row = { id: BRAVO_ROW_ID }
  for (const k of FK_COLUMNS) r[k] = BRAVO_ROW_ID
  for (const k of TEXT_MARKERS) r[k] = `Bravo ${table} ${k}`
  for (const k of TOKENS) r[k] = BRAVO_PUBLIC_TOKEN
  r.signing_token_hash = createHash('sha256').update(BRAVO_PUBLIC_TOKEN).digest('hex')
  // A live crew trade (lib/crew-link.ts needs trade + sub + a current date), so B's crew link resolves.
  // An enabled lead-source webhook, so B's webhook token is accepted.
  if (table === 'lead_sources') Object.assign(r, { webhook_enabled: true, is_active: true })
  if (table === 'work_orders') Object.assign(r, { trade: 'roofing', status: 'scheduled', install_days: 1, scheduled_date: new Date().toISOString().slice(0, 10) })
  Object.assign(r, { user_id: ATTACKER_ID, owner_user_id: ATTACKER_ID, created_at: '2026-11-02T12:00:00.000Z', updated_at: '2026-11-02T12:00:00.000Z' })
  if (hasOrgId) r.org_id = ORG_B
  else r[OWNER_TAG] = ORG_B
  return r
}

export function seedTables(tables: string[], orgTables: Set<string>, attackerRole = 'admin'): Record<string, Row[]> {
  const seed: Record<string, Row[]> = {}
  for (const t of tables) {
    if (GLOBAL_TABLES.has(t)) continue
    const org = orgTables.has(t) || t.startsWith('rpt_')
    seed[t] = [victimRow(t, org), attackerSeed(t, org)]
  }
  seed.orgs = [
    { ...victimRow('orgs'), id: ORG_A, org_id: undefined, settings: { brand: { shortName: MARK } }, subdomain: 'alpha' },
    { id: ORG_B, name: 'Bravo Co', settings: {}, subdomain: 'bravo', timezone: 'America/New_York' },
  ]
  seed.users = [
    { ...victimRow('users'), role: 'admin', is_super_admin: true, active: true },
    {
      id: ATTACKER_ID, org_id: ORG_B, role: attackerRole, is_super_admin: attackerRole === 'admin', active: true,
      email: 'boss@bravo.test', full_name: 'Bravo Boss', permissions: [],
    },
  ]
  return seed
}

export type Finding = { kind: 'leak' | 'write' | 'insert_into_a' | 'storage' | 'auth_admin' | 'exfil'; detail: string }

export type World = ReturnType<typeof createWorld>

/** One fresh database + side-effect logs for one attack request. */
export function createWorld(tables: string[], orgTables: Set<string>, attackerRole = 'admin') {
  const rpcs: Array<{ name: string; args: Row }> = []
  const readsOfA: string[] = []
  const readsOfBRecord: string[] = []
  const db = createFakeDb(seedTables(tables, orgTables, attackerRole), {
    onRpc: (name, args) => rpcs.push({ name, args }),
    onSelect: (table, rows) => {
      if (rows.some((r) => ownerOf(table, r) === ORG_A)) readsOfA.push(table)
      if (rows.some((r) => r.id === BRAVO_ROW_ID)) readsOfBRecord.push(table)
    },
  })
  const before = snapshotA(db.tables)
  const storage: Array<{ bucket: string; op: string; arg: string }> = []
  const authAdmin: Array<{ op: string; arg: string }> = []
  const outbound: string[] = []
  return { db, before, rpcs, readsOfA, readsOfBRecord, storage, authAdmin, outbound }
}

/** Which company a seeded row belongs to (org_id, the orgs row itself, or the hidden tag on child rows). */
export function ownerOf(table: string, r: Row): unknown {
  return table === 'orgs' ? r.id : r.org_id ?? r[OWNER_TAG]
}

function snapshotA(tables: Record<string, Row[]>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [t, rows] of Object.entries(tables)) {
    for (const r of rows) if (ownerOf(t, r) === ORG_A || r.id === VICTIM_ID) m.set(`${t}:${String(r.id)}`, JSON.stringify(r))
  }
  return m
}

/** Did this attack read, change or ship anything of company A's? */
export function findings(w: World, responseText: string): Finding[] {
  const out: Finding[] = []
  const hit = (s: string) => LEAK_PATTERNS.find((p) => s.includes(p))
  const leak = hit(responseText)
  if (leak) out.push({ kind: 'leak', detail: `response contains ${leak}: ${excerpt(responseText, leak)}` })
  const after = snapshotA(w.db.tables)
  for (const [k, v] of Array.from(w.before)) {
    const now = after.get(k)
    if (now === undefined) out.push({ kind: 'write', detail: `deleted ${k}` })
    else if (now !== v) out.push({ kind: 'write', detail: `changed ${k}: ${diff(JSON.parse(v), JSON.parse(now))}` })
  }
  for (const wr of w.db.writes) {
    if (wr.op !== 'insert' && wr.op !== 'upsert') continue
    for (const r of wr.rows) {
      if (ownerOf(wr.table, r) === ORG_A) out.push({ kind: 'insert_into_a', detail: `${wr.op} ${wr.table} with company A org_id` })
      // A row with no org_id hangs off its parent: one pointing at A's record lands in A's data (e.g. a payment on A's job).
      else if (!('org_id' in r) && !(OWNER_TAG in r)) {
        const cols = Object.entries(r).filter(([k, v]) => v === VICTIM_ID && k !== 'id').map(([k]) => k)
        if (cols.length) out.push({ kind: 'insert_into_a', detail: `${wr.op} ${wr.table} (no org_id) pointing at A via ${cols.join('/')}` })
      }
    }
  }
  const hitPath = (s: string) => PATH_PATTERNS.find((p) => s.includes(p))
  for (const s of w.storage) {
    const p = hitPath(s.arg) ?? (s.arg.includes(VICTIM_ID) ? VICTIM_ID : undefined)
    if (p) out.push({ kind: 'storage', detail: `storage ${s.bucket}.${s.op}(${s.arg})` })
  }
  for (const a of w.authAdmin) if (a.arg.includes(VICTIM_ID) || hitPath(a.arg)) out.push({ kind: 'auth_admin', detail: `auth.admin.${a.op}(${a.arg})` })
  for (const o of w.outbound) { const p = hit(o); if (p) out.push({ kind: 'exfil', detail: `outbound carries ${p}: ${excerpt(o, p)}` }) }
  return out
}

/** Writes by company B that point at company A's record (B-owned row with a column = VICTIM_ID). Not a read or change
 * of A's data, but a dangling cross-company reference; reported for review, not failed on. */
export function crossReferences(w: World): string[] {
  const out: string[] = []
  for (const wr of w.db.writes) {
    if (wr.op !== 'insert' && wr.op !== 'upsert') continue
    for (const r of wr.rows) {
      if (r.org_id === ORG_A || !('org_id' in r)) continue
      const cols = Object.entries(r).filter(([k, v]) => v === VICTIM_ID && k !== 'id').map(([k]) => k)
      if (cols.length) out.push(`${wr.table}.${cols.join('/')}`)
    }
  }
  return out
}

function excerpt(s: string, p: string) {
  const i = s.indexOf(p)
  return s.slice(Math.max(0, i - 80), i + 60).replace(/\s+/g, ' ')
}

function diff(a: Row, b: Row) {
  return Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}→${JSON.stringify(b[k])}`).join(', ').slice(0, 200)
}

/** `app/api/x/[id]/route.ts` → `/api/x/[id]` */
export function routePathOf(root: string, file: string) {
  return '/' + relative(join(root, 'app'), file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join('/')
}

/**
 * For background jobs that run for EVERY company (crons): did one company's data end up in the other's? A row written
 * for one company that points at the other's record, or an email to one company's people carrying the other's data.
 */
export function crossings(w: World): string[] {
  const out: string[] = []
  for (const wr of w.db.writes) {
    if (wr.op === 'delete') continue
    for (const r of wr.rows ?? []) {
      const org = ownerOf(wr.table, r)
      const foreign = org === ORG_B ? VICTIM_ID : org === ORG_A ? BRAVO_ROW_ID : null
      if (!foreign) continue
      const cols = Object.entries(r).filter(([k, v]) => v === foreign && k !== 'id').map(([k]) => k)
      if (cols.length) out.push(`${wr.op} ${wr.table} for ${org === ORG_A ? 'A' : 'B'} points at the other company via ${cols.join('/')}`)
    }
  }
  for (const o of w.outbound) {
    if (!o.startsWith('mail ')) continue
    let recipients = ''
    try {
      const m = JSON.parse(o.slice(5)) as { to?: unknown; cc?: unknown; bcc?: unknown }
      recipients = JSON.stringify([m.to, m.cc, m.bcc])
    } catch { continue }
    if (/bravo\.test/.test(recipients) && LEAK_PATTERNS.some((p) => o.includes(p))) out.push(`mail to company B carries company A data: ${excerpt(o, 'ALPHA')}`)
    if (/alpha\.test/.test(recipients) && o.includes('Bravo')) out.push(`mail to company A carries company B data: ${excerpt(o, 'Bravo')}`)
  }
  return out
}
