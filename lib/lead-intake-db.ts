/**
 * Lead intake — server side: the turn pointer and the owner-resolution used by the website webhook.
 * Rules and parsing live in lib/lead-intake.ts.
 */
import { createHash } from 'crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { DEFAULT_FORM_DAILY_CAP, LEAD_FORM_RATE_LIMIT, LEAD_FORM_RATE_WINDOW_MS, normalizeService, readLeadIntakeSettings, readRouting, readServiceOptions, routeLeadCandidates, type LeadRouting } from '@/lib/lead-intake'
import { resolveCompanyRecipient, type CompanyRecipient } from '@/lib/company-recipient'
import { consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'

/**
 * Whose turn is it? One SQL call (`lead_routing_next`, migration 202611230020) locks the pointer row, picks the next ACTIVE
 * person of this company after the last one handed a lead, and stores it — so two leads arriving together never share a
 * turn. Returns null when nobody in the list can take a lead, or when the function isn't there yet (migration not applied):
 * the caller then uses the fallback, so a lead is never dropped.
 */
export async function nextInRotation(admin: SupabaseClient, orgId: string, scope: string, userIds: string[]): Promise<string | null> {
  const { data, error } = await admin.rpc('lead_routing_next', { p_org_id: orgId, p_scope: scope, p_user_ids: userIds })
  if (error) {
    console.error('lead routing: turn lookup failed, using the fallback owner', { orgId, scope, message: error.message })
    return null
  }
  return typeof data === 'string' ? data : null
}

export type LeadSourceRoutingFields = { id: string; auto_assign_user_id?: string | null; routing?: unknown } | null

/**
 * The owner of a new website lead: the routing (the source's own override, else the company's) picks who, then
 * resolveCompanyRecipient keeps the first candidate that is an active user of THIS company and ends on the company's
 * oldest active admin. In `person` mode the candidates are exactly the old ones (source person, company lead owner).
 */
export async function resolveLeadOwner(
  admin: SupabaseClient,
  orgId: string,
  orgSettings: unknown,
  source: LeadSourceRoutingFields,
  service: string | null,
  /** A lead typed in by hand: when the routing matches nobody, THIS person (the typist) keeps it — not the company lead owner or an admin. */
  typedBy?: string
): Promise<CompanyRecipient | null> {
  const company = readLeadIntakeSettings(orgSettings).routing
  const override: LeadRouting | null = source ? readRouting(source.routing) : null
  const settings = orgSettings && typeof orgSettings === 'object' ? (orgSettings as Record<string, unknown>) : {}
  const candidates = await routeLeadCandidates(
    {
      routing: override ?? company,
      scopeBase: override && source ? `source:${source.id}` : 'org',
      service,
      sourceUserId: typedBy ?? source?.auto_assign_user_id,
      fallbackUserId: typedBy ? null : typeof settings.web_leads_owner_id === 'string' ? settings.web_leads_owner_id : null,
    },
    (scope, ids) => nextInRotation(admin, orgId, scope, ids)
  )
  return resolveCompanyRecipient(admin, orgId, candidates, 'web_lead')
}

/** The service choices a company offers: every lead source's list, merged (the New Lead form and the routing screen use it). */
export async function loadCompanyServiceChoices(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await admin.from('lead_sources').select('service_options').eq('org_id', orgId)
  if (error) return [] // column not there yet (migration not applied): no choices
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of (data ?? []) as Array<{ service_options?: unknown }>) {
    for (const s of readServiceOptions(row.service_options)) {
      const key = normalizeService(s)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(s)
      }
    }
  }
  return out
}

/** The ONE new-lead bell: whoever now owns the lead is told (website webhook and the New Lead form both use it). */
export async function insertNewLeadBell(
  admin: SupabaseClient,
  input: { orgId: string; userId: string; leadId: string; title: string; body: string }
): Promise<{ error: string | null }> {
  const { error } = await admin.from('notifications').insert({
    org_id: input.orgId,
    recipient_user_id: input.userId,
    type: 'new_lead',
    title: input.title,
    body: input.body,
    link_url: `/leads/${input.leadId}`,
    data: { lead_id: input.leadId },
  })
  return { error: error?.message ?? null }
}

/**
 * May this visitor post to this public website form? Counted in the database (portal_take_attempt, the shared atomic
 * counter from migration 202611120060) so every server instance sees the same number: per source + visitor address
 * (hashed, never stored raw) per window, plus one per-source daily cap the company can set. Fails over to the in-memory
 * limiter if the database function is unavailable, so a lead form never goes down because of its own spam guard.
 */
export async function takeLeadFormAttempt(
  admin: SupabaseClient,
  input: { sourceId: string; ip: string; dailyCap: number | null | undefined; now?: number }
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const ipHash = createHash('sha256').update(`${input.sourceId}|${input.ip}`).digest('hex').slice(0, 32)
  const windowSec = Math.round(LEAD_FORM_RATE_WINDOW_MS / 1000)
  const cap = input.dailyCap && input.dailyCap > 0 ? input.dailyCap : DEFAULT_FORM_DAILY_CAP
  const tries: Array<{ key: string; limit: number; seconds: number }> = [
    { key: `leadform:${input.sourceId}:${ipHash}`, limit: LEAD_FORM_RATE_LIMIT, seconds: windowSec },
    { key: `leadform-day:${input.sourceId}`, limit: cap, seconds: 86_400 },
  ]
  for (const t of tries) {
    const { data, error } = await admin.rpc('portal_take_attempt', { p_key: t.key, p_limit: t.limit, p_window_seconds: t.seconds })
    if (error) {
      console.error('lead form rate limit: database counter unavailable, using the in-memory one', error.message)
      const mem = consumePublicEstimateRateLimit({ key: t.key, limit: t.limit, windowMs: t.seconds * 1000, now: input.now })
      if (!mem.ok) return { ok: false, retryAfterSec: mem.retryAfterSec }
      continue
    }
    if (data === false) return { ok: false, retryAfterSec: t.seconds }
  }
  return { ok: true }
}
