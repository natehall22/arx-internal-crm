import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { normalizeReportDoc, REPORT_BUCKET } from '@/lib/inspection-report/types'
import { orderedPhotoIds } from '@/lib/inspection-report/pdf'

// Public, tokenized share page for a roof inspection report. The customer forwards this
// link to family, neighbors, or their insurance carrier — so it doubles as a branded
// landing page with a clear way to reach ARX.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Roof Inspection Report — ARX Roofing & Exteriors',
  robots: { index: false, follow: false },
}

export default async function SharedReportPage({ params }: { params: { token: string } }) {
  const token = params.token
  // Tokens are 64 hex chars; reject junk early without a DB round trip
  if (!/^[a-f0-9]{48,80}$/i.test(token)) notFound()

  const admin = createServiceClient()
  const { data: report } = await admin
    .from('inspection_reports')
    .select('id, org_id, doc, pdf_storage_path, pdf_size_bytes, pdf_photo_count, pdf_generated_at')
    .eq('share_token', token)
    .maybeSingle()
  if (!report || !report.pdf_storage_path) notFound()

  const { data: signed } = await admin.storage
    .from(REPORT_BUCKET)
    .createSignedUrl(report.pdf_storage_path, 60 * 60)
  if (!signed?.signedUrl) notFound()

  const doc = normalizeReportDoc(report.doc)
  const address = doc.propertyAddressHeader
  // Count snapshotted at PDF-finalize time so later doc edits can't disagree with the file;
  // fall back to the doc for reports finalized before the snapshot column existed.
  const photoCount = report.pdf_photo_count ?? orderedPhotoIds(doc, () => true).length
  const generatedOn = report.pdf_generated_at
    ? new Date(report.pdf_generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null
  const sizeMb = report.pdf_size_bytes ? (report.pdf_size_bytes / 1048576).toFixed(1) : null

  return (
    <div style={{ minHeight: '100vh', background: '#1f1e1c' }} className="flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-xl">
        {/* Brand header */}
        <div
          className="rounded-t-xl px-6 py-5 text-center"
          style={{ background: '#2B2A28', borderBottom: '3px solid #B0904E' }}
        >
          <div className="text-2xl font-bold tracking-widest" style={{ color: '#F4ECDC' }}>
            ARX <span style={{ color: '#B0904E' }}>ROOFING &amp; EXTERIORS</span>
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider" style={{ color: '#cfc6b3' }}>
            Roof Inspection Report
          </div>
        </div>

        {/* Report card */}
        <div className="rounded-b-xl bg-white p-6 shadow-xl">
          <h1 className="text-xl font-bold" style={{ color: '#2c2c2a' }}>
            {doc.cover.title.replace(/\n/g, ' ') || 'Roof Damage Documentation'}
          </h1>
          {address ? (
            <p className="mt-1 text-sm font-medium" style={{ color: '#8a8576' }}>
              {address}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: '#2c2c2a' }}>
            {photoCount > 0 ? (
              <span>
                <strong>{photoCount}</strong> documented photograph{photoCount !== 1 ? 's' : ''}
              </span>
            ) : null}
            {generatedOn ? (
              <span>
                Prepared <strong>{generatedOn}</strong>
              </span>
            ) : null}
          </div>

          <a
            href={signed.signedUrl}
            target="_blank"
            rel="noopener"
            className="mt-6 block w-full rounded-lg py-3.5 text-center text-base font-bold"
            style={{ background: '#B0904E', color: '#2B2A28' }}
          >
            View the full report (PDF{sizeMb ? `, ${sizeMb} MB` : ''})
          </a>

          <p className="mt-3 text-center text-xs" style={{ color: '#8A8A8A' }}>
            This report is prepared for the homeowner and may be shared with their insurance carrier.
          </p>

          {/* CTA — the report travels; every reader is a potential inspection */}
          <div
            className="mt-6 rounded-lg p-4"
            style={{ background: '#F1E9D7', borderLeft: '5px solid #B0904E' }}
          >
            <div className="font-bold" style={{ color: '#2c2c2a' }}>
              Think your roof may have been impacted too?
            </div>
            <p className="mt-1 text-sm" style={{ color: '#333333' }}>
              ARX provides free, no-obligation roof inspections across the Charlotte / Kannapolis area — with the
              same measured photo documentation you see in this report.
            </p>
            <a
              href="tel:+13604859413"
              className="mt-3 inline-block rounded-lg px-5 py-2.5 text-sm font-bold"
              style={{ background: '#2B2A28', color: '#F4ECDC' }}
            >
              Call (360) 485-9413
            </a>
            <a
              href="https://arxroofing.com"
              target="_blank"
              rel="noopener"
              className="ml-3 mt-3 inline-block rounded-lg px-5 py-2.5 text-sm font-bold"
              style={{ border: '1px solid #2B2A28', color: '#2c2c2a' }}
            >
              arxroofing.com
            </a>
          </div>
        </div>

        <p className="mt-4 text-center text-xs" style={{ color: '#8A8A8A' }}>
          ARX Roofing &amp; Exteriors &nbsp;|&nbsp; Charlotte / Kannapolis, NC &nbsp;|&nbsp; (360) 485-9413
        </p>
      </div>
    </div>
  )
}
