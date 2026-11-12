export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/service'
import { customerSignedDocPath } from '@/lib/files/files-object'
import { getDocumentBrand } from '@/lib/org-brand'
import { findBySigningTokenOnThisHost } from '@/lib/signing-fence'
import { noticeOfCancellation } from '@/lib/contracts/terms'
import { esignDisclosure } from '@/lib/signing/consent'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { ensureEnvelope } from '@/lib/signing/envelope'
import CustomerSigningForm from './CustomerSigningForm'

export default async function ContractSigningPage({
  params,
}: {
  params: { token: string }
}) {
  const supabase = createServiceClient()

  const contract = await findBySigningTokenOnThisHost(supabase, 'contract', params.token)

  // Company identity from the contract's org (no contract → the default identity).
  const brand = await getDocumentBrand(supabase, contract?.org_id)

  if (!contract) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Contract Not Found</h1>
          <p className="text-gray-600">
            This contract link is invalid or has been removed. Please contact {brand.name} for assistance.
          </p>
        </div>
      </div>
    )
  }

  if (new Date(contract.token_expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-600">
            This contract signing link has expired. Please contact {brand.name} to request a new link.
          </p>
          <p className="text-sm text-gray-500 mt-4">
            Phone: {brand.phone}<br />
            Email: {brand.email}
          </p>
        </div>
      </div>
    )
  }

  if (contract.status === 'completed') {
    const agreementLabel = contract.agreement_type === 'contingency' ? 'agreement' : 'contract'

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Agreement Already Signed</h1>
          <p className="text-gray-600">
            This {agreementLabel} has already been signed. A copy has been sent to your email.
          </p>
          {contract.pdf_url && (
            <a
              href={customerSignedDocPath('contract', params.token)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Signed Agreement
            </a>
          )}
        </div>
      </div>
    )
  }

  if (contract.status === 'voided') {
    // A customer who declined sees that, not "voided" (the company's own words for what happened).
    const env = contract.customer_signed_at ? null : await ensureEnvelope(supabase, 'contract', contract).catch(() => 'not_ready' as const)
    if (env && env !== 'not_ready' && env.status === 'declined') {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-2">You declined to sign</h1>
            <p className="text-gray-600">{brand.name} has been told. Please contact them if you change your mind.</p>
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Contract Voided</h1>
          <p className="text-gray-600">
            This contract has been voided and is no longer valid. Please contact {brand.name} for more information.
          </p>
        </div>
      </div>
    )
  }

  // Shown as if signed now — the PDF computes the same notice from the signing time.
  const cancellationNotice = noticeOfCancellation(new Date().toISOString(), brand)

  // The page gets the contract, never the stored token columns (hash, encrypted copy, old plaintext).
  const { signing_token: _t, signing_token_hash: _h, signing_token_enc: _e, ...contractForPage } = contract
  void _t; void _h; void _e

  const signing = await loadSigningSettings(supabase, contract.org_id)
  const consent = signing.consentStep && !contract.quote_approval_id ? esignDisclosure({ name: brand.name, phone: brand.phone, email: brand.email }) : null

  return (
    <CustomerSigningForm
      contract={contractForPage as never}
      token={params.token}
      brand={brand}
      cancellationNotice={cancellationNotice}
      consent={consent}
      declineEnabled={signing.declineEnabled && !contract.quote_approval_id}
    />
  )
}
