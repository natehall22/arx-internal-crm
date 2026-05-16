export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessJobBoard } from '@/lib/permissions'
import ExteriorMeasureClient from '@/app/ops/jobs/[id]/measure/ExteriorMeasureClient'

export default async function OpportunityMeasurePage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()

  // Measuring is ops-only — reps should not enter measurements.
  if (!canAccessJobBoard(profile.role)) redirect(`/opportunities/${params.id}`)

  const supabase = createServiceClient()

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
      />
    </div>
  )
}
