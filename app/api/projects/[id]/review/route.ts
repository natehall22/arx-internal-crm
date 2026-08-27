import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  emptyProjectReviewAnswers,
  formatProjectReviewForJobNote,
  mergeOpsNotesBlock,
  type ProjectReviewAnswers,
} from '@/lib/project-review'

const REP_ROLES = new Set(['rep', 'sales_rep', 'closer'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseAnswers(body: unknown): ProjectReviewAnswers | null {
  if (!isRecord(body)) return null
  const a = body.answers
  if (!isRecord(a)) return null
  const base = emptyProjectReviewAnswers()
  for (const key of Object.keys(base) as (keyof ProjectReviewAnswers)[]) {
    const val = a[key]
    if (typeof val === 'string') base[key] = val
  }
  return base
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const admin = createServiceClient()

    const projectId = params.id
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select(
        'id, org_id, owner_user_id, scope_of_work, product_summary, ops_notes, project_review'
      )
      .eq('id', projectId)
      .single()

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const role = String(profile.role || '')
    if (REP_ROLES.has(role) && project.owner_user_id !== profile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const json = await request.json()
    const answers = parseAnswers(json)
    if (!answers) {
      return NextResponse.json({ error: 'Invalid body: expected { answers: { ... } }' }, { status: 400 })
    }

    const hasContent = Object.values(answers).some((s) => typeof s === 'string' && s.trim().length > 0)
    if (!hasContent) {
      return NextResponse.json({ error: 'Fill at least one field' }, { status: 400 })
    }

    const { data: jobRow } = await admin
      .from('production_jobs')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    const now = new Date()
    const stored = {
      answers,
      submittedAt: now.toISOString(),
      submittedByUserId: profile.id,
    }

    const noteBody = formatProjectReviewForJobNote(answers, {
      submitterName: profile.full_name || 'Team member',
      submittedAt: now,
    })

    const newScope = answers.scopeSummary.trim() || project.scope_of_work || null
    const newProduct = answers.materialsAndProducts.trim() || project.product_summary || null
    const opsBlock = mergeOpsNotesBlock(project.ops_notes, noteBody)

    const { error: upErr } = await admin
      .from('projects')
      .update({
        scope_of_work: newScope,
        product_summary: newProduct,
        ops_notes: opsBlock,
        project_review: stored,
      })
      .eq('id', projectId)
      .eq('org_id', profile.org_id)

    if (upErr) {
      console.error('project review update:', upErr)
      return NextResponse.json({ error: 'Failed to save project' }, { status: 500 })
    }

    let jobNoteCreated = false
    if (jobRow?.id) {
      const { error: noteErr } = await admin.from('production_job_notes').insert({
        job_id: jobRow.id,
        user_id: profile.id,
        note: noteBody,
        is_internal: true,
      })
      if (noteErr) {
        console.error('project review job note:', noteErr)
      } else {
        jobNoteCreated = true
      }
    }

    await admin.from('activities').insert({
      org_id: profile.org_id,
      project_id: projectId,
      user_id: profile.id,
      type: 'status_change',
      body: 'Submitted project review (sales → ops handoff).',
    })

    return NextResponse.json({
      ok: true,
      jobNoteCreated,
      jobNoteSkippedReason: jobRow?.id && !jobNoteCreated ? 'Could not add job note (check permissions or retry).' : undefined,
    })
  } catch (e) {
    console.error('POST /api/projects/[id]/review', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
