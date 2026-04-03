import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

const COST_TYPES = ['material', 'labor', 'permit', 'subcontractor', 'misc', 'other'] as const

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const jobId = params.id

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const description = String(body.description || '').trim()
    const costType = (COST_TYPES as readonly string[]).includes(body.cost_type)
      ? body.cost_type
      : 'other'
    const amountRaw = body.amount
    const amountParsed =
      typeof amountRaw === 'number' && !Number.isNaN(amountRaw)
        ? amountRaw
        : parseFloat(String(amountRaw ?? '0'))
    const amount = Number.isFinite(amountParsed) ? amountParsed : 0

    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }
    if (amount < 0) {
      return NextResponse.json({ error: 'Amount cannot be negative' }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from('job_cost_lines')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        description,
        amount,
        cost_type: costType,
        status: 'active',
        created_by: profile.id,
      })
      .select('id, description, amount, cost_type, status')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ cost_line: row })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
