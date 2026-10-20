export const dynamic = 'force-dynamic'

import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { getPartnerAccess } from '@/lib/referral-partners'
import { createServiceClient } from '@/lib/supabase/service'
import ReferralPartnersClient from './ReferralPartnersClient'

export default async function ReferralPartnersPage() {
  const { authUser, profile } = await requireAuth()
  const supabase = createServiceClient()
  const [{ data: types }, access] = await Promise.all([
    supabase
      .from('referral_partner_types')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
    getPartnerAccess(supabase, authUser.id, profile),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <ReferralPartnersClient types={types ?? []} canManage={access.canManage} />
    </div>
  )
}
