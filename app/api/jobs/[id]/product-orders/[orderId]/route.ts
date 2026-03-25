import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import {
  buildFallbackFullUpdate,
  buildFallbackUpdate,
  isMissingJobProductOrdersTable,
  mapMaterialOrdersRowsToUi,
  syncJobMaterialCost,
} from '@/lib/ops-product-orders'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; orderId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const { id: jobId, orderId } = params
    
    const body = await request.json()
    const { status, description, supplier, amount } = body

    const validStatuses = ['ordered', 'received', 'paid', 'returned'] as const
    const hasFullEdit =
      description !== undefined ||
      supplier !== undefined ||
      amount !== undefined ||
      status !== undefined

    if (!hasFullEdit) {
      return NextResponse.json(
        { error: 'Provide at least one of: description, supplier, amount, status' },
        { status: 400 }
      )
    }

    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    if (description !== undefined && !String(description).trim()) {
      return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 })
    }

    if (amount !== undefined && (amount === null || Number.isNaN(Number(amount)))) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const serviceSupabase = createServiceClient()

    // Verify order belongs to user's org
    const { data: order, error: orderError } = await serviceSupabase
      .from('job_product_orders')
      .select('id, org_id, description, supplier, amount, status')
      .eq('id', orderId)
      .eq('job_id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (orderError && !isMissingJobProductOrdersTable(orderError)) {
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }

    if (orderError && isMissingJobProductOrdersTable(orderError)) {
      const { data: fallbackOrder, error: fallbackLookupError } = await serviceSupabase
        .from('material_orders')
        .select('id, org_id, notes, supplier, items, total_cost, status')
        .eq('id', orderId)
        .eq('job_id', jobId)
        .eq('org_id', profile.org_id)
        .single()

      if (fallbackLookupError || !fallbackOrder) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      const mappedExisting = mapMaterialOrdersRowsToUi([fallbackOrder])[0]
      const nextDesc =
        description !== undefined ? String(description).trim() : mappedExisting.description
      const nextSupplier =
        supplier !== undefined ? (supplier === null || supplier === '' ? null : String(supplier).trim()) : mappedExisting.supplier
      const nextAmount =
        amount !== undefined ? Number(amount) : Number(mappedExisting.amount || 0)
      const nextStatus =
        status !== undefined ? status : mappedExisting.status

      const updatePayload =
        description !== undefined || supplier !== undefined || amount !== undefined
          ? buildFallbackFullUpdate({
              description: nextDesc,
              supplier: nextSupplier,
              amount: nextAmount,
              status: nextStatus as (typeof validStatuses)[number],
            })
          : buildFallbackUpdate(fallbackOrder.notes, nextStatus as (typeof validStatuses)[number])

      const { data: fallbackUpdated, error: fallbackUpdateError } = await serviceSupabase
        .from('material_orders')
        .update(updatePayload)
        .eq('id', orderId)
        .select('id, org_id, job_id, supplier, items, status, total_cost, notes, created_at')
        .single()

      if (fallbackUpdateError) {
        console.error('[Product Orders] Fallback update error:', fallbackUpdateError)
        return NextResponse.json({ error: fallbackUpdateError.message }, { status: 500 })
      }

      const mapped = mapMaterialOrdersRowsToUi([fallbackUpdated])[0]
      try {
        await syncJobMaterialCost(serviceSupabase, profile.org_id, jobId)
      } catch (syncError) {
        console.error('[Product Orders] Material cost sync error:', syncError)
      }
      return NextResponse.json(mapped)
    }

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = {}
    if (description !== undefined) patch.description = String(description).trim()
    if (supplier !== undefined) patch.supplier = supplier === null || supplier === '' ? null : String(supplier).trim()
    if (amount !== undefined) patch.amount = Number(amount)
    if (status !== undefined) patch.status = status

    const { data, error } = await serviceSupabase
      .from('job_product_orders')
      .update(patch)
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      console.error('[Product Orders] Update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    try {
      await syncJobMaterialCost(serviceSupabase, profile.org_id, jobId)
    } catch (syncError) {
      console.error('[Product Orders] Material cost sync error:', syncError)
    }
    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[Product Orders] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to update order' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; orderId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const { id: jobId, orderId } = params

    // Only admin can delete
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete orders' }, { status: 403 })
    }

    const serviceSupabase = createServiceClient()

    // Verify order belongs to user's org
    const { data: order, error: orderError } = await serviceSupabase
      .from('job_product_orders')
      .select('id')
      .eq('id', orderId)
      .eq('job_id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (orderError && !isMissingJobProductOrdersTable(orderError)) {
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }

    if (orderError && isMissingJobProductOrdersTable(orderError)) {
      const { data: fallbackOrder, error: fallbackLookupError } = await serviceSupabase
        .from('material_orders')
        .select('id')
        .eq('id', orderId)
        .eq('job_id', jobId)
        .eq('org_id', profile.org_id)
        .single()

      if (fallbackLookupError || !fallbackOrder) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      const { error: fallbackDeleteError } = await serviceSupabase
        .from('material_orders')
        .delete()
        .eq('id', orderId)

      if (fallbackDeleteError) {
        console.error('[Product Orders] Fallback delete error:', fallbackDeleteError)
        return NextResponse.json({ error: fallbackDeleteError.message }, { status: 500 })
      }

      try {
        await syncJobMaterialCost(serviceSupabase, profile.org_id, jobId)
      } catch (syncError) {
        console.error('[Product Orders] Material cost sync error:', syncError)
      }
      return NextResponse.json({ success: true })
    }

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const { error } = await serviceSupabase
      .from('job_product_orders')
      .delete()
      .eq('id', orderId)

    if (error) {
      console.error('[Product Orders] Delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    try {
      await syncJobMaterialCost(serviceSupabase, profile.org_id, jobId)
    } catch (syncError) {
      console.error('[Product Orders] Material cost sync error:', syncError)
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Product Orders] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to delete order' }, { status: 500 })
  }
}
