import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import SignaturePad from '@/components/SignaturePad'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function RepContractPage({
  params,
}: {
  params: { token: string }
}) {
  const { profile } = await requireAuth()
  const serviceSupabase = createServiceClient()

  const { data: contract } = await serviceSupabase
    .from('contracts')
    .select('*')
    .eq('token', params.token)
    .single()

  if (!contract) {
    notFound()
  }

  const { data: project } = await serviceSupabase
    .from('projects')
    .select('*, leads(*)')
    .eq('id', contract.project_id)
    .single()

  if (!project) {
    notFound()
  }

  const { data: urlData } = await serviceSupabase.storage
    .from('files')
    .createSignedUrl(contract.contract_pdf_path, 3600)

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              ARX Roofing & Exteriors
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Rep Contract Review</h1>
            <p className="mt-2 text-sm text-slate-400">
              Confirm the details below, sign, then send to the customer.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm">
            {urlData?.signedUrl ? (
              <div className="space-y-3">
                <a
                  href={urlData.signedUrl}
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  Download contract PDF
                </a>
                <div className="h-[520px] w-full overflow-hidden rounded-md border border-slate-800">
                  <iframe
                    title="Contract PDF"
                    src={urlData.signedUrl}
                    className="h-full w-full"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-slate-400">
                <p>Contract file unavailable.</p>
                <p className="text-xs">File path: {contract.contract_pdf_path}</p>
              </div>
            )}
          </div>

          <form method="POST" action={`/api/contracts/${contract.id}/rep-sign`} className="mt-6 space-y-4">
            <input type="hidden" name="contract_id" value={contract.id} />
            <input type="hidden" name="lead_name" value={project.leads?.homeowner_name || ''} />
            <input type="hidden" name="lead_address" value={project.leads?.address_text || ''} />
            <input type="hidden" name="lead_phone" value={project.leads?.phone || ''} />
            <input type="hidden" name="lead_email" value={project.leads?.email || ''} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-200">Rep name</label>
                <input
                  name="rep_name"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  defaultValue={profile.full_name ?? ''}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-200">Rep title</label>
                <input
                  name="rep_title"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="Sales Rep"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-200">Payment Method</label>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-300">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="payment_method" value="finance" />
                    Finance Co
                  </label>
                  <input
                    name="finance_company"
                    className="w-56 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                    placeholder="Bank or lender"
                  />
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="payment_method" value="cash" />
                    Cash
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="payment_method" value="insurance" />
                    Insurance Claim
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="payment_method" value="other" />
                    Other
                  </label>
                  <input
                    name="payment_other"
                    className="w-40 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                    placeholder="Other"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-200">Deposit</label>
                <input
                  name="deposit_amount"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="$0.00"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-200">Notes</label>
                <input
                  name="notes"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="Notes"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-200">
                  Exclusions / Observations
                </label>
                <textarea
                  name="exclusions_observations"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  rows={2}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-200">
                  Additional Products
                </label>
                <textarea
                  name="additional_products"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  rows={2}
                />
              </div>
            </div>

            <SignaturePad name="signature" label="Rep Signature" defaultTyped={profile.full_name ?? ''} />

            <button
              type="submit"
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
            >
              Rep sign
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
