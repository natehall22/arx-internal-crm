export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizeReportDoc, REPORT_EDIT_ROLES } from '@/lib/inspection-report/types'
import {
  attachSignedUrls,
  fetchReportPhotos,
  getOrCreateReport,
} from '@/lib/inspection-report/server'
import ReportBuilder from '@/components/inspection-report/ReportBuilder'

// Full-screen phone-first builder (no CRM nav chrome — the rep is on a roof).
export default async function OpportunityReportPage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()
  if (!REPORT_EDIT_ROLES.has(profile.role)) {
    redirect(`/opportunities/${params.id}`)
  }

  const admin = createServiceClient()
  const result = await getOrCreateReport(admin, {
    opportunityId: params.id,
    profile,
  })
  if ('error' in result) notFound()

  const { report } = result
  const photos = await attachSignedUrls(admin, await fetchReportPhotos(admin, report.id, profile.org_id))

  // customer email for the send dialog (customer preferred, lead as fallback)
  let customerEmail: string | null = null
  const { data: opp } = await admin
    .from('opportunities')
    .select('customer_id, lead_id')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  const [custRes, leadRes] = await Promise.all([
    opp?.customer_id
      ? admin.from('customers').select('email').eq('id', opp.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    opp?.lead_id
      ? admin.from('leads').select('email').eq('id', opp.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  customerEmail = custRes.data?.email || leadRes.data?.email || null

  return (
    <ReportBuilder
      reportId={report.id}
      opportunityId={params.id}
      shareToken={report.share_token}
      pdfGeneratedAt={report.pdf_generated_at}
      pdfSizeBytes={report.pdf_size_bytes}
      lastSentTo={report.last_sent_to}
      updatedAt={report.doc_updated_at ?? report.updated_at}
      initialDoc={normalizeReportDoc(report.doc)}
      initialPhotos={photos.map((p) => ({
        id: p.id,
        url: p.url ?? null,
        width: p.width,
        height: p.height,
      }))}
      customerEmail={customerEmail}
    />
  )
}
