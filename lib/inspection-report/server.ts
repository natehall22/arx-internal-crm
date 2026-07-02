import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@/lib/types/database'
import { REPORT_BUCKET, ReportPhotoMeta, seedReportDoc } from './types'

const REP_LIKE_ROLES = ['rep', 'sales_rep', 'closer'] as const

type OpportunityAccessFields = {
  owner_user_id: string | null
  setter_user_id: string | null
  leads?: { closer_user_id?: string | null } | { closer_user_id?: string | null }[] | null
}

function closerUserIdFromLead(leads: OpportunityAccessFields['leads']): string | null {
  if (!leads) return null
  const leadRow = Array.isArray(leads) ? leads[0] : leads
  return leadRow?.closer_user_id ?? null
}

/** Field reps/closers may only touch reports for opportunities they're assigned to. */
export function repCanAccessOpportunity(
  profile: Pick<User, 'id' | 'role'>,
  opp: Pick<OpportunityAccessFields, 'owner_user_id' | 'setter_user_id'> & {
    closerUserIdFromLead?: string | null
  }
): boolean {
  if (!REP_LIKE_ROLES.includes(profile.role as (typeof REP_LIKE_ROLES)[number])) {
    return true
  }
  const isOwner = opp.owner_user_id === profile.id
  const isSetter = opp.setter_user_id === profile.id
  const isLeadCloser = opp.closerUserIdFromLead === profile.id
  return isOwner || isSetter || isLeadCloser
}

export async function assertRepCanAccessOpportunity(
  admin: SupabaseClient,
  profile: Pick<User, 'id' | 'role' | 'org_id'>,
  opportunityId: string
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  const { data: opp } = await admin
    .from('opportunities')
    .select('id, owner_user_id, setter_user_id, leads(closer_user_id)')
    .eq('id', opportunityId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!opp) return { ok: false, status: 404 }
  if (
    !repCanAccessOpportunity(profile, {
      ...opp,
      closerUserIdFromLead: closerUserIdFromLead(opp.leads),
    })
  ) {
    return { ok: false, status: 403 }
  }
  return { ok: true }
}

export async function assertRepCanAccessReport(
  admin: SupabaseClient,
  profile: Pick<User, 'id' | 'role' | 'org_id'>,
  report: Pick<ReportRow, 'opportunity_id'>
): Promise<{ ok: true } | { ok: false; status: 403 | 404 }> {
  return assertRepCanAccessOpportunity(admin, profile, report.opportunity_id)
}

export function opportunityAccessResponse(
  result: { ok: false; status: 403 | 404 }
): NextResponse {
  return NextResponse.json(
    { error: result.status === 403 ? 'Forbidden' : 'Not found' },
    { status: result.status }
  )
}

/** requireAuthApi() throws — map its errors to 401 instead of a generic 500. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof Error && (err.message === 'Unauthorized' || err.message === 'Account disabled')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export const MAX_REPORT_PHOTOS = 300
export const PHOTO_SIGNED_URL_TTL = 60 * 60 * 24 // 24h — builder sessions are same-day

export interface ReportRow {
  id: string
  org_id: string
  opportunity_id: string
  created_by_user_id: string | null
  doc: unknown
  status: 'draft' | 'ready' | 'sent'
  share_token: string
  pdf_storage_path: string | null
  pdf_size_bytes: number | null
  pdf_photo_count: number | null
  pdf_generated_at: string | null
  last_sent_to: string | null
  last_sent_at: string | null
  created_at: string
  updated_at: string
  doc_updated_at: string | null
}

const REPORT_COLUMNS =
  'id, org_id, opportunity_id, created_by_user_id, doc, status, share_token, pdf_storage_path, pdf_size_bytes, pdf_photo_count, pdf_generated_at, last_sent_to, last_sent_at, created_at, updated_at, doc_updated_at'

export async function fetchReportForOrg(
  admin: SupabaseClient,
  reportId: string,
  orgId: string
): Promise<ReportRow | null> {
  const { data } = await admin
    .from('inspection_reports')
    .select(REPORT_COLUMNS)
    .eq('id', reportId)
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as ReportRow | null) ?? null
}

export async function fetchReportPhotos(
  admin: SupabaseClient,
  reportId: string,
  orgId: string
): Promise<ReportPhotoMeta[]> {
  const { data } = await admin
    .from('inspection_report_photos')
    .select('id, storage_path, width, height, created_at')
    .eq('report_id', reportId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
  return (data as ReportPhotoMeta[] | null) ?? []
}

export async function attachSignedUrls(
  admin: SupabaseClient,
  photos: ReportPhotoMeta[]
): Promise<ReportPhotoMeta[]> {
  if (!photos.length) return photos
  const { data: signed } = await admin.storage
    .from(REPORT_BUCKET)
    .createSignedUrls(photos.map((p) => p.storage_path), PHOTO_SIGNED_URL_TTL)
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
  return photos.map((p) => ({ ...p, url: byPath.get(p.storage_path) ?? null }))
}

/**
 * Latest report for the opportunity, or a fresh draft seeded from CRM data.
 * One-tap desire path: the rep never fills in what the CRM already knows.
 */
export async function getOrCreateReport(
  admin: SupabaseClient,
  params: { opportunityId: string; profile: Pick<User, 'id' | 'role' | 'org_id'> }
): Promise<{ report: ReportRow; created: boolean } | { error: string; status: number }> {
  const { opportunityId, profile } = params
  const orgId = profile.org_id
  const userId = profile.id

  const { data: opp } = await admin
    .from('opportunities')
    .select('id, org_id, address_text, customer_id, lead_id, owner_user_id, setter_user_id, leads(closer_user_id)')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!opp) return { error: 'Opportunity not found', status: 404 }
  if (
    !repCanAccessOpportunity(profile, {
      owner_user_id: opp.owner_user_id,
      setter_user_id: opp.setter_user_id,
      closerUserIdFromLead: closerUserIdFromLead(opp.leads),
    })
  ) {
    return { error: 'Forbidden', status: 403 }
  }

  const { data: existing } = await admin
    .from('inspection_reports')
    .select(REPORT_COLUMNS)
    .eq('opportunity_id', opportunityId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return { report: existing as ReportRow, created: false }

  // Prefill owner name (customer, else lead homeowner) + rep name
  let ownerName = ''
  if (opp.customer_id) {
    const { data: cust } = await admin
      .from('customers')
      .select('name')
      .eq('id', opp.customer_id)
      .maybeSingle()
    ownerName = cust?.name || ''
  }
  if (!ownerName && opp.lead_id) {
    const { data: lead } = await admin
      .from('leads')
      .select('homeowner_name')
      .eq('id', opp.lead_id)
      .maybeSingle()
    ownerName = lead?.homeowner_name || ''
  }
  const { data: me } = await admin.from('users').select('full_name').eq('id', userId).maybeSingle()

  const doc = seedReportDoc({
    ownerName,
    address: opp.address_text || '',
    preparedBy: me?.full_name ? `${me.full_name}, ARX Roofing & Exteriors` : 'ARX Roofing & Exteriors',
  })

  const { data: createdRow, error } = await admin
    .from('inspection_reports')
    .insert({
      org_id: orgId,
      opportunity_id: opportunityId,
      created_by_user_id: userId,
      doc,
    })
    .select(REPORT_COLUMNS)
    .single()
  if (error) {
    // Unique index on opportunity_id: another device won the create race — use theirs.
    if (error.code === '23505') {
      const { data: raced } = await admin
        .from('inspection_reports')
        .select(REPORT_COLUMNS)
        .eq('opportunity_id', opportunityId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (raced) return { report: raced as ReportRow, created: false }
    }
    return { error: 'Failed to create report', status: 500 }
  }
  if (!createdRow) return { error: 'Failed to create report', status: 500 }
  return { report: createdRow as ReportRow, created: true }
}
