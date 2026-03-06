import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; orderId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const { id: jobId, orderId } = params
    
    const body = await request.json()
    const { status } = body

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 })
    }

    const validStatuses = ['ordered', 'received', 'paid', 'returned']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const serviceSupabase = createServiceClient()

    // Verify order belongs to user's org
    const { data: order } = await serviceSupabase
      .from('job_product_orders')
      .select('id, org_id')
      .eq('id', orderId)
      .eq('job_id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const { data, error } = await serviceSupabase
      .from('job_product_orders')
      .update({ status })
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      console.error('[Product Orders] Update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
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
    const { data: order } = await serviceSupabase
      .from('job_product_orders')
      .select('id')
      .eq('id', orderId)
      .eq('job_id', jobId)
      .eq('org_id', profile.org_id)
      .single()

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

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Product Orders] Error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to delete order' }, { status: 500 })
  }
}
