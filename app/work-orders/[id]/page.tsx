export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import WorkOrderDetailClient from './WorkOrderDetailClient'

interface PageProps {
  params: { id: string }
}

export default async function WorkOrderDetailPage({ params }: PageProps) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const { data: workOrder } = await supabase
    .from('work_orders')
    .select(`
      *,
      projects(id, address_text),
      customers(id, name, phone),
      assigned_user:users!work_orders_assigned_user_id_fkey(id, full_name, email),
      assigned_sub:sub_contractors(id, company_name, contact_name, phone),
      created_by_user:users!work_orders_created_by_fkey(full_name)
    `)
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!workOrder) {
    notFound()
  }

  const { data: comments } = await supabase
    .from('work_order_comments')
    .select(`
      *,
      user:users(full_name),
      sub:sub_contractors(company_name)
    `)
    .eq('work_order_id', params.id)
    .order('created_at', { ascending: true })

  const { data: statusHistory } = await supabase
    .from('work_order_status_history')
    .select(`
      *,
      changed_by_user:users(full_name)
    `)
    .eq('work_order_id', params.id)
    .order('created_at', { ascending: false })

  return (
    <WorkOrderDetailClient
      initialWorkOrder={workOrder}
      initialComments={comments || []}
      initialStatusHistory={statusHistory || []}
      userId={profile.id}
      orgId={profile.org_id}
      userRole={profile.role}
    />
  )
}
