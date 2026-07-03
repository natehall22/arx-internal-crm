export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveJobMeasureContext } from '@/lib/exterior-measure-api'
import { resolveOpsAccess } from '@/lib/ops-access'
import ExteriorMeasureClient from './ExteriorMeasureClient'

export default async function ExteriorMeasurePage({ params }: { params: { id: string } }) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/dashboard')

  const supabase = createClient()
  const { data: job } = await supabase
    .from('production_jobs')
    .select('id, org_id, job_number, address_text, job_type, customer:customers(id, name, phone, email), project:projects(id, leads(id, homeowner_name, phone, email))')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!job) notFound()

  const measureContext = await resolveJobMeasureContext(admin, profile.org_id, params.id)
  const roofMeasureHref = measureContext?.opportunityId
    ? `/tools/roof-measure?opportunity_id=${measureContext.opportunityId}&address=${encodeURIComponent(job.address_text || '')}`
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <ExteriorMeasureClient
        subject={job as any}
        apiBase={`/api/ops/jobs/${params.id}/measure`}
        photoApiBase={`/api/ops/jobs/${params.id}/measure/photos`}
        backHref={`/ops/jobs/${params.id}`}
        backLabel="Back to job"
        printHref={`/ops/jobs/${params.id}/measure/print`}
        roofMeasureHref={roofMeasureHref}
      />
    </div>
  )
}
