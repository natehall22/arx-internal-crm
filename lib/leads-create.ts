/**
 * THE insert of a lead row from typed details (the New Lead form's POST /api/leads and the AI connector's create_lead
 * both call it). Who may add a lead and who owns it are decided by the caller; this only writes the row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { cleanServiceRequested } from '@/lib/lead-intake'

export type NewLeadInput = {
  homeowner_name?: unknown
  phone?: unknown
  email?: unknown
  address_text?: unknown
  source?: unknown
  channel?: unknown
  status?: unknown
  notes?: unknown
  lat?: unknown
  lng?: unknown
  /** The structured service the lead asked for (leads.service_requested); only written when given. */
  service_requested?: unknown
  /** The work category slug (leads.category), already matched to the company's list by the caller; only written when given. */
  category?: unknown
}

export async function createLeadRecord(admin: SupabaseClient, orgId: string, ownerUserId: string, body: NewLeadInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = cleanServiceRequested(body.service_requested)
  const { data: lead, error } = await admin
    .from('leads')
    .insert({
      org_id: orgId,
      owner_user_id: ownerUserId,
      homeowner_name: body.homeowner_name || null,
      phone: body.phone || null,
      email: body.email || null,
      address_text: body.address_text || null,
      source: body.source || null,
      channel: body.source === 'call_center' ? 'outbound' : body.channel || null,
      status: body.status || 'new',
      notes: body.notes || null,
      lat: body.lat || null,
      lng: body.lng || null,
      ...(service ? { service_requested: service } : {}),
      ...(typeof body.category === 'string' && body.category ? { category: body.category } : {}),
    })
    .select('id')
    .single()
  if (error || !lead) return { ok: false, error: error?.message ?? 'no row' }
  return { ok: true, id: (lead as { id: string }).id }
}
