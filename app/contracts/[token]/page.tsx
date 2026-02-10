import { createServiceClient } from '@/lib/supabase/service'
import { notFound } from 'next/navigation'
import SignaturePad from '@/components/SignaturePad'

export const dynamic = 'force-dynamic'

export default async function ContractSigningPage({
  params,
}: {
  params: { token: string }
}) {
  const serviceSupabase = createServiceClient()

  const { data: contract } = await serviceSupabase
    .from('contracts')
    .select('*')
    .eq('token', params.token)
    .single()

  if (!contract) {
    notFound()
  }

  const { data: urlData } = await serviceSupabase.storage
    .from('files')
    .createSignedUrl(contract.contract_pdf_path, 3600)

  const { data: repSignature } = await serviceSupabase
    .from('contract_signatures')
    .select('signed_at')
    .eq('contract_id', contract.id)
    .eq('role', 'rep')
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const repSigned = Boolean(repSignature?.signed_at)

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              ARX Roofing & Exteriors
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Contract Signature</h1>
            <p className="mt-2 text-sm text-slate-400">
              Review the contract and sign below.
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

          {contract.status === 'customer_signed' || contract.status === 'fully_signed' ? (
            <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              Contract signed by {contract.signed_name} on{' '}
              {contract.signed_at ? new Date(contract.signed_at).toLocaleString() : 'N/A'}.
              <p className="mt-2 text-emerald-100">
                Need another signature? Ask your rep to generate a new signing link.
              </p>
            </div>
          ) : !repSigned ? (
            <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Rep signature is required before the customer can sign.
            </div>
          ) : (
            <form
              method="POST"
              action="/api/contracts/sign"
              className="mt-6 space-y-4"
            >
              <input type="hidden" name="token" value={params.token} />
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm text-slate-200">
                <p className="font-semibold">Contract Details</p>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                  <div>
                    <span className="font-medium">Customer:</span>{' '}
                    {contract.contract_payload?.customer_name || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Project Address:</span>{' '}
                    {contract.contract_payload?.project_address || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Phone:</span>{' '}
                    {contract.contract_payload?.phone || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Email:</span>{' '}
                    {contract.contract_payload?.email || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Payment Method:</span>{' '}
                    {Array.isArray(contract.contract_payload?.payment_method)
                      ? contract.contract_payload?.payment_method?.join(', ')
                      : 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Finance Co:</span>{' '}
                    {contract.contract_payload?.finance_company || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Other:</span>{' '}
                    {contract.contract_payload?.payment_other || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Deposit:</span>{' '}
                    {contract.contract_payload?.deposit_amount || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Notes:</span>{' '}
                    {contract.contract_payload?.notes || 'N/A'}
                  </div>
                  <div className="md:col-span-2">
                    <span className="font-medium">Exclusions / Observations:</span>{' '}
                    {contract.contract_payload?.exclusions_observations || 'N/A'}
                  </div>
                  <div className="md:col-span-2">
                    <span className="font-medium">Additional Products:</span>{' '}
                    {contract.contract_payload?.additional_products || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium">Date:</span>{' '}
                    {new Date().toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-200">Full Name</label>
                <input
                  name="name"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-200">Email</label>
                <input
                  name="email"
                  type="email"
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  required
                />
              </div>
              <SignaturePad name="signature" label="Signature" />
              <SignaturePad name="initials" label="Initials" />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="agree" value="yes" required />
                I agree to sign this contract electronically.
              </label>
              <button
                type="submit"
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Sign contract
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
