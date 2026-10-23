import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import LeadView from '@/app/leads/[id]/LeadView'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Prospect File: a lead with no deal yet (most canvass pins). Same shell, one view — no tabs, no thread
 * (a thread starts when an inspection is booked and the deal exists). Once a deal with a customer exists,
 * this URL moves to the real file.
 */
export default async function ProspectFile({ params }: { params: { leadId: string } }) {
  const { profile } = await requireAuth()
  const admin = createServiceClient()
  const { data: opp } = await admin
    .from('opportunities')
    .select('id, customer_id')
    .eq('lead_id', params.leadId)
    .eq('org_id', profile.org_id)
    .not('customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (opp?.customer_id) redirect(`/c/${opp.customer_id}/d/${opp.id}`)
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <LeadView params={{ id: params.leadId }} embedded />
    </div>
  )
}
