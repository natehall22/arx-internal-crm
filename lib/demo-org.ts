/**
 * The demo company (server only) — the ONE place that knows what "demo" means. `orgs.is_demo` (migration 202611180010) is
 * set only by the server (seed script) and read here. A demo company is a fictional one used to show prospects the CRM:
 *  - nothing leaves it: customer emails / texts go through the normal send pipeline and are LOGGED ONLY (`demoSuppressedChannel`);
 *    any other mail to a reserved example address is dropped at the mail door (`isReservedMailDomain`);
 *  - nothing real can be connected: QuickBooks, a real texting number and a LIVE Stripe key are refused (`demoRefusal`);
 *  - AI changes and QuickBooks cannot be switched on (`DEMO_LOCKED_FEATURES`);
 *  - it is the only kind of company `seed:company --demo --reset` may wipe.
 * The column may not exist yet (migration not applied): every reader treats a missing column as "not a demo".
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { OrgFeature } from '@/lib/org-features'
import { isMissingColumn } from '@/lib/supabase/errors'

/** Switches a demo company can never turn on (real money / real books / AI writing to the CRM). */
export const DEMO_LOCKED_FEATURES: readonly OrgFeature[] = Object.freeze(['quickbooks', 'aiConnectorWrites'] as OrgFeature[])

export function demoLockedFeatureIn(set: Partial<Record<string, boolean>>): OrgFeature | null {
  for (const k of DEMO_LOCKED_FEATURES) if (set[k] === true) return k
  return null
}

const CACHE_MS = 60_000
const cache = new Map<string, { at: number; demo: boolean }>()

/** Test hook: forget what was read. */
export function clearDemoOrgCache(): void {
  cache.clear()
}

/**
 * Is this company a demo? Cached 60 s per company. Never throws: a read error or a missing column is "not a demo" (the
 * flag only ever ADDS restrictions; the destructive reset re-reads it itself, uncached, in `assertDemoOrg`).
 */
export async function isDemoOrg(admin: SupabaseClient, orgId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!orgId) return false
  const hit = cache.get(orgId)
  if (hit && now - hit.at < CACHE_MS) return hit.demo
  try {
    const { data, error } = await admin.from('orgs').select('is_demo').eq('id', orgId).maybeSingle()
    if (error) {
      if (!isMissingColumn(error, 'is_demo')) console.error('[demo-org] could not read is_demo', { orgId, error: error.message })
      cache.set(orgId, { at: now, demo: false })
      return false
    }
    const demo = (data as { is_demo?: boolean } | null)?.is_demo === true
    cache.set(orgId, { at: now, demo })
    return demo
  } catch (e) {
    console.error('[demo-org] is_demo read failed', e)
    return false
  }
}

/** Uncached, fail-closed read for destructive code: throws unless the company is a demo. */
export async function assertDemoOrg(admin: SupabaseClient, orgId: string): Promise<void> {
  const { data, error } = await admin.from('orgs').select('id, is_demo').eq('id', orgId).maybeSingle()
  if (error) throw new Error(`could not check the demo flag (is migration 202611180010 applied?): ${error.message}`)
  if (!data) throw new Error(`no company ${orgId}`)
  if ((data as { is_demo?: boolean }).is_demo !== true) throw new Error(`company ${orgId} is not a demo company: refusing`)
}

export type DemoRefusal = 'quickbooks' | 'texting_number' | 'stripe_live' | 'ai_writes'

const REFUSAL_TEXT: Record<DemoRefusal, string> = {
  quickbooks: 'This is a demo company: it cannot be connected to QuickBooks.',
  texting_number: 'This is a demo company: it cannot use a real texting number (texts are only logged here).',
  stripe_live: 'This is a demo company: online payments work in Stripe test mode only.',
  ai_writes: 'This is a demo company: AI apps can look things up but cannot make changes.',
}

export const demoRefusalText = (what: DemoRefusal): string => REFUSAL_TEXT[what]

/**
 * The demo address space: `demo.example.com` (example.com can never receive mail, RFC 2606). Demo data uses only these, and
 * the mail door drops anything addressed only to them — so a demo can never email a real person by accident.
 */
export function isReservedMailDomain(address: string | null | undefined): boolean {
  const at = String(address ?? '').trim().toLowerCase().replace(/^.*</, '').replace(/>.*$/, '')
  const domain = at.split('@')[1] ?? ''
  if (!domain) return false
  return /(^|\.)demo\.example\.com$/.test(domain)
}

/** Pure: every recipient of a nodemailer `to`/`cc`/`bcc` value is a reserved example address (and there is at least one). */
export function allRecipientsReserved(...fields: unknown[]): boolean {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (!v) return
    if (typeof v === 'string') out.push(...v.split(','))
    else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'object' && typeof (v as { address?: unknown }).address === 'string') out.push((v as { address: string }).address)
  }
  fields.forEach(walk)
  const clean = out.map((s) => s.trim()).filter(Boolean)
  return clean.length > 0 && clean.every(isReservedMailDomain)
}

/**
 * Wrap a mail transport so mail addressed ONLY to reserved example addresses is logged and dropped (never handed to the
 * mail server). Everything else passes through untouched. Demo companies use only such addresses.
 */
export function guardReservedRecipients<T extends { sendMail: (...args: any[]) => any }>(transport: T): T {
  if (!transport || typeof transport.sendMail !== 'function') return transport
  return new Proxy(transport, {
    get(target, prop, receiver) {
      if (prop !== 'sendMail') return Reflect.get(target, prop, receiver)
      return (message: Record<string, unknown>, ...rest: unknown[]) => {
        if (message && allRecipientsReserved(message.to, message.cc, message.bcc)) {
          console.info('[demo] mail to a reserved example address was not sent', { to: message.to, subject: message.subject })
          return Promise.resolve({ messageId: `demo-suppressed`, accepted: [], rejected: [], response: 'suppressed (reserved example address)' })
        }
        return target.sendMail(message, ...rest)
      }
    },
  })
}
