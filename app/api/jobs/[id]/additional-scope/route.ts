import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const jobId = params.id
    
    const body = await request.json()
    const { description, quantity, unit, unit_price } = body

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    const serviceSupabase = createServiceClient()

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await serviceSupabase
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const qty = parseFloat(quantity) || 1
    const price = parseFloat(unit_price) || 0
    const lineTotal = qty * price

    const { data, error } = await serviceSupabase
      .from('job_additional_scope')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        description: description.trim(),
        quantity: qty,
        unit: unit || 'each',
        unit_price: price,
        line_total: lineTotal,
        created_by: profile.id,
      })
      .select()
      .single()

    if (error) {
      console.error('[Additional Scope] Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[Additional Scope] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to add scope item' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const jobId = params.id
    
    const serviceSupabase = createServiceClient()

    const { data, error } = await serviceSupabase
      .from('job_additional_scope')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', profile.org_id)
      .order('created_at')

    if (error) {
      console.error('[Additional Scope] Fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error: any) {
    console.error('[Additional Scope] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to fetch scope items' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 })
    }

    const serviceSupabase = createServiceClient()

    const { error } = await serviceSupabase
      .from('job_additional_scope')
      .delete()
      .eq('id', itemId)
      .eq('org_id', profile.org_id)

    if (error) {
      console.error('[Additional Scope] Delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Additional Scope] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to delete scope item' }, { status: 500 })
  }
}
