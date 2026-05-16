export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { calculateElevationMeasure, calculateExteriorMeasureTotals } from '@/lib/exterior-measure'
import { loadExteriorMeasure, resolveOpportunityMeasureContext } from '@/lib/exterior-measure-api'
import PrintReportButton from '@/app/ops/jobs/[id]/measure/print/PrintReportButton'

function n(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : 0
}

function fmt(value: number) {
  return Math.round(value * 100) / 100
}

export default async function OpportunityMeasurePrintPage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()
  const supabase = createServiceClient()
  const context = await resolveOpportunityMeasureContext(supabase, profile.org_id, params.id)
  if (!context) notFound()

  const measure = await loadExteriorMeasure(supabase, context)
  if (!measure.report) redirect(`/opportunities/${params.id}/measure`)

  const report = measure.report
  const subject = context.subject as any
  const customer = Array.isArray(subject.customers) ? subject.customers[0] : subject.customers
  const lead = Array.isArray(subject.leads) ? subject.leads[0] : subject.leads
  const customerName = customer?.name || lead?.homeowner_name || subject.contact_name || 'Customer'
  const enrichedElevations = measure.elevations.map((elevation) => ({
    ...elevation,
    waste_percent: elevation.waste_percent ?? report.waste_percent,
  }))
  const totals = calculateExteriorMeasureTotals(enrichedElevations)
  const photosByElevation = new Map<string, any[]>()
  for (const photo of measure.photos || []) {
    const key = photo.elevation_id || 'general'
    photosByElevation.set(key, [...(photosByElevation.get(key) || []), photo])
  }

  return (
    <main className="min-h-screen bg-white text-gray-950">
      <div className="no-print mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href={`/opportunities/${params.id}/measure`} className="text-sm font-medium text-indigo-600">
          Back to measure
        </Link>
        <PrintReportButton />
      </div>

      <article className="mx-auto max-w-5xl px-4 py-8 print:px-0">
        <header className="border-b-4 border-gray-950 pb-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-700">ARX</p>
              <h1 className="mt-2 text-3xl font-bold">{report.report_title}</h1>
              <p className="mt-2 text-sm text-gray-600">{customerName} · Opportunity Measure</p>
              <p className="text-sm text-gray-600">{subject.address_text || 'No address on file'}</p>
            </div>
            <div className="text-right text-sm text-gray-600">
              <p className="font-semibold text-gray-950">Status: {report.status}</p>
              <p>{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Net siding', `${fmt(totals.net_siding_sqft)} sqft`],
            ['Siding squares', fmt(totals.siding_squares)],
            ['Soffit', `${fmt(totals.soffit_sqft)} sqft`],
            ['Gutter', `${fmt(totals.gutter_lf)} lf`],
            ['Fascia', `${fmt(totals.fascia_lf)} lf`],
            ['Starter strip', `${fmt(totals.starter_strip_lf)} lf`],
            ['J-channel', `${fmt(totals.j_channel_lf)} lf`],
            ['Corners', `${totals.inside_corners} inside / ${totals.outside_corners} outside`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-gray-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Calculation Summary</h2>
          <table className="mt-3 w-full border-collapse text-sm">
            <tbody>
              {[
                ['Gross wall sqft', totals.gross_wall_sqft],
                ['Gable sqft', totals.gable_sqft],
                ['Opening deductions sqft', totals.opening_deductions_sqft],
                ['Net siding sqft', totals.net_siding_sqft],
                ['Waste sqft', totals.waste_sqft],
                ['Siding sqft with waste', totals.siding_sqft_with_waste],
                ['Siding squares', totals.siding_squares],
              ].map(([label, value]) => (
                <tr key={label} className="border-b">
                  <td className="py-2 text-gray-600">{label}</td>
                  <td className="py-2 text-right font-semibold">{fmt(n(value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-8 space-y-6">
          <h2 className="text-xl font-bold">Elevations</h2>
          {enrichedElevations.map((elevation) => {
            const calc = calculateElevationMeasure(elevation)
            const elevationPhotos = photosByElevation.get(elevation.id) || []
            return (
              <div key={elevation.id} className="break-inside-avoid rounded-lg border border-gray-300 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">{elevation.elevation_name}</h3>
                    <p className="text-sm text-gray-600">
                      Wall {fmt(n(elevation.wall_width_ft))} ft x {fmt(n(elevation.wall_height_ft))} ft
                    </p>
                  </div>
                  <p className="text-right text-sm font-semibold">{fmt(calc.net_siding_sqft)} net sqft</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <span>Gross: {fmt(calc.gross_wall_sqft)} sqft</span>
                  <span>Gable: {fmt(calc.gable_sqft)} sqft</span>
                  <span>Openings: {fmt(calc.opening_deductions_sqft)} sqft</span>
                  <span>Waste: {fmt(calc.waste_sqft)} sqft</span>
                  <span>Soffit: {fmt(calc.soffit_sqft)} sqft</span>
                  <span>Fascia: {fmt(calc.fascia_lf)} lf</span>
                  <span>Gutter: {fmt(calc.gutter_lf)} lf</span>
                  <span>J-channel: {fmt(calc.j_channel_lf)} lf</span>
                </div>
                {elevation.openings.length > 0 && (
                  <table className="mt-3 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-gray-500">
                        <th className="py-2">Opening</th>
                        <th className="py-2 text-right">Qty</th>
                        <th className="py-2 text-right">Size</th>
                        <th className="py-2 text-right">Deduction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {elevation.openings.map((opening: any) => (
                        <tr key={opening.id} className="border-b">
                          <td className="py-2 capitalize">{opening.label || opening.opening_type?.replace('_', ' ') || 'Opening'}</td>
                          <td className="py-2 text-right">{opening.quantity}</td>
                          <td className="py-2 text-right">{fmt(n(opening.width_ft))} x {fmt(n(opening.height_ft))} ft</td>
                          <td className="py-2 text-right font-medium">{fmt(n(opening.width_ft) * n(opening.height_ft) * n(opening.quantity))} sqft</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {elevationPhotos.length > 0 && (
                  <div className="mt-3 grid grid-cols-6 gap-2">
                    {elevationPhotos.slice(0, 6).map((photo: any) => (
                      <img
                        key={photo.id}
                        src={photo.url || ''}
                        alt={photo.filename || 'Measure photo'}
                        className="aspect-square rounded object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {report.notes && (
          <section className="mt-8 rounded-lg border border-gray-200 p-4">
            <h2 className="text-lg font-bold">Notes</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{report.notes}</p>
          </section>
        )}
      </article>
    </main>
  )
}
