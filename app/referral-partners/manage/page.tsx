export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { getPartnerAccess } from '@/lib/referral-partners'
import { createServiceClient } from '@/lib/supabase/service'
import ManageClient from './ManageClient'

export default async function ManageReferralPartnersPage() {
  const { authUser, profile } = await requireAuth()
  const supabase = createServiceClient()
  const access = await getPartnerAccess(supabase, authUser.id, profile)
  if (!access.canManage) redirect('/referral-partners')

  const { data: reps } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('org_id', profile.org_id)
    .eq('active', true)
    .order('full_name')

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <ManageClient reps={reps ?? []} />
    </div>
  )
}
