'use client'

import Link from 'next/link'

type LinkJob = {
  id: string
  customer?: { id: string } | null
  installation_agreement?: { pdf_url: string | null; status: string; agreement_type?: string | null } | null
  roof_report?: { id: string; pdf_generated_at: string | null } | null
  sold_scope?: unknown
  job_type?: string | null
}

/** Desktop side panel: the documents people open all day, one tap each. */
export default function JobQuickLinks({ job }: { job: LinkJob }) {
  const row = 'flex min-h-[44px] items-center justify-between rounded-lg px-3 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50'
  const agreement = job.installation_agreement?.status === 'completed' ? job.installation_agreement : null
  return (
    <nav aria-label="Job documents" className="rounded-xl border bg-white p-2 shadow-sm">
      <p className="px-3 pb-1 pt-2 text-sm font-semibold uppercase tracking-wide text-[#2c2c2a]">Documents</p>
      <a className={row} href={`/api/ops/jobs/${job.id}/run-sheet/pdf`} target="_blank" rel="noopener noreferrer">Crew run sheet <span aria-hidden>↗</span></a>
      {job.sold_scope && job.job_type === 'roofing' ? (
        <a className={row} href={`/api/ops/jobs/${job.id}/material-order/pdf`} target="_blank" rel="noopener noreferrer">Supplier order sheet <span aria-hidden>↗</span></a>
      ) : null}
      {agreement?.pdf_url ? (
        <a className={row} href={agreement.pdf_url} target="_blank" rel="noopener noreferrer">
          {agreement.agreement_type === 'repair' ? 'Repair agreement' : 'Installation agreement'} <span aria-hidden>↗</span>
        </a>
      ) : null}
      {job.roof_report?.pdf_generated_at ? (
        <a className={row} href={`/api/inspection-reports/${job.roof_report.id}/pdf?redirect=1`} target="_blank" rel="noopener noreferrer">Roof report <span aria-hidden>↗</span></a>
      ) : null}
      {job.customer ? <Link className={row} href={`/customers/${job.customer.id}`}>Customer file <span aria-hidden>→</span></Link> : null}
    </nav>
  )
}
