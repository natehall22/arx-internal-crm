import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Mark a deal lost (opportunity, its lead, and a status note). The one writer: the opportunity page and the Customer File
 * Sales tab both call it from their server actions. Server only; auth is checked here.
 */
export async function markOpportunityLost(opportunityId: string, leadId: string | null): Promise<void> {
  const { profile } = await requireAuth()
  const supabase = createServiceClient()

  await supabase.from('opportunities').update({ status: 'lost' }).eq('id', opportunityId).eq('org_id', profile.org_id)

  if (leadId) {
    await supabase.from('leads').update({ status: 'lost' }).eq('id', leadId).eq('org_id', profile.org_id)
  }

  await supabase.from('activities').insert({
    org_id: profile.org_id,
    opportunity_id: opportunityId,
    user_id: profile.id,
    type: 'status_change',
    body: 'Opportunity marked as lost.',
  })
}
