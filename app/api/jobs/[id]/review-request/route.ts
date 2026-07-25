import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  composeReviewMessage,
  generateReviewToken,
  buildTrackedReviewLink,
  isReviewEligibleStatus,
} from '@/lib/review-requests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Base origin used to build the absolute tracked link inside the SMS body. */
function baseUrlFrom(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL
  if (envUrl) return envUrl
  const origin = request.headers.get('origin')
  if (origin) return origin
  const host = request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return host ? `${proto}://${host}` : ''
}

function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/**
 * Prepare / send a post-job review request for a production job.
 *
 * Body: { action?: 'prepare' | 'sent' } (default 'prepare')
 *  - 'prepare' ensures a review_requests row exists (mints token) and returns the
 *    composed message, customer phone, and tracked link to copy / deep-link.
 *  - 'sent' additionally stamps sent_at + sent_by (the actual sender — rep OR ops).
 *
 * Attribution is always the job's salesperson_id, regardless of who sends.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const body = await request.json().catch(() => ({}))
  const action: 'prepare' | 'sent' = body?.action === 'sent' ? 'sent' : 'prepare'

  const { data: job } = await supabase
    .from('production_jobs')
    .select(
      `id, org_id, status, customer_id, salesperson_id,
       customer:customers(name, phone),
       salesperson:users!production_jobs_salesperson_id_fkey(full_name)`
    )
    .eq('id', params.id)
    .maybeSingle()

  if (!job || job.org_id !== profile.org_id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (!isReviewEligibleStatus(job.status)) {
    return NextResponse.json(
      { error: 'This job is not marked complete yet.' },
      { status: 400 }
    )
  }

  const customer = firstOrSelf<{ name: string | null; phone: string | null }>(job.customer as any)
  const salesperson = firstOrSelf<{ full_name: string | null }>(job.salesperson as any)

  const { data: org } = await supabase
    .from('orgs')
    .select('settings')
    .eq('id', job.org_id)
    .maybeSingle()
  const template = (org?.settings as Record<string, unknown> | null)?.review_request_message_template as
    | string
    | undefined

  // Ensure a single review_requests row per job (unique on production_job_id).
  type ReviewRow = { id: string; token: string; sent_at: string | null; sent_by: string | null }

  const { data: existing } = await supabase
    .from('review_requests')
    .select('id, token, sent_at, sent_by')
    .eq('production_job_id', job.id)
    .maybeSingle()

  let row: ReviewRow | null = (existing as ReviewRow | null) ?? null

  if (!row) {
    const token = generateReviewToken()
    const { data: inserted, error: insErr } = await supabase
      .from('review_requests')
      .insert({
        org_id: job.org_id,
        production_job_id: job.id,
        customer_id: job.customer_id,
        salesperson_id: job.salesperson_id,
        token,
        channel: 'manual',
      })
      .select('id, token, sent_at, sent_by')
      .single()

    if (insErr || !inserted) {
      // Likely a concurrent insert hit the unique index; re-read the winner.
      const { data: refetch } = await supabase
        .from('review_requests')
        .select('id, token, sent_at, sent_by')
        .eq('production_job_id', job.id)
        .maybeSingle()
      if (!refetch) {
        return NextResponse.json({ error: 'Could not create review request' }, { status: 500 })
      }
      row = refetch as ReviewRow
    } else {
      row = inserted as ReviewRow
    }
  }

  let sentAt = row!.sent_at
  let sentById = row!.sent_by

  if (action === 'sent' && !row!.sent_at) {
    const nowIso = new Date().toISOString()
    const { data: updated } = await supabase
      .from('review_requests')
      .update({ sent_at: nowIso, sent_by: profile.id, updated_at: nowIso })
      .eq('id', row!.id)
      .is('sent_at', null) // don't clobber an earlier send if there was a race
      .select('sent_at, sent_by')
      .maybeSingle()

    if (updated) {
      sentAt = updated.sent_at
      sentById = updated.sent_by
    } else {
      const { data: r2 } = await supabase
        .from('review_requests')
        .select('sent_at, sent_by')
        .eq('id', row!.id)
        .maybeSingle()
      sentAt = r2?.sent_at ?? sentAt
      sentById = r2?.sent_by ?? sentById
    }
  }

  let sentByName: string | null = null
  if (sentById) {
    if (sentById === profile.id) {
      sentByName = profile.full_name ?? null
    } else {
      const { data: u } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', sentById)
        .maybeSingle()
      sentByName = u?.full_name ?? null
    }
  }

  const link = buildTrackedReviewLink(baseUrlFrom(request), row!.token)
  const message = composeReviewMessage({
    template,
    customerName: customer?.name,
    repName: salesperson?.full_name,
    link,
  })

  return NextResponse.json({
    message,
    phone: customer?.phone ?? null,
    customerName: customer?.name ?? null,
    link,
    sentAt: sentAt ?? null,
    sentByName,
  })
}
