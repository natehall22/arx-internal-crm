import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import {
  buildFallbackInsert,
  getSignedOrderAmount,
  isMissingJobProductOrdersTable,
  mapMaterialOrdersRowsToUi,
  syncJobMaterialCost,
} from '@/lib/ops-product-orders'

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

    if (error && !isMissingJobProductOrdersTable(error)) {
      console.error('[Product Orders] Fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (error && isMissingJobProductOrdersTable(error)) {
      const { data: fallbackData, error: fallbackError } = await serviceSupabase
        .from('material_orders')
        .select('id, org_id, job_id, supplier, items, status, total_cost, notes, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })

      if (fallbackError) {
        console.error('[Product Orders] Fallback fetch error:', fallbackError)
        return NextResponse.json({ error: fallbackError.message }, { status: 500 })
      }

      const mappedOrders = mapMaterialOrdersRowsToUi(fallbackData)
      const total = mappedOrders.reduce(
        (sum, order) => sum + getSignedOrderAmount(Number(order.amount || 0), order.status),
        0
      )

      return NextResponse.json({ orders: mappedOrders, total })
    }

    // Calculate net total (returns subtract from total cost).
    const total = (data || []).reduce(
      (sum, order) => sum + getSignedOrderAmount(Number(order.amount || 0), order.status),
      0
    )

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
    const numericAmount = Number(amount)

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    if (amount === undefined || amount === null || Number.isNaN(numericAmount)) {
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
        amount: numericAmount,
        status: status || 'ordered',
        created_by: profile.id,
      })
      .select()
      .single()

    if (error && !isMissingJobProductOrdersTable(error)) {
      console.error('[Product Orders] Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (error && isMissingJobProductOrdersTable(error)) {
      const fallbackPayload = buildFallbackInsert({
        orgId: profile.org_id,
        jobId,
        description: description.trim(),
        supplier,
        amount: numericAmount,
        status: status || 'ordered',
        userId: profile.id,
      })

      const { data: fallbackData, error: fallbackError } = await serviceSupabase
        .from('material_orders')
        .insert(fallbackPayload)
        .select('id, org_id, job_id, supplier, items, status, total_cost, notes, created_at')
        .single()

      if (fallbackError) {
        console.error('[Product Orders] Fallback insert error:', fallbackError)
        return NextResponse.json({ error: fallbackError.message }, { status: 500 })
      }

      const mapped = mapMaterialOrdersRowsToUi([fallbackData])[0]
      try {
        await syncJobMaterialCost(serviceSupabase, profile.org_id, jobId)
      } catch (syncError) {
        console.error('[Product Orders] Material cost sync error:', syncError)
      }
      return NextResponse.json(mapped)
    }

    try {
      await syncJobMaterialCost(serviceSupabase, profile.org_id, jobId)
    } catch (syncError) {
      console.error('[Product Orders] Material cost sync error:', syncError)
    }
    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[Product Orders] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to create order' }, { status: 500 })
  }
}
