/**
 * The customer's selection page (`/s/[token]`, no login, no Nav, the company's brand only). The token is the key and only
 * works on its company's own address (host fence, like the pay page). It shows ONE selection: the item, the allowance, the
 * options with their price and what each costs over/under the allowance. No other job data.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { orgLogoHref } from '@/lib/files/files-object'
import { orgAppUrl } from '@/lib/company-links'
import { getDocumentBrand } from '@/lib/org-brand'
import { orgDb } from '@/lib/supabase/org-db'
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

/** A chosen selection whose change order is still unsigned: the signing link, so the customer can come back and finish. */
export async function pendingSigningUrl(admin: SupabaseClient, sel: ResolvedSelection): Promise<string | null> {
  if (sel.status !== 'chosen' || !sel.change_order_id) return null
  const { data } = await orgDb(admin, sel.org_id).from('job_change_orders').select('status, signing_token, token_expires_at').eq('id', sel.change_order_id).maybeSingle()
  if (!data || data.status === 'completed' || !data.signing_token) return null
  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) return null
  try {
    return `${await orgAppUrl(sel.org_id)}/change-orders/sign/${data.signing_token}`
  } catch {
    return null
  }
}
