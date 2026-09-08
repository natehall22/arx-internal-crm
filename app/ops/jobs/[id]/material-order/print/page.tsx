export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { buildJobMaterialOrder } from '@/lib/job-material-order'
import PrintOrderSheetButton from './PrintOrderSheetButton'

export default async function MaterialOrderPrintPage({ params }: { params: { id: string } }) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/dashboard')

  const order = await buildJobMaterialOrder(admin, profile.org_id, params.id)
  if (!order) notFound()

  const { jobNumber, customerName, sections } = order

  const printedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <main className="min-h-screen bg-white text-[#2c2c2a]">
      <div className="no-print mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Link href={`/ops/jobs/${params.id}`} className="text-sm font-medium text-indigo-700">
          Back to job
        </Link>
        <PrintOrderSheetButton />
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-12 print:px-0">
        <header className="border-b border-gray-300 pb-4 mb-6">
          <h1 className="text-2xl font-bold text-[#2c2c2a]">Materials Order Sheet</h1>
          <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <p>
              <span className="font-semibold">Job:</span> {jobNumber}
            </p>
            <p>
              <span className="font-semibold">Date:</span> {printedAt}
            </p>
            <p>
              <span className="font-semibold">Customer:</span> {customerName}
            </p>
            <p>
              <span className="font-semibold">Proposal:</span> {order.proposalNumber || '—'}
            </p>
            <p className="col-span-2">
              <span className="font-semibold">Address:</span> {order.address || '—'}
            </p>
          </div>
        </header>

        {order.isEmpty ? (
          <p className="text-sm text-[#2c2c2a]">
            No measurement or sold scope on this job yet, so there is nothing to order. Add a roof
            measure in the CRM, then reprint.
          </p>
        ) : null}

        {sections.map(
          (section) =>
            section.rows.length > 0 && (
              <section key={section.title} className="mb-8">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#2c2c2a]">
                  {section.title}
                </h2>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-800 text-left">
                      <th className="py-2 pr-3 font-semibold">Item</th>
                      <th className="py-2 pr-3 font-semibold">Computed qty</th>
                      <th className="py-2 pr-3 font-semibold">Actual qty</th>
                      <th className="py-2 font-semibold">Supplier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.key} className="border-b border-gray-300">
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium">{row.label}</div>
                          {row.detail ? <div className="text-xs text-gray-700">{row.detail}</div> : null}
                          {row.note ? <div className="text-xs text-gray-800">{row.note}</div> : null}
                        </td>
                        <td className="py-2 pr-3 align-top tabular-nums">{row.qty || '—'}</td>
                        <td className="py-2 pr-3 align-top">&nbsp;</td>
                        <td className="py-2 align-top">&nbsp;</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )
        )}
      </div>
    </main>
  )
}
