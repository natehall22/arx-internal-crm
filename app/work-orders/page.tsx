export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { categoryScopeOf } from '@/lib/category-scope'
import type { ComponentProps } from 'react'

import { requireAuth } from '@/lib/auth'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadWorkOrderRollCounts } from '@/lib/work-order-moves-db'
import WorkOrdersClient from './WorkOrdersClient'

export default async function WorkOrdersPage() {
  const { profile } = await requireAuth()
  // A person limited to some work categories does not get this page (it is not split by category).
  if (categoryScopeOf(profile).limited) notFound()
  const supabase = createClient()

  const { data: workOrders } = await supabase
    .from('work_orders')
    .select(`
      *,
      projects(id, address_text),
      customers(id, name),
      assigned_user:users!work_orders_assigned_user_id_fkey(id, full_name),
      assigned_sub:sub_contractors!work_orders_assigned_sub_id_fkey(id, company_name)
    `)
    .eq('org_id', profile.org_id)
    // Job crews (trades) live on each job's Schedule & Crews card.
    .is('trade', null)
    .order('created_at', { ascending: false })

  // "Rolled N×" is derived from the move log (the log has no browser policies, so it is read here with the service client).
  const list = (workOrders || []) as unknown as Array<{ id: string }>
  // Only when service plans are on — otherwise no move-log query and no Rolled column.
  const rollsEnabled = await isOrgFeatureOn(profile.org_id, 'servicePlans')
  const rolls = rollsEnabled ? await loadWorkOrderRollCounts(createServiceClient(), profile.org_id, list.map((w) => w.id)) : new Map<string, number>()
  return <WorkOrdersClient rollsEnabled={rollsEnabled} initialWorkOrders={list.map((w) => ({ ...w, roll_count: rolls.get(w.id) ?? 0 })) as unknown as ComponentProps<typeof WorkOrdersClient>['initialWorkOrders']} />
}
