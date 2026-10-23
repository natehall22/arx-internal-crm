import { NextResponse } from 'next/server'

import { dealRefOf } from '@/lib/threads/get-thread'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canReadJobNotes, resolveOpsAccess } from '@/lib/ops-access'
import { postMessage } from '@/lib/threads/post-message'
import { notifyMessage } from '@/lib/threads/notify'
import { loadDeal } from '@/lib/threads/get-thread'
import { resolveByReply } from '@/lib/threads/waiting'
import { loadJobNotes } from '@/lib/threads/job-notes'

/**
 * Legacy job-notes endpoint, kept for the old job page and any stale client. Notes now live in the deal's thread
 * (`activities`, audience Production) — this route is a thin adapter over the ONE read path (`getTimeline` rules via
 * canReadMessage) and the ONE write path (`postMessage`). It no longer writes `production_job_notes`.
 */

type LegacyNote = { id: string; note: string; created_at: string; user: { full_name: string | null } | null }

/** The deal (opportunity) a job belongs to: job → project → opportunity. */
async function dealForJob(admin: ReturnType<typeof createServiceClient>, orgId: string, jobId: string) {
  const { data: job } = await admin.from('production_jobs').select('id, org_id, project_id').eq('id', jobId).maybeSingle()
  const j = job as { id: string; org_id: string; project_id: string | null } | null
  if (!j || j.org_id !== orgId) return { job: null, deal: null }
  const { data: project } = j.project_id ? await admin.from('projects').select('opportunity_id').eq('id', j.project_id).eq('org_id', orgId).maybeSingle() : { data: null }
  const oppId = (project as { opportunity_id: string | null } | null)?.opportunity_id
  const deal = oppId ? await loadDeal(admin, orgId, oppId) : null
  return { job: j, deal }
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    let profile
    let authUser
    try {
      ;({ profile, authUser } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const admin = createServiceClient()

    // Same people the job page lets in (it redirects anyone without job-board access).
    if (!canReadJobNotes(await resolveOpsAccess(admin, authUser.id, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { job, deal } = await dealForJob(admin, profile.org_id, params.id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    // Thread messages (Production + Crew) plus any legacy production_job_notes not yet copied into the thread
    // (and the notes the cancel/uncancel functions still write there). Job-board access was checked above.
    const rows = await loadJobNotes(admin, profile.org_id, params.id, { limit: 200 })
    const notes: LegacyNote[] = rows.map((r) => ({ id: r.id, note: r.note, created_at: r.created_at, user: { full_name: r.author_name } }))
    return NextResponse.json({ notes })
  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]/notes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let profile
    let authUser
    try {
      ;({ profile, authUser } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const admin = createServiceClient()

    if (!canReadJobNotes(await resolveOpsAccess(admin, authUser.id, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { job, deal } = await dealForJob(admin, profile.org_id, params.id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!deal) return NextResponse.json({ error: 'This job has no deal to attach the note to' }, { status: 409 })

    const body = await request.json().catch(() => ({}))
    const note = typeof body?.note === 'string' ? body.note : ''
    const res = await postMessage(
      admin,
      profile,
      deal,
      {
        body: note,
        audience: 'production',
        surface: 'job',
        selectedMentionIds: Array.isArray(body?.mentioned_user_ids) ? body.mentioned_user_ids.filter((x: unknown): x is string => typeof x === 'string') : [],
        source: 'web',
      }
    )
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

    if (res.message.reply_to_id) await resolveByReply(admin, profile.id, [res.message.reply_to_id])
    await notifyMessage(admin, {
      orgId: profile.org_id,
      senderId: profile.id,
      senderName: profile.full_name || 'ARX Team',
      message: res.message,
      deal: { id: deal.id, customerId: deal.customer_id, leadId: deal.lead_id, label: deal.address_text || 'Job' },
      recipients: res.recipients,
      blindMentions: res.blindMentions,
    }).catch((e) => console.error('notifyMessage', e))

    return NextResponse.json({ note: { id: res.message.id, note: res.message.body, created_at: res.message.created_at, user: { full_name: profile.full_name } } })
  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/notes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
