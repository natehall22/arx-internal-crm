/**
 * The customer's selection page (`/s/[token]`, no login, no Nav, the company's brand only). The token is the key and only
 * works on its company's own address (host fence, like the pay page). It shows ONE selection: the item, the allowance, the
 * options with their price and what each costs over/under the allowance. No other job data.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { orgLogoHref } from '@/lib/files/files-object'
import { getDocumentBrand } from '@/lib/org-brand'
import { readStoredOptions, type SelectionOption } from '@/lib/selections'

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/

export type PublicSelectionView = {
  state: 'open' | 'chosen' | 'unavailable'
  company: { name: string; phone: string; email: string; logoHref: string | null }
  item: string
  allowance: number
  dueDate: string | null
  options: SelectionOption[]
  chosenLabel: string | null
  /** Set once an over-allowance pick became a change order that still needs the customer's signature. */
  signingUrl: string | null
}

export type ResolvedSelection = { id: string; org_id: string; job_id: string; item: string; allowance: number; options: SelectionOption[]; due_date: string | null; status: string; chosen_label: string | null; change_order_id: string | null }

/** The live selection for this link on this address, else null (bad/expired/cancelled link, or another company's address). */
export async function resolveSelectionLink(admin: SupabaseClient, token: unknown): Promise<ResolvedSelection | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  // org-scope-ok: the link token IS the key (unique, unguessable); everything after reads by this row's own org.
  const { data } = await admin.from('job_selections').select('id, org_id, job_id, item, allowance, options, due_date, status, chosen_label, change_order_id, token_expires_at').eq('link_token', token).maybeSingle()
  if (!data || data.status === 'cancelled' || data.status === 'draft') return null
  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) return null
  if (!fenceAllowsOrg(await getRequestHostFence(), data.org_id)) return null
  return { id: data.id, org_id: data.org_id, job_id: data.job_id, item: data.item, allowance: Number(data.allowance), options: readStoredOptions(data.options), due_date: data.due_date, status: data.status, chosen_label: data.chosen_label, change_order_id: data.change_order_id }
}

export async function loadPublicSelectionView(admin: SupabaseClient, sel: ResolvedSelection, signingUrl: string | null = null): Promise<PublicSelectionView> {
  const brand = await getDocumentBrand(admin, sel.org_id)
  const { data: org } = await admin.from('orgs').select('logo_url, settings').eq('id', sel.org_id).maybeSingle()
  return {
    state: sel.status === 'chosen' ? 'chosen' : 'open',
    company: { name: brand.casualName || brand.name, phone: brand.phone, email: brand.email, logoHref: orgLogoHref(sel.org_id, (org ?? {}) as Parameters<typeof orgLogoHref>[1]) },
    item: sel.item,
    allowance: sel.allowance,
    dueDate: sel.due_date,
    options: sel.options,
    chosenLabel: sel.chosen_label,
    signingUrl,
  }
}
