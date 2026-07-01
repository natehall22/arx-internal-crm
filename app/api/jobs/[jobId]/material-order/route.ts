import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function isMissingOverridesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || (error.message?.includes('job_material_order_overrides') ?? false)
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    let authContext
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createServiceClient()
    const jobId = params.jobId

    const { data: job } = await admin
      .from('production_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', authContext.profile.org_id)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('job_material_order_overrides')
      .select('id, job_id, item_key, qty_text, excluded, note, updated_by, updated_at')
      .eq('job_id', jobId)
      .order('item_key', { ascending: true })

    if (error && !isMissingOverridesTable(error)) {
      console.error('[Material order overrides] GET error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ overrides: data ?? [] })
  } catch (error) {
    console.error('[Material order overrides] GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load overrides' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    let authContext
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const itemKey = typeof body.item_key === 'string' ? body.item_key.trim() : ''
    if (!itemKey) {
      return NextResponse.json({ error: 'item_key is required' }, { status: 400 })
    }

    const admin = createServiceClient()
    const jobId = params.jobId

    const { data: job } = await admin
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', jobId)
      .eq('org_id', authContext.profile.org_id)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = {
      updated_by: authContext.authUser.id,
    }
    if ('qty_text' in body) {
      patch.qty_text =
        body.qty_text == null || String(body.qty_text).trim() === '' ? null : String(body.qty_text).trim()
    }
    if ('excluded' in body) {
      patch.excluded = body.excluded === true
    }
    if ('note' in body) {
      patch.note = body.note == null || String(body.note).trim() === '' ? null : String(body.note).trim()
    }

    const { data: existing } = await admin
      .from('job_material_order_overrides')
      .select('id')
      .eq('job_id', jobId)
      .eq('item_key', itemKey)
      .maybeSingle()

    let result
    if (existing?.id) {
      result = await admin
        .from('job_material_order_overrides')
        .update(patch)
        .eq('id', existing.id)
        .select('id, job_id, item_key, qty_text, excluded, note, updated_by, updated_at')
        .single()
    } else {
      result = await admin
        .from('job_material_order_overrides')
        .insert({
          org_id: job.org_id,
          job_id: jobId,
          item_key: itemKey,
          qty_text: patch.qty_text ?? null,
          excluded: patch.excluded === true,
          note: patch.note ?? null,
          updated_by: authContext.authUser.id,
        })
        .select('id, job_id, item_key, qty_text, excluded, note, updated_by, updated_at')
        .single()
    }

    if (result.error) {
      if (isMissingOverridesTable(result.error)) {
        return NextResponse.json(
          { error: 'Materials order overrides are not available until the latest migration is applied.' },
          { status: 503 }
        )
      }
      console.error('[Material order overrides] PATCH error:', result.error)
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }

    return NextResponse.json({ override: result.data })
  } catch (error) {
    console.error('[Material order overrides] PATCH error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save override' },
      { status: 500 }
    )
  }
}
