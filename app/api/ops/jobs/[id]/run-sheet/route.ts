/**
 * Job run sheet data + ops edits.
 *
 * GET   → the assembled sheet (computed values, overrides, and what will actually print)
 * PATCH → save/clear ops overrides. `null` for a field clears it back to the CRM value.
 *
 * The rendered PDF lives at `./run-sheet/pdf`.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { buildJobRunSheet, RUN_SHEET_FIELD_KEYS, type RunSheetFieldKey } from '@/lib/job-run-sheet'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Keeps one runaway paste from blowing out the sheet (and the row). */
const MAX_FIELD_LENGTH = 4000

async function authorize(request: NextRequest) {
  const { authUser, profile } = await requireAuthApi()
  const admin = createServiceClient()
  const access = await resolveOpsAccess(admin, authUser.id, profile)
  return { profile, admin, access }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await authorize(_request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ctx.access.canJobBoard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sheet = await buildJobRunSheet(ctx.admin, ctx.profile.org_id, params.id)
    if (!sheet) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    return NextResponse.json({ sheet, can_edit: ctx.access.canEditJobs })
  } catch (error) {
    console.error('[Run sheet] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load run sheet' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await authorize(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ctx.access.canJobBoard || !ctx.access.canEditJobs) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Org-scope the job before writing anything.
  const { data: job } = await ctx.admin
    .from('production_jobs')
    .select('id')
    .eq('id', params.id)
    .eq('org_id', ctx.profile.org_id)
    .maybeSingle()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const patch: Partial<Record<RunSheetFieldKey, string | null>> = {}
  for (const key of RUN_SHEET_FIELD_KEYS) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null) {
      patch[key] = null
      continue
    }
    if (typeof raw !== 'string') {
      return NextResponse.json({ error: `${key} must be a string or null` }, { status: 400 })
    }
    if (raw.length > MAX_FIELD_LENGTH) {
      return NextResponse.json(
        { error: `${key} is too long (max ${MAX_FIELD_LENGTH} characters)` },
        { status: 400 }
      )
    }
    // Empty string is how the editor says "reset this field to the CRM value".
    patch[key] = raw.trim() === '' ? null : raw.trim()
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No run sheet fields supplied' }, { status: 400 })
  }

  const { error } = await ctx.admin.from('job_run_sheet_overrides').upsert(
    {
      org_id: ctx.profile.org_id,
      job_id: params.id,
      ...patch,
      updated_by: ctx.profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' }
  )

  if (error) {
    console.error('[Run sheet] PATCH failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const sheet = await buildJobRunSheet(ctx.admin, ctx.profile.org_id, params.id)
  return NextResponse.json({ sheet, can_edit: true })
}
