/**
 * Email the crew run sheet PDF to the subcontractors working the job.
 *
 * GET  -> who it would go to (each active crew's sub that has a scheduling email on file).
 * POST -> { to: string[] } sends it. Every address must be one GET returned: this route can only
 *         reach a job's own subs, never an address somebody typed in.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildJobRunSheet } from '@/lib/job-run-sheet'
import { resolveOpsAccess } from '@/lib/ops-access'
import { generateJobRunSheetPDF } from '@/lib/pdf/job-run-sheet'
import { isValidEmail } from '@/lib/supplier-order-email'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type Recipient = { email: string; name: string }

async function authorize() {
  const { authUser, profile } = await requireAuthApi()
  const admin = createServiceClient()
  const access = await resolveOpsAccess(admin, authUser.id, profile)
  return { profile, admin, access }
}

async function crewRecipients(admin: ReturnType<typeof createServiceClient>, orgId: string, jobId: string): Promise<Recipient[] | null> {
  const { data: job } = await admin.from('production_jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle()
  if (!job) return null
  const { data: orders } = await admin
    .from('work_orders')
    .select('assigned_sub_id')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .eq('work_order_type', 'install')
    .neq('status', 'cancelled')
    .not('assigned_sub_id', 'is', null)
  const subIds = Array.from(new Set((orders ?? []).map((o) => String(o.assigned_sub_id))))
  if (subIds.length === 0) return []
  const { data: subs } = await admin.from('sub_contractors').select('id, company_name, contact_name, scheduling_email').in('id', subIds)
  const seen = new Set<string>()
  const out: Recipient[] = []
  for (const s of subs ?? []) {
    const email = String((s as { scheduling_email?: string | null }).scheduling_email ?? '').trim()
    if (!isValidEmail(email) || seen.has(email.toLowerCase())) continue
    seen.add(email.toLowerCase())
    out.push({ email, name: String(s.company_name || s.contact_name || email) })
  }
  return out
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await authorize()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ctx.access.canJobBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const recipients = await crewRecipients(ctx.admin, ctx.profile.org_id, params.id)
  if (!recipients) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json({ recipients })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await authorize()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ctx.access.canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ error: 'JSON only' }, { status: 415 })
  }
  const body = await request.json().catch(() => ({}))
  const wanted: string[] = Array.isArray(body?.to) ? body.to.map((e: unknown) => String(e).trim().toLowerCase()) : []
  if (wanted.length === 0) return NextResponse.json({ error: 'Pick who to send it to' }, { status: 400 })

  const allowed = await crewRecipients(ctx.admin, ctx.profile.org_id, params.id)
  if (!allowed) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const to = allowed.filter((r) => wanted.includes(r.email.toLowerCase()))
  if (to.length === 0 || to.length !== new Set(wanted).size) {
    return NextResponse.json({ error: 'Those addresses are not on this job' }, { status: 400 })
  }
  if (!process.env.SMTP_HOST) return NextResponse.json({ error: 'Email is not set up on the server' }, { status: 503 })

  const sheet = await buildJobRunSheet(ctx.admin, ctx.profile.org_id, params.id)
  if (!sheet) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const pdf = generateJobRunSheetPDF(sheet)
  const safeJobNumber = sheet.jobNumber.replace(/[^A-Za-z0-9._-]/g, '-')
  const { getMailTransport } = await import('@/lib/setter-email')
  try {
    const info = await getMailTransport().sendMail({
      from: getCrmEmailFrom(),
      to: to.map((r) => r.email),
      replyTo: ctx.profile.email || undefined,
      subject: `Run sheet ${sheet.jobNumber}`,
      text: `The run sheet for job ${sheet.jobNumber} is attached.`,
      attachments: [{ filename: `Run Sheet ${safeJobNumber}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' }],
    })
    const rejected = Array.isArray(info?.rejected) ? info.rejected : []
    if (rejected.length > 0) return NextResponse.json({ error: `The mail server refused: ${rejected.join(', ')}` }, { status: 502 })
  } catch (error) {
    console.error('[Run sheet email] failed:', error)
    return NextResponse.json({ error: 'Could not send the email' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, sentTo: to.map((r) => r.name) })
}
