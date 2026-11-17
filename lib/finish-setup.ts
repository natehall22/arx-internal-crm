import type { SupabaseClient } from '@supabase/supabase-js'

import { orgLogoPath } from '@/lib/files/files-object'
import { mergeOrgSettings } from '@/lib/org-settings'
import { ORG_BRAND_COLUMNS, resolveOrgBrand, type OrgBrandRow } from '@/lib/org-brand'

export interface FinishSetupItem {
  id: 'logo' | 'pricebook' | 'crew' | 'plan' | 'contact'
  label: string
  done: boolean
  href: string
}

/** Pure: the checklist from the facts. The plan-template row appears only when the company has service plans switched on. */
export function buildFinishSetupItems(facts: {
  hasLogo: boolean
  pricebookItems: number
  crews: number
  planTemplates: number
  hasPhone: boolean
  hasEmail: boolean
  servicePlansOn: boolean
}): FinishSetupItem[] {
  const items: FinishSetupItem[] = [
    { id: 'logo', label: 'Upload your logo', done: facts.hasLogo, href: '/admin/settings' },
    { id: 'pricebook', label: 'Add something to your price book', done: facts.pricebookItems > 0, href: '/admin/pricing' },
    { id: 'crew', label: 'Add a crew', done: facts.crews > 0, href: '/admin/subs' },
  ]
  if (facts.servicePlansOn) items.push({ id: 'plan', label: 'Create a service plan', done: facts.planTemplates > 0, href: '/admin/s/jobs#plan-templates' })
  items.push({ id: 'contact', label: 'Set your company phone and email', done: facts.hasPhone && facts.hasEmail, href: '/admin/settings' })
  return items
}

/**
 * The "Finish setup" checklist for Today, for the owner of a company that is NOT the original one (`orgs.original_brand`).
 * Cheap by design: one org row read, and the three counts only until completion is remembered. Returns null (card hidden) for the original company, when every step is done, or when the company row can't be read
 * (never guess: an unreadable row could be the original company). Org-scoped head counts only.
 */
export async function loadFinishSetup(
  admin: SupabaseClient,
  orgId: string,
  opts: { servicePlansOn: boolean }
): Promise<FinishSetupItem[] | null> {
  const orgRes = await admin.from('orgs').select(`${ORG_BRAND_COLUMNS}, logo_url, settings`).eq('id', orgId).maybeSingle()
  if (orgRes.error || !orgRes.data) return null
  const row = orgRes.data as OrgBrandRow & { logo_url?: string | null; settings?: unknown }
  if (resolveOrgBrand(row).original === true) return null
  // Once every step was done it is remembered (orgs.settings.finishSetupDone): no counts are read again.
  if ((row.settings as { finishSetupDone?: unknown } | null | undefined)?.finishSetupDone === true) return null

  const count = async (table: string, filter: (q: any) => any): Promise<number | null> => {
    const { count: n, error } = await filter(admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId))
    return error ? null : n ?? 0
  }
  const [pricebook, crews, plans] = await Promise.all([
    count('pricebook_items', (q) => q.eq('active', true)),
    // The real crew list is Settings → Subcontractors (`sub_contractors`, incl. "Our own crew"); plans, visits and the time clock all read it. The legacy `crews` table is roofing-only.
    count('sub_contractors', (q) => q.eq('active', true)),
    opts.servicePlansOn ? count('service_plan_templates', (q) => q.eq('active', true)) : Promise.resolve(0),
  ])
  // A failed count must not show a false "not done" nag: treat it as done.
  const items = buildFinishSetupItems({
    hasLogo: !!orgLogoPath(orgId, { logo_url: row.logo_url ?? null, settings: row.settings as never }),
    pricebookItems: pricebook ?? 1,
    crews: crews ?? 1,
    planTemplates: plans ?? 1,
    hasPhone: !!String(row.phone ?? '').trim(),
    hasEmail: !!String(row.email ?? '').trim(),
    servicePlansOn: opts.servicePlansOn,
  })
  if (!items.every((i) => i.done)) return items
  // Remember completion only when every count was actually read (a failed read above is treated as done for display only).
  if (pricebook !== null && crews !== null && plans !== null) {
    const { error } = await mergeOrgSettings(admin, orgId, { finishSetupDone: true })
    if (error) console.error('finish setup: could not remember completion', error)
  }
  return null
}
