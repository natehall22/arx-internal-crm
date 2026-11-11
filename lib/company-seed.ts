/**
 * New-company seed (multi-company plan slice 9) — run by scripts/seed-company.ts with the service-role key.
 *
 * Creates or updates ONE org: its `orgs` columns (name, phone, email, address, timezone), `settings.brand` (through
 * saveBrandSettings), the default permission presets (SQL `create_default_permission_presets`, only when the org has
 * none), its trades (lib/org-trades-admin seed plan) and a first owner (role admin + `is_super_admin`).
 *
 * Safe to re-run: every step compares with what is stored and writes only the difference. It only ever touches the org
 * it targets: an existing org is changed only when the input names its id; a new org is refused when another org already
 * has that name; an owner email that belongs to another org stops the run before anything is written.
 * Dry run (the default) reads only and returns the same report with nothing written.
 */
import { randomBytes } from 'crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { brandPatchOps, saveBrandSettings, BRAND_SETTINGS_KEYS, type BrandPatch } from '@/lib/org-brand'
import { cleanTradeLabel, serviceIsTrade } from '@/lib/org-trades'
import { STARTER_TEMPLATES, starterTemplate } from '@/lib/service-plan-starters'
import { cleanTemplateInput, type TemplateInput } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'
import { normalizeSubdomain } from '@/lib/company-host'
import { applyOrgTradesSeed, planOrgTradesSeed, readOrgTradesForSeed, type OrgTradeSeed } from '@/lib/org-trades-admin'

export interface CompanySeedInput {
  org: {
    id: string | null
    name: string
    phone: string
    email: string
    address: string
    timezone: string | null
    /** Company web address label (<subdomain>.<APP_BASE_DOMAIN>), normalized by lib/company-host normalizeSubdomain. null = leave as is. */
    subdomain: string | null
  }
  brand: BrandPatch
  /** null → the standard trades list. */
  trades: OrgTradeSeed[] | null
  owner: { email: string; fullName: string; phone: string | null }
  /** Plan templates to add (by name; an existing template of that name is kept as is). [] = none. */
  servicePlanTemplates: SeedTemplate[]
}

/** A plan template in a seed file: its own fields, or `starter` (lib/service-plan-starters.ts) + `tierPrices` + overrides. */
export type SeedTemplate = Omit<TemplateInput, 'trade'> & { trade: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Pure: validate the JSON input file. Every problem is listed at once. */
export function parseCompanySeedInput(raw: unknown): { ok: true; input: CompanySeedInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const root = obj(raw)
  const org = obj(root.org)
  const owner = obj(root.owner)

  const id = str(org.id)
  if (id && !UUID_RE.test(id)) errors.push('org.id must be a uuid')
  const need = (label: string, v: unknown) => {
    const s = str(v)
    if (!s) errors.push(`${label} is required`)
    return s ?? ''
  }
  const name = need('org.name', org.name)
  const phone = need('org.phone', org.phone)
  const email = need('org.email', org.email)
  const address = need('org.address', org.address)
  if (email && !EMAIL_RE.test(email)) errors.push('org.email is not an email address')
  const timezone = str(org.timezone)
  if (timezone && !validTimeZone(timezone)) errors.push(`org.timezone "${timezone}" is not an IANA time zone`)
  // Same rule as sign-in routing and the orgs_subdomain_format check (lib/company-host.ts normalizeSubdomain).
  const rawSubdomain = org.subdomain
  let subdomain: string | null = null
  if (rawSubdomain !== undefined && rawSubdomain !== null) {
    subdomain = normalizeSubdomain(rawSubdomain)
    if (!subdomain) errors.push('org.subdomain must be one lowercase web-address label (a-z, 0-9, inner hyphens, up to 63) and not a reserved name')
  }

  const brandIn = obj(root.brand)
  const brand: BrandPatch = {}
  for (const key of Object.keys(brandIn)) {
    if (!(BRAND_SETTINGS_KEYS as readonly string[]).includes(key)) errors.push(`brand.${key} is not a brand field (${BRAND_SETTINGS_KEYS.join(', ')})`)
    else if (brandIn[key] !== null && typeof brandIn[key] !== 'string') errors.push(`brand.${key} must be text`)
    else brand[key as keyof BrandPatch] = brandIn[key]
  }

  // Plan templates: data in the seed file (a starter by key + prices, or a full template) — never code.
  const servicePlanTemplates: SeedTemplate[] = []
  if (root.servicePlanTemplates !== undefined && root.servicePlanTemplates !== null) {
    if (!Array.isArray(root.servicePlanTemplates)) errors.push('servicePlanTemplates must be a list')
    else
      root.servicePlanTemplates.forEach((raw, i) => {
        const entry = obj(raw)
        const starter = typeof entry.starter === 'string' ? starterTemplate(entry.starter) : null
        if (typeof entry.starter === 'string' && !starter) return errors.push(`servicePlanTemplates[${i}].starter "${entry.starter}" is not a starter (${STARTER_TEMPLATES.map((t) => t.key).join(', ')})`)
        const prices = obj(entry.tierPrices)
        const { starter: _s, tierPrices: _p, ...overrides } = entry
        const base = starter ? { ...starter, pricing: { ...starter.pricing, tiers: starter.pricing.tiers.map((t) => ({ ...t, price: prices[t.key] ?? t.price })) } } : {}
        const merged = { ...base, ...overrides } as Record<string, unknown>
        const trade = str(merged.trade)
        if (!trade) return errors.push(`servicePlanTemplates[${i}].trade is required (a trade label or slug)`)
        const clean = cleanTemplateInput({ ...merged, trade: 'x' })
        if (!clean.ok) return errors.push(`servicePlanTemplates[${i}]: ${clean.error}`)
        servicePlanTemplates.push({ ...(clean.value as TemplateInput), trade })
      })
  }

  let trades: OrgTradeSeed[] | null = null
  if (root.trades !== undefined && root.trades !== null) {
    if (!Array.isArray(root.trades) || root.trades.length === 0) {
      errors.push('trades must be a non-empty list (leave it out for the standard list)')
    } else {
      trades = []
      const seen = new Set<string>()
      root.trades.forEach((t, i) => {
        const row = obj(t)
        const label = cleanTradeLabel(row.label)
        if (!label) return errors.push(`trades[${i}].label is required (up to 40 characters)`)
        if (seen.has(label.toLowerCase())) return errors.push(`trades[${i}] "${label}" is listed twice`)
        seen.add(label.toLowerCase())
        let matchKeywords: string[] | null = null
        if (row.matchKeywords !== undefined && row.matchKeywords !== null) {
          if (!Array.isArray(row.matchKeywords) || row.matchKeywords.some((k) => typeof k !== 'string' || !k.trim())) {
            return errors.push(`trades[${i}].matchKeywords must be a list of text`)
          }
          for (const k of row.matchKeywords as string[]) {
            try {
              new RegExp(k, 'i')
            } catch {
              errors.push(`trades[${i}].matchKeywords "${k}" is not a valid pattern`)
            }
          }
          matchKeywords = (row.matchKeywords as string[]).map((k) => k.trim())
        }
        trades!.push({ label, matchKeywords })
      })
    }
  }

  const ownerEmail = need('owner.email', owner.email).toLowerCase()
  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) errors.push('owner.email is not an email address')
  const fullName = need('owner.fullName', owner.fullName)

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    input: {
      org: { id, name, phone, email, address, timezone, subdomain },
      brand,
      trades,
      owner: { email: ownerEmail, fullName, phone: str(owner.phone) },
      servicePlanTemplates,
    },
  }
}

export interface CompanySeedOptions {
  apply: boolean
  /** The deployment's DEPLOYMENT_ORG_ID, when set: the run refuses any other org. */
  deploymentOrgId?: string | null
  /** First password for a NEW owner login (else a random one is generated and reported once). Never stored in the input. */
  ownerPassword?: string | null
  /** Allow changing an org that already has jobs, deals or customers (a live company). */
  allowExisting?: boolean
  /** Allow making this owner a super admin when the org already has another one. */
  addOwner?: boolean
}

export interface CompanySeedReport {
  applied: boolean
  orgId: string | null
  lines: string[]
  /** Set only when a new owner login was created with a generated password (apply only). */
  generatedOwnerPassword?: string
}

type OrgRow = { id: string; name: string | null; phone: string | null; email: string | null; address: string | null; timezone?: string | null; subdomain?: string | null; brand?: unknown }
type UserRow = { id: string; org_id: string | null; email: string | null; role: string | null; is_super_admin: boolean | null; active: boolean | null; full_name: string | null }

class SeedStop extends Error {}

async function must<T>(p: PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message ?? error.code ?? 'failed'}`)
  return data
}

async function findAuthUserId(client: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`auth users: ${error.message}`)
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (hit) return hit.id
    if (data.users.length < 1000) return null
  }
  throw new Error('auth users: more than 50,000 logins — look the owner up by hand')
}

/** Run the seed. Dry run unless `apply`. Throws on a refusal or a failed write (writes already made stay; re-run to finish). */
export async function runCompanySeed(client: SupabaseClient, input: CompanySeedInput, opts: CompanySeedOptions): Promise<CompanySeedReport> {
  const lines: string[] = []
  const say = (s: string) => lines.push(`${opts.apply ? '' : '[dry run] '}${s}`)
  const report: CompanySeedReport = { applied: opts.apply, orgId: input.org.id, lines }

  // ---- read phase: every refusal happens here, before anything is written ----
  let org: OrgRow | null = null
  if (input.org.id) {
    org = await must(
      client
        .from('orgs')
        .select(`id, name, phone, email, address, timezone, ${input.org.subdomain ? 'subdomain, ' : ''}brand:settings->brand`)
        .eq('id', input.org.id)
        .maybeSingle(),
      'read org'
    )
    if (!org) throw new SeedStop(`No org with id ${input.org.id}. Leave org.id out to create a new company.`)
  } else {
    const same = await must(client.from('orgs').select('id').ilike('name', input.org.name.replace(/[%_\\]/g, '\\$&')), 'read orgs')
    if ((same ?? []).length) {
      throw new SeedStop(
        `An org named "${input.org.name}" already exists (${(same as { id: string }[]).map((o) => o.id).join(', ')}). ` +
          'If it is this company, put its id in org.id and re-run; nothing was written.'
      )
    }
  }
  if (input.org.subdomain) {
    // Needs migration 202611100070 (orgs.subdomain); before it the read fails here, before anything is written.
    const taken = await must(client.from('orgs').select('id').eq('subdomain', input.org.subdomain), 'read company addresses (is migration 202611100070 applied?)')
    const others = ((taken ?? []) as { id: string }[]).filter((o) => o.id !== org?.id)
    if (others.length) {
      throw new SeedStop(`The web address "${input.org.subdomain}" already belongs to org ${others.map((o) => o.id).join(', ')}; nothing was written.`)
    }
  }
  const deploymentOrgId = opts.deploymentOrgId?.trim() || null
  if (deploymentOrgId && org && org.id !== deploymentOrgId) {
    throw new SeedStop(`This env's DEPLOYMENT_ORG_ID is ${deploymentOrgId}, not ${org.id}; refusing to touch another company's org.`)
  }
  if (deploymentOrgId && !org) {
    throw new SeedStop(`This env's DEPLOYMENT_ORG_ID is ${deploymentOrgId}; a new org can only be created from an env without it.`)
  }

  if (org) {
    const counts: Record<string, number> = {}
    for (const table of ['production_jobs', 'opportunities', 'customers']) {
      const { count, error } = await client.from(table).select('id', { count: 'exact', head: true }).eq('org_id', org.id)
      if (error) throw new Error(`count ${table}: ${error.message ?? 'failed'}`)
      counts[table] = count ?? 0
    }
    const live = Object.values(counts).some((n) => n > 0)
    const summary = Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')
    if (live && !opts.allowExisting) {
      throw new SeedStop(`Org ${org.id} is in use (${summary}). Re-run with --allow-existing only if you mean to change it; nothing was written.`)
    }
    if (live) say(`org ${org.id} is in use (${summary}) — continuing (--allow-existing)`)
  }

  const ownerRows = await must(
    // org-scope-ok: cross-company on purpose — finds the owner's email in ANY company so the seed refuses one that belongs to another org
    client.from('users').select('id, org_id, email, role, is_super_admin, active, full_name').ilike('email', input.owner.email.replace(/[%_\\]/g, '\\$&')),
    'read owner'
  )
  const ownerRow = ((ownerRows ?? []) as UserRow[])[0] ?? null
  if (ownerRow && ownerRow.org_id !== (org?.id ?? null)) {
    throw new SeedStop(`${input.owner.email} already belongs to another org (${ownerRow.org_id}); nothing was written.`)
  }

  if (org) {
    const supers = (await must(
      client.from('users').select('id, email').eq('org_id', org.id).eq('is_super_admin', true),
      'read super admins'
    )) as { id: string; email: string | null }[]
    const others = (supers ?? []).filter((u) => u.id !== ownerRow?.id)
    const becomesSuper = !ownerRow || ownerRow.is_super_admin !== true
    if (becomesSuper && others.length && !opts.addOwner) {
      throw new SeedStop(
        `Org ${org.id} already has a super admin (${others.map((u) => u.email ?? u.id).join(', ')}); ` +
          `re-run with --add-owner to make ${input.owner.email} another one. Nothing was written.`
      )
    }
  }

  // ---- org row ----
  const columns = { name: input.org.name, phone: input.org.phone, email: input.org.email, address: input.org.address }
  const wantColumns: Record<string, string> = {
    ...columns,
    ...(input.org.timezone ? { timezone: input.org.timezone } : {}),
    ...(input.org.subdomain ? { subdomain: input.org.subdomain } : {}),
  }
  let orgId: string
  if (!org) {
    say(`create org "${input.org.name}"`)
    if (!opts.apply) {
      orgId = '(new org)'
    } else {
      const created = await must(client.from('orgs').insert({ ...wantColumns, settings: {} }).select('id').single(), 'create org')
      orgId = (created as { id: string }).id
      say(`org id ${orgId} — put it in org.id for every re-run`)
    }
  } else {
    orgId = org.id
    const diff: Record<string, string> = {}
    for (const [k, v] of Object.entries(wantColumns)) if ((org as Record<string, unknown>)[k] !== v) diff[k] = v
    if (Object.keys(diff).length) {
      say(`update org ${orgId}: ${Object.keys(diff).join(', ')}`)
      if (opts.apply) await must(client.from('orgs').update(diff).eq('id', orgId), 'update org')
    } else say(`org ${orgId}: columns already match`)
  }
  report.orgId = opts.apply || org ? orgId : null

  // ---- settings.brand (the one writer) ----
  const storedBrand = obj(org?.brand)
  const { set, remove } = brandPatchOps(input.brand)
  const brandDiff: BrandPatch = {}
  for (const [k, v] of Object.entries(set)) if (storedBrand[k] !== v) brandDiff[k as keyof BrandPatch] = v
  for (const k of remove) if (k in storedBrand) brandDiff[k] = ''
  if (Object.keys(brandDiff).length) {
    say(`brand: ${Object.keys(brandDiff).map((k) => (brandDiff[k as keyof BrandPatch] === '' ? `clear ${k}` : `set ${k}`)).join(', ')}`)
    if (opts.apply) {
      const { error } = await saveBrandSettings(client, orgId, brandDiff)
      if (error) throw new Error(`brand: ${error}`)
    }
  } else say('brand: already matches')
  if (!set.shortName && !str(storedBrand.shortName)) say('note: no brand.shortName — documents use the company name as the short name')

  // ---- first owner ----
  let ownerId: string | null = ownerRow?.id ?? null
  if (ownerRow) {
    const diff: Record<string, unknown> = {}
    if (ownerRow.role !== 'admin') diff.role = 'admin'
    if (ownerRow.is_super_admin !== true) diff.is_super_admin = true
    if (ownerRow.active === false) diff.active = true
    if (Object.keys(diff).length) {
      say(`owner ${input.owner.email}: set ${Object.keys(diff).join(', ')}`)
      if (opts.apply) await must(client.from('users').update(diff).eq('id', ownerRow.id).eq('org_id', orgId), 'update owner')
    } else say(`owner ${input.owner.email}: already the super admin`)
  } else {
    const authId = await findAuthUserId(client, input.owner.email)
    say(`owner ${input.owner.email}: ${authId ? 'attach existing login' : 'create login'} + profile (admin, super admin)`)
    if (opts.apply) {
      ownerId = authId
      if (!ownerId) {
        const password = opts.ownerPassword?.trim() || randomBytes(12).toString('base64url')
        const created = await client.auth.admin.createUser({
          email: input.owner.email,
          password,
          email_confirm: true,
          user_metadata: { full_name: input.owner.fullName },
        })
        if (created.error || !created.data.user) throw new Error(`create owner login: ${created.error?.message ?? 'failed'}`)
        ownerId = created.data.user.id
        if (!opts.ownerPassword?.trim()) report.generatedOwnerPassword = password
      }
      await must(
        client.from('users').insert({
          id: ownerId,
          email: input.owner.email,
          full_name: input.owner.fullName,
          phone: input.owner.phone,
          role: 'admin',
          is_super_admin: true,
          org_id: orgId,
          active: true,
          canvass_pin_visibility: 'org',
          dashboard_view: 'sales',
        }),
        'create owner profile'
      )
    }
  }

  // ---- permission presets (the SQL function, only for an org that has none) ----
  const presetCount = org
    ? ((await must(client.from('permission_presets').select('id').eq('org_id', orgId).limit(1), 'read presets')) as unknown[]).length
    : 0
  if (presetCount === 0) {
    say('roles: create the default permission presets')
    if (opts.apply) {
      const { error } = await client.rpc('create_default_permission_presets', { p_org_id: orgId, p_created_by: ownerId })
      if (error) throw new Error(`roles: create_default_permission_presets: ${error.message}`)
    }
  } else say('roles: presets already exist')

  // ---- trades (the org_trades writer) ----
  const canRead = opts.apply || org
  const existing = canRead ? await readOrgTradesForSeed(client, orgId) : null
  if (canRead && existing === null) {
    say('trades: WARNING org_trades table missing (migration 202611060030) — the app uses the standard list until it is applied; re-run after')
  } else {
    // a brand-new org (dry run) starts with what the orgs insert trigger seeds: the standard list
    const current = existing ?? planOrgTradesSeed([], null).insert.map((t) => ({ slug: t.slug, label: t.label, sort: t.sort, active: true, matchKeywords: t.match_keywords }))
    const plan = planOrgTradesSeed(current, input.trades)
    const parts = [
      ...plan.insert.map((t) => `add ${t.label} (${t.slug})`),
      ...plan.update.map((u) => `update ${u.slug} (${Object.keys(u.set).join(', ')})`),
      ...plan.deactivate.map((s) => `turn off ${s}`),
    ]
    say(parts.length ? `trades: ${parts.join('; ')}` : 'trades: already match')
    if (opts.apply && parts.length) await applyOrgTradesSeed(client, orgId, ownerId, plan)
  }

  // ---- plan templates (by name; existing ones are never changed — owners edit them in Settings) ----
  if (input.servicePlanTemplates.length) {
    const db = orgDb(client, orgId)
    const have = canRead
      ? await db.from('service_plan_templates').select('name').then((r: { data: Array<{ name: string }> | null; error: { message?: string } | null }) => (r.error ? null : new Set((r.data ?? []).map((x) => x.name.toLowerCase()))))
      : new Set<string>()
    if (have === null) say('plan templates: WARNING table missing (migration 202611110030) — re-run after it is applied')
    else {
      const trades = (canRead ? await readOrgTradesForSeed(client, orgId) : null) ?? []
      for (const t of input.servicePlanTemplates) {
        if (have.has(t.name.toLowerCase())) {
          say(`plan templates: "${t.name}" already exists (kept)`)
          continue
        }
        const trade = trades.find((x) => serviceIsTrade(t.trade, x))
        if (!trade && opts.apply) throw new Error(`plan templates: "${t.name}" — no trade "${t.trade}" in this company`)
        say(`plan templates: add "${t.name}" (${trade?.label ?? t.trade})`)
        if (opts.apply && trade) {
          const { error } = await db.from('service_plan_templates').insert({ ...t, trade: trade.slug, created_by: ownerId, updated_by: ownerId })
          if (error) throw new Error(`plan templates: ${error.message}`)
        }
      }
    }
  }

  return report
}

export { SeedStop }
