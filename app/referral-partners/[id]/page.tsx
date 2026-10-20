export const dynamic = 'force-dynamic'

import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import PartnerDetailClient from './PartnerDetailClient'

export default async function ReferralPartnerPage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()
  const supabase = createServiceClient()
  const { data: types } = await supabase
    .from('referral_partner_types')
    .select('id, name')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .order('sort_order')
  const { data: reps } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('org_id', profile.org_id)
    .eq('active', true)
    .order('full_name')

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <PartnerDetailClient partnerId={params.id} types={types ?? []} reps={reps ?? []} />
    </div>
  )
}
