import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const jobId = params.id
    
    const serviceSupabase = createServiceClient()

    // Verify job belongs to user's org
    const { data: job } = await serviceSupabase
      .from('production_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data, error } = await serviceSupabase
      .from('job_product_orders')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Product Orders] Fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Calculate total (excluding returned orders)
    const total = (data || [])
      .filter(order => order.status !== 'returned')
      .reduce((sum, order) => sum + parseFloat(order.amount || 0), 0)

    return NextResponse.json({ orders: data || [], total })
  } catch (error: any) {
    console.error('[Product Orders] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to fetch orders' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const jobId = params.id
    
    const body = await request.json()
    const { description, supplier, amount, status } = body

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
      return NextResponse.json({ error: 'Amount is required' }, { status: 400 })
    }

    const serviceSupabase = createServiceClient()

    // Verify job belongs to user's org
    const { data: job } = await serviceSupabase
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data, error } = await serviceSupabase
      .from('job_product_orders')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        description: description.trim(),
        supplier: supplier?.trim() || null,
        amount: parseFloat(amount),
        status: status || 'ordered',
        created_by: profile.id,
      })
      .select()
      .single()

    if (error) {
      console.error('[Product Orders] Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[Product Orders] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to create order' }, { status: 500 })
  }
}
