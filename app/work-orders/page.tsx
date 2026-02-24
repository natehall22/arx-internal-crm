export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import WorkOrdersClient from './WorkOrdersClient'

export default async function WorkOrdersPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const { data: workOrders } = await supabase
    .from('work_orders')
    .select(`
      *,
      projects(id, address_text),
      customers(id, name),
      assigned_user:users!work_orders_assigned_user_id_fkey(id, full_name),
      assigned_sub:sub_contractors(id, company_name)
    `)
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  return <WorkOrdersClient initialWorkOrders={workOrders || []} />
}
