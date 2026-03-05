export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SubWorkOrdersClient from './SubWorkOrdersClient'

export default async function SubWorkOrdersPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  // Get sub_id for this user
  const { data: subId } = await supabase
    .rpc('get_sub_id_for_user', { user_uuid: profile.id })

  if (!subId) {
    redirect('/dashboard')
  }

  // Get sub info
  const { data: subInfo } = await supabase
    .from('sub_contractors')
    .select('company_name')
    .eq('id', subId)
    .single()

  // Fetch work orders assigned to this sub
  const { data: workOrders, error } = await supabase
    .from('work_orders')
    .select(`
      id,
      work_order_number,
      work_order_type,
      status,
      priority,
      title,
      description,
      address,
      city,
      state,
      zip,
      scheduled_date,
      scheduled_time_start,
      estimated_hours,
      materials,
      completion_notes,
      sub_completion_notes,
      completed_at,
      job_id,
      customer:customers(name, phone)
    `)
    .eq('assigned_sub_id', subId)
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching work orders:', error)
  }

  // Get photo counts for each work order
  const workOrderIds = (workOrders || []).map(wo => wo.id)
  let photoCounts: Record<string, { work_done: number; cleanup: number }> = {}
  
  if (workOrderIds.length > 0) {
    const { data: photos } = await supabase
      .from('work_order_photos')
      .select('work_order_id, photo_type')
      .in('work_order_id', workOrderIds)

    if (photos) {
      photos.forEach(photo => {
        if (!photoCounts[photo.work_order_id]) {
          photoCounts[photo.work_order_id] = { work_done: 0, cleanup: 0 }
        }
        if (photo.photo_type === 'work_done') {
          photoCounts[photo.work_order_id].work_done++
        } else if (photo.photo_type === 'cleanup') {
          photoCounts[photo.work_order_id].cleanup++
        }
      })
    }
  }

  // Transform the data
  const transformedWorkOrders = (workOrders || []).map(wo => {
    const customer = Array.isArray(wo.customer) ? wo.customer[0] : wo.customer
    return {
      id: wo.id,
      work_order_number: wo.work_order_number,
      work_order_type: wo.work_order_type,
      status: wo.status,
      priority: wo.priority,
      title: wo.title,
      description: wo.description,
      address: wo.address,
      city: wo.city,
      state: wo.state,
      zip: wo.zip,
      full_address: [wo.address, wo.city, wo.state, wo.zip].filter(Boolean).join(', '),
      scheduled_date: wo.scheduled_date,
      scheduled_time_start: wo.scheduled_time_start,
      estimated_hours: wo.estimated_hours,
      materials: wo.materials,
      completion_notes: wo.completion_notes,
      sub_completion_notes: wo.sub_completion_notes,
      completed_at: wo.completed_at,
      job_id: wo.job_id,
      customer_name: customer?.name,
      customer_phone: customer?.phone,
      photo_counts: photoCounts[wo.id] || { work_done: 0, cleanup: 0 },
    }
  })

  return (
    <SubWorkOrdersClient 
      workOrders={transformedWorkOrders} 
      companyName={subInfo?.company_name || 'Sub Portal'}
    />
  )
}
