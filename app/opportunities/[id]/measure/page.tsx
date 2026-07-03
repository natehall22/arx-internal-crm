export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import ExteriorMeasureClient from '@/app/ops/jobs/[id]/measure/ExteriorMeasureClient'

export default async function OpportunityMeasurePage({ params }: { params: { id: string } }) {
  const { authUser, profile } = await requireAuth()
  const supabase = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(supabase, authUser.id, profile)

  // Measuring is ops-only — reps should not enter measurements.
  if (!canJobBoard) redirect(`/opportunities/${params.id}`)

  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('id, org_id, address_text, owner_user_id, setter_user_id, customers(id, name, phone, email), leads(id, homeowner_name, phone, email, owner_user_id, closer_user_id)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!opportunity) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <ExteriorMeasureClient
        subject={opportunity as any}
        apiBase={`/api/opportunities/${params.id}/measure`}
        photoApiBase={`/api/opportunities/${params.id}/measure/photos`}
        backHref={`/opportunities/${params.id}`}
        backLabel="Back to opportunity"
        printHref={`/opportunities/${params.id}/measure/print`}
        roofMeasureHref={`/tools/roof-measure?opportunity_id=${params.id}&address=${encodeURIComponent(opportunity.address_text || '')}`}
      />
    </div>
  )
}
