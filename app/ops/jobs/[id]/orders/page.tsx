import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import ProductOrdersClient from './ProductOrdersClient'
import { canAccessJobBoard } from '@/lib/permissions'

export default async function ProductOrdersPage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()
  if (!profile) redirect('/login')
  if (!canAccessJobBoard(profile.role)) {
    redirect('/dashboard')
  }

  const supabase = createClient()

  const { data: job } = await supabase
    .from('production_jobs')
    .select('id, job_number, address_text, org_id')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!job) {
    notFound()
  }

  return (
    <ProductOrdersClient 
      jobId={job.id} 
      jobNumber={job.job_number}
      address={job.address_text}
      userRole={profile.role}
    />
  )
}
