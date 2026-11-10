/** @jest-environment node */
/**
 * scripts/org-scope-check.mjs is the gate that keeps company-table queries company-scoped on the shared database.
 * These fixtures pin each rule (top of the script): what must be flagged, and what is accepted and why.
 * A rule that silently stops flagging is the dangerous direction, so most cases here are "must flag".
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const SCRIPT = path.join(process.cwd(), 'scripts/org-scope-check.mjs')

function findings(source: string, file = 'app/api/x/route.ts'): Array<{ line: number; table: string; op: string }> {
  const code = `
    import { analyzeFile } from ${JSON.stringify(SCRIPT)}
    const tables = new Set(['leads', 'customers', 'scheduled_appointments', 'users', 'thread_members', 'production_jobs', 'job_files'])
    const out = analyzeFile(process.env.F, process.env.SRC, tables).map((f) => ({ line: f.line, table: f.table, op: f.op }))
    process.stdout.write(JSON.stringify(out))
  `
  const out = execFileSync('node', ['--input-type=module', '-e', code], {
    env: { ...process.env, SRC: source, F: file },
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

const head = `import { createServiceClient } from '@/lib/supabase/service'\nimport { requireAuthApi } from '@/lib/auth'\n`

describe('flags (must never pass)', () => {
  test('select by a URL id with no company filter', () => {
    const f = findings(head + `export async function GET(_r, { params }) {
      const admin = createServiceClient()
      const { data } = await admin.from('leads').select('*').eq('id', params.id).single()
      return data
    }`)
    expect(f).toEqual([{ line: 5, table: 'leads', op: 'select' }])
  })

  test('update / delete by a body id', () => {
    const f = findings(head + `export async function POST(req) {
      const admin = createServiceClient()
      const body = await req.json()
      await admin.from('customers').update({ name: 'x' }).eq('id', body.id)
      await admin.from('customers').delete().eq('id', body.id)
    }`)
    expect(f.map((x) => x.op)).toEqual(['update', 'delete'])
  })

  test('a helper filtering by its own parameter is flagged (callers are not traced)', () => {
    const f = findings(head + `export async function load(admin, jobId) {
      return admin.from('production_jobs').select('id').eq('id', jobId).maybeSingle()
    }`)
    expect(f).toHaveLength(1)
  })

  test("upsert keyed on a foreign-able id (no org in onConflict, key not checked) is flagged", () => {
    const f = findings(head + `export async function POST(req, { params }) {
      const { profile } = await requireAuthApi()
      const admin = createServiceClient()
      await admin.from('job_files').upsert({ org_id: profile.org_id, job_id: params.id }, { onConflict: 'job_id' })
    }`)
    expect(f).toEqual([{ line: 6, table: 'job_files', op: 'upsert' }])
  })

  test('a load whose org check can be skipped (&&) is still flagged', () => {
    const f = findings(head + `export async function GET(_r, { params }) {
      const { profile } = await requireAuthApi()
      const admin = createServiceClient()
      const { data: job } = await admin.from('production_jobs').select('id, org_id').eq('id', params.id).maybeSingle()
      if (job.org_id !== profile.org_id && !profile.is_super_admin) return null
      return job
    }`)
    expect(f).toHaveLength(1)
  })

  test('a load used BEFORE its org check is still flagged', () => {
    const f = findings(head + `export async function GET(_r, { params }) {
      const { profile } = await requireAuthApi()
      const admin = createServiceClient()
      const { data: job } = await admin.from('production_jobs').select('id, org_id').eq('id', params.id).maybeSingle()
      console.log(job)
      if (!job || job.org_id !== profile.org_id) return null
      return job
    }`)
    expect(f).toHaveLength(1)
  })

  test('an earlier scoped load that does not bail on "not found" does not vouch for the id', () => {
    const f = findings(head + `export async function POST(_r, { params }) {
      const { profile } = await requireAuthApi()
      const admin = createServiceClient()
      const { data: appt } = await admin.from('scheduled_appointments').select('id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
      await admin.from('scheduled_appointments').update({ status: 'x' }).eq('id', params.id)
    }`)
    expect(f).toEqual([{ line: 7, table: 'scheduled_appointments', op: 'update' }])
  })

  test('an allow comment with no reason does not count', () => {
    const f = findings(head + `export async function GET(_r, { params }) {
      const admin = createServiceClient()
      // org-scope-ok:
      return admin.from('leads').select('*').eq('id', params.id)
    }`)
    expect(f).toHaveLength(1)
  })

  test('storage.from(...) and non-company tables are ignored; company tables are not', () => {
    const f = findings(head + `export async function GET() {
      const admin = createServiceClient()
      await admin.storage.from('leads').download('x')
      await admin.from('orgs').select('*')
      return admin.from('leads').select('*')
    }`)
    expect(f).toEqual([{ line: 7, table: 'leads', op: 'select' }])
  })
})

describe('accepts', () => {
  test("rule 1: .eq('org_id', …) anywhere in the chain, or later on the builder variable", () => {
    expect(
      findings(head + `export async function GET(_r, { params }) {
        const { profile } = await requireAuthApi()
        const admin = createServiceClient()
        await admin.from('leads').select('*').eq('id', params.id).eq('org_id', profile.org_id)
        let q = admin.from('customers').select('*').eq('id', params.id)
        if (params.x) q = q.limit(1)
        q = q.eq('org_id', profile.org_id)
        await q
        await admin.from('leads').select('*').match({ org_id: profile.org_id, id: params.id })
      }`)
    ).toEqual([])
  })

  test('rule 2: orgDb(client, orgId).from(…)', () => {
    expect(
      findings(head + `import { orgDb } from '@/lib/supabase/org-db'
      export async function GET(_r, { params }) {
        const { profile } = await requireAuthApi()
        const db = orgDb(createServiceClient(), profile.org_id)
        await db.from('leads').select('*').eq('id', params.id)
        await orgDb(createServiceClient(), profile.org_id).from('customers').delete().eq('id', params.id)
      }`)
    ).toEqual([])
  })

  test('rule 3: filter by a row loaded company-scoped, or by the signed-in user', () => {
    expect(
      findings(head + `export async function GET(_r, { params }) {
        const { profile } = await requireAuthApi()
        const admin = createServiceClient()
        const { data: lead } = await admin.from('leads').select('id, customer_id').eq('id', params.id).eq('org_id', profile.org_id).single()
        await admin.from('customers').select('*').eq('id', lead.customer_id)
        await admin.from('users').select('*').eq('id', profile.id)
      }`)
    ).toEqual([])
  })

  test('rule 3b: same id after a scoped load that bails when empty', () => {
    expect(
      findings(head + `export async function POST(_r, { params }) {
        const { profile } = await requireAuthApi()
        const admin = createServiceClient()
        const { data: appt } = await admin.from('scheduled_appointments').select('id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
        if (!appt) return 404
        await admin.from('scheduled_appointments').update({ status: 'x' }).eq('id', params.id)
      }`)
    ).toEqual([])
  })

  test('rule 3c: load by id, then the company check first thing', () => {
    expect(
      findings(head + `export async function GET(_r, { params }) {
        const { profile } = await requireAuthApi()
        const admin = createServiceClient()
        const { data: job } = await admin.from('production_jobs').select('id, org_id').eq('id', params.id).maybeSingle()
        if (!job || job.org_id !== profile.org_id) return null
        return job
      }`)
    ).toEqual([])
  })

  test('rule 4 + upsert keyed on a checked row', () => {
    expect(
      findings(head + `export async function POST(_r, { params }) {
        const { profile } = await requireAuthApi()
        const admin = createServiceClient()
        await admin.from('leads').insert({ org_id: profile.org_id, x: 1 })
        const { data: job } = await admin.from('production_jobs').select('id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
        if (!job) return 404
        await admin.from('job_files').upsert({ org_id: profile.org_id, job_id: params.id, kind: 'p' }, { onConflict: 'job_id,kind' })
        await admin.from('thread_members').upsert({ org_id: profile.org_id, x: params.x }, { onConflict: 'org_id,x' })
      }`)
    ).toEqual([])
  })

  test('rule 5: a reasoned allow comment above the statement', () => {
    expect(
      findings(head + `export async function GET() {
        const admin = createServiceClient()
        // org-scope-ok: nightly cron works every company on purpose
        const { data } = await admin
          .from('leads')
          .select('id')
        return data
      }`)
    ).toEqual([])
  })

  test('rule 6: secret token lookups', () => {
    expect(
      findings(head + `export async function GET(_r, { params }) {
        const admin = createServiceClient()
        const { data: c } = await admin.from('customers').select('id').eq('signing_token', params.token).single()
        return c
      }`)
    ).toEqual([])
  })

  test("user-token (RLS) clients and 'use client' files are not checked", () => {
    expect(
      findings(`import { createClient } from '@/lib/supabase/server'
      export async function GET(_r, { params }) {
        const supabase = createClient()
        return supabase.from('leads').select('*').eq('id', params.id)
      }`)
    ).toEqual([])
    expect(findings(`'use client'\nexport function A({ supabase, id }) { return supabase.from('leads').select('*').eq('id', id) }`)).toEqual([])
  })
})
