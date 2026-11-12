'use client'

import { useState } from 'react'
import SignaturePad from '@/components/contracts/SignaturePad'
import PhoneLink from '@/components/PhoneLink'
import ConsentBlock from '@/components/signing/ConsentBlock'
import DeclineBox from '@/components/signing/DeclineBox'
import { useSigningBeacon } from '@/components/signing/useSigningBeacon'
import type { ConsentDisclosure } from '@/lib/signing/consent'
import type { DocumentBrand } from '@/lib/org-brand'
import {
  CONTINGENCY_TERMS,
  INSTALLATION_SIGNING_STATEMENT,
  INSTALLATION_TERMS,
  NOTICE_OF_CANCELLATION_CANCEL_LINE,
  NOTICE_OF_CANCELLATION_TITLE,
  REPAIR_TERMS,
  type CancellationNotice,
} from '@/lib/contracts/terms'

interface Contract {
  id: string
  agreement_type?: 'installation' | 'contingency' | 'repair'
  customer_name: string
  customer_email: string
  customer_phone: string
  project_address: string
  project_cost: number
  total_squares: number | null
  roofing_material: string | null
  scope_roof_replacement: boolean
  scope_roof_repair: boolean
  scope_gutters: boolean
  scope_siding: boolean
  scope_other: string | null
  payment_method: string
  finance_company: string | null
  deposit_amount: number
  est_completion_date: string | null
  exclusions: string | null
  additional_products: string | null
  notes: string | null
  rep_name: string
  rep_title: string
  rep_signature_data: string
  rep_signed_at: string
}

interface CustomerSigningFormProps {
  contract: Contract
  token: string
  /** Company identity (letterhead spellings) — loaded server-side from the contract's org. */
  brand: DocumentBrand
  /** Installation Agreement Notice of Cancellation, computed server-side as if signed now (the same rule as the PDF). */
  cancellationNotice: CancellationNotice
  /** The e-sign notice, when the company's consent step is on (null/absent = the page is exactly as it always was). */
  consent?: ConsentDisclosure | null
  /** Show "I can't sign this" (the company's decline switch). */
  declineEnabled?: boolean
}

export default function CustomerSigningForm({ contract, token, brand, cancellationNotice, consent = null, declineEnabled = false }: CustomerSigningFormProps) {
  useSigningBeacon('contract', token)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [declined, setDeclined] = useState(false)
  const isContingency = contract.agreement_type === 'contingency'
  const isRepair = contract.agreement_type === 'repair'
  const agreementLabel = isContingency
    ? 'Insurance Contingency Agreement'
    : isRepair
      ? 'Repair Agreement'
      : 'Installation Agreement'
  const [preferredContact, setPreferredContact] = useState<'phone' | 'email'>('phone')
  const [printName, setPrintName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  const [showCancellation, setShowCancellation] = useState(false)
  
  const [initialsChangeOrders, setInitialsChangeOrders] = useState('')
  const [initialsPropertyCondition, setInitialsPropertyCondition] = useState('')
  const [initialsLandscaping, setInitialsLandscaping] = useState('')
  const [initialsInsurance, setInitialsInsurance] = useState('')
  
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!printName.trim()) {
      setError('Please enter your printed name')
      return
    }
    if (!signature) {
      setError('Please sign the agreement')
      return
    }
    if (isContingency) {
      if (!initialsInsurance) {
        setError('Please initial the insurance contingency acknowledgement')
        return
      }
    } else if (isRepair) {
      if (!initialsChangeOrders) {
        setError('Please add your initials')
        return
      }
      if (contract.payment_method === 'insurance' && !initialsInsurance) {
        setError('Please initial the insurance acknowledgement section')
        return
      }
    } else if (!initialsChangeOrders || !initialsPropertyCondition || !initialsLandscaping) {
      setError('Please initial all acknowledgement sections')
      return
    }
    if (!isContingency && !isRepair && contract.payment_method === 'insurance' && !initialsInsurance) {
      setError('Please initial the insurance acknowledgement section')
      return
    }

    if (consent && !consentAccepted) {
      setError('Please agree to sign electronically before you sign.')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/contracts/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          preferredContact,
          printName,
          signature,
          initialsChangeOrders: isContingency ? null : initialsChangeOrders,
          initialsPropertyCondition: isContingency || isRepair ? null : initialsPropertyCondition,
          initialsLandscaping: isContingency || isRepair ? null : initialsLandscaping,
          initialsInsurance: (isContingency || contract.payment_method === 'insurance') ? initialsInsurance : null,
          ...(consent ? { consent: { accepted: true, version: consent.version } } : {}),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign contract')
      }

      setSuccess(true)
      if (data.pdfUrl) {
        setPdfUrl(data.pdfUrl)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign contract')
    } finally {
      setSubmitting(false)
    }
  }

  if (declined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center text-[#2c2c2a]">
          <h1 className="text-xl font-bold mb-2">Thank you for letting us know</h1>
          <p className="text-base">We have told {brand.name}. Nothing was signed.</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Agreement Signed Successfully!</h1>
          <p className="text-gray-600 mb-4">
            Thank you for signing. A copy of the signed agreement has been sent to your email.
          </p>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Signed Agreement
            </a>
          )}
          <p className="text-sm text-gray-700 mt-6">
            {brand.legalName}<br />
            {brand.phone} | {brand.email}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8 px-3 sm:px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-clip">
          {/* Header */}
          <div className="bg-indigo-900 text-white p-6 text-center">
            <h1 className="text-2xl font-bold">{brand.legalNameUpper}</h1>
            <p className="text-indigo-200 text-sm mt-1">
              {brand.addressLine}
            </p>
            <p className="text-indigo-200 text-sm">
              Phone: {brand.phone} | Email: {brand.email}
            </p>
            <div className="mt-4 inline-block bg-white text-indigo-900 px-4 py-2 rounded-lg font-bold">
              {agreementLabel}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-8 max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-[44px] max-sm:[&_input]:text-base max-sm:[&_select]:min-h-[44px] max-sm:[&_select]:text-base max-sm:[&_textarea]:text-base">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Customer & Premise */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Customer And Premise</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-700">Customer Name(s):</span>
                  <span className="ml-2 font-medium text-black">{contract.customer_name}</span>
                </div>
                <div>
                  <span className="text-gray-700">Project Address:</span>
                  <span className="ml-2 font-medium text-black">{contract.project_address}</span>
                </div>
                <div>
                  <span className="text-gray-700">Phone Number:</span>
                  <span className="ml-2 font-medium text-black"><PhoneLink value={contract.customer_phone} empty="N/A" /></span>
                </div>
                <div>
                  <span className="text-gray-700">Email:</span>
                  <span className="ml-2 font-medium text-black">{contract.customer_email || 'N/A'}</span>
                </div>
              </div>
              
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Method Of Contact *
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                    <input
                      type="radio"
                      name="preferredContact"
                      value="phone"
                      checked={preferredContact === 'phone'}
                      onChange={() => setPreferredContact('phone')}
                      className="w-5 h-5 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-base font-medium text-black">Phone</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                    <input
                      type="radio"
                      name="preferredContact"
                      value="email"
                      checked={preferredContact === 'email'}
                      onChange={() => setPreferredContact('email')}
                      className="w-5 h-5 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-base font-medium text-black">Email</span>
                  </label>
                </div>
              </div>
            </section>

            {/* Project Details */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">{isContingency ? 'Claim Details' : isRepair ? 'Work & price' : 'Project Details'}</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-gray-700">Scope Of Work:</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {contract.scope_roof_replacement && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Roof Replacement</span>}
                    {contract.scope_roof_repair && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Roof Repair</span>}
                    {contract.scope_gutters && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Gutters</span>}
                    {contract.scope_siding && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Siding</span>}
                    {contract.scope_other && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">{contract.scope_other}</span>}
                  </div>
                </div>
                {!isContingency && !isRepair && contract.roofing_material && (
                  <div>
                    <span className="text-gray-700">Primary Roofing System:</span>
                    <span className="ml-2 font-medium text-black">{contract.roofing_material}</span>
                  </div>
                )}
                {!isContingency && !isRepair && contract.total_squares && (
                  <div>
                    <span className="text-gray-700">Total Squares:</span>
                    <span className="ml-2 font-medium text-black">{contract.total_squares}</span>
                  </div>
                )}
                {!isContingency && (
                  <div>
                    <span className="text-gray-700">Project Cost:</span>
                    <span className="ml-2 font-medium text-lg text-black">${contract.project_cost.toLocaleString()}</span>
                  </div>
                )}
                {!isContingency && contract.est_completion_date && (
                  <div>
                    <span className="text-gray-700">Est. Completion Date:</span>
                    <span className="ml-2 font-medium text-black">{new Date(contract.est_completion_date).toLocaleDateString()}</span>
                  </div>
                )}
                {!isContingency && contract.exclusions && (
                  <div>
                    <span className="text-gray-700">Exclusions / Observations:</span>
                    <p className="mt-1 text-black whitespace-pre-wrap">{contract.exclusions}</p>
                  </div>
                )}
                {!isContingency && contract.additional_products && (
                  <div>
                    <span className="text-gray-700">Additional Products:</span>
                    <p className="mt-1 text-black whitespace-pre-wrap">{contract.additional_products}</p>
                  </div>
                )}
              </div>
            </section>

            {!isContingency ? (
              <section>
                <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Payment Details</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-700">Payment Method:</span>
                    <span className="ml-2 font-medium capitalize text-black">
                      {contract.payment_method}
                      {contract.payment_method === 'finance' && contract.finance_company && ` (${contract.finance_company})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-700">Deposit (Due At Signing):</span>
                    <span className="ml-2 font-medium text-black">${contract.deposit_amount.toLocaleString()}</span>
                  </div>
                </div>
                {contract.notes && (
                  <div className="mt-3 text-sm">
                    <span className="text-gray-700">Notes:</span>
                    <p className="mt-1 text-black whitespace-pre-wrap">{contract.notes}</p>
                  </div>
                )}
              </section>
            ) : (
              <section>
                <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Contingency Summary</h2>
                <div className="p-4 bg-amber-50 rounded-lg text-sm text-black">
                  This agreement does not start construction, order materials, or set the final project price. A final Installation Agreement is required before work begins.
                </div>
                {contract.notes && (
                  <div className="mt-3 text-sm">
                    <span className="text-gray-700">Notes:</span>
                    <p className="mt-1 text-black whitespace-pre-wrap">{contract.notes}</p>
                  </div>
                )}
              </section>
            )}

            {/* Terms and Conditions */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Terms And Conditions</h2>
              <button
                type="button"
                onClick={() => setShowTerms(!showTerms)}
                aria-expanded={showTerms}
                aria-controls={showTerms ? 'agreement-terms' : undefined}
                className="flex min-h-[44px] items-center gap-2 text-indigo-700 hover:text-indigo-900 text-base font-medium"
              >
                <svg className={`w-4 h-4 transition-transform ${showTerms ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {showTerms ? 'Hide' : 'View'} Full Terms and Conditions
              </button>
              {showTerms && (
                <div
                  id="agreement-terms"
                  data-testid="agreement-terms"
                  tabIndex={0}
                  className="mt-4 p-4 bg-gray-50 rounded-lg max-h-96 overflow-y-auto text-base leading-relaxed text-[#2c2c2a] space-y-3"
                >
                  {isContingency || isRepair ? (
                    (isContingency ? CONTINGENCY_TERMS : REPAIR_TERMS).map((term) => <p key={term}>{term}</p>)
                  ) : (
                    INSTALLATION_TERMS.map((section) => (
                      <div key={section.title} className="space-y-1">
                        <h3 className="font-semibold">{section.title}</h3>
                        {section.content.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                      </div>
                    ))
                  )}
                </div>
              )}
              {!isContingency && !isRepair && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCancellation(!showCancellation)}
                    aria-expanded={showCancellation}
                    aria-controls={showCancellation ? 'notice-of-cancellation' : undefined}
                    className="mt-2 flex min-h-[44px] items-center gap-2 text-indigo-700 hover:text-indigo-900 text-base font-medium"
                  >
                    <svg className={`w-4 h-4 transition-transform ${showCancellation ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {NOTICE_OF_CANCELLATION_TITLE}
                  </button>
                  {showCancellation && (
                    <>
                    <p className="mt-2 text-base text-[#2c2c2a]">Dates below assume you sign today. Your copy shows the dates from when you actually sign.</p>
                    <div
                      id="notice-of-cancellation"
                      data-testid="notice-of-cancellation"
                      tabIndex={0}
                      className="mt-2 p-4 bg-gray-50 rounded-lg max-h-96 overflow-y-auto text-base leading-relaxed text-[#2c2c2a] space-y-3"
                    >
                      <h3 className="font-bold">{NOTICE_OF_CANCELLATION_TITLE}</h3>
                      <p>Date of Transaction: {cancellationNotice.transactionDate}</p>
                      <p className="font-bold">NOT LATER THAN MIDNIGHT OF: {cancellationNotice.deadline}</p>
                      <p className="whitespace-pre-wrap">{cancellationNotice.body}</p>
                      <p>{NOTICE_OF_CANCELLATION_CANCEL_LINE}</p>
                    </div>
                    </>
                  )}
                </>
              )}
            </section>

            {/* Customer Acknowledgements */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Customer Acknowledgements</h2>
              <p className="text-sm text-gray-600 mb-4">
                {isRepair
                  ? 'Add your initials below. If paying with insurance, initial that line too.'
                  : 'Please initial each acknowledgement below:'}
              </p>
              
              <div className="space-y-4">
                {isRepair && (
                  <div className="flex items-start gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <input
                      type="text"
                      placeholder="Initials"
                      value={initialsChangeOrders}
                      onChange={e => setInitialsChangeOrders(e.target.value.toUpperCase())}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-medium uppercase text-black bg-white"
                      style={{ color: '#000000' }}
                      maxLength={4}
                    />
                    <p className="text-sm text-black">
                      <strong>Scope:</strong> Only the work listed above—not extra work unless it is written in a change order.
                    </p>
                  </div>
                )}

                {!isContingency && !isRepair && (
                  <>
                <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="text"
                    placeholder="Initials"
                    value={initialsChangeOrders}
                    onChange={e => setInitialsChangeOrders(e.target.value.toUpperCase())}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-medium uppercase text-black bg-white"
                    style={{ color: '#000000' }}
                    maxLength={4}
                  />
                  <p className="text-sm text-black">
                    <strong>Change Orders:</strong> I understand additional work beyond the Base Scope requires a signed change order.
                  </p>
                </div>

                <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="text"
                    placeholder="Initials"
                    value={initialsPropertyCondition}
                    onChange={e => setInitialsPropertyCondition(e.target.value.toUpperCase())}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-medium uppercase text-black bg-white"
                    style={{ color: '#000000' }}
                    maxLength={4}
                  />
                  <p className="text-sm text-black">
                    <strong>Property Condition:</strong> I affirm there are no known structural defects (rotted rafters, sagging roof lines, etc.) other than disclosed in writing.
                  </p>
                </div>

                <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="text"
                    placeholder="Initials"
                    value={initialsLandscaping}
                    onChange={e => setInitialsLandscaping(e.target.value.toUpperCase())}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-medium uppercase text-black bg-white"
                    style={{ color: '#000000' }}
                    maxLength={4}
                  />
                  <p className="text-sm text-black">
                    <strong>Landscaping/Cosmetic Impacts:</strong> I understand incidental cosmetic impacts may occur as described in Section 8.
                  </p>
                </div>

                  </>
                )}

                {(isContingency || contract.payment_method === 'insurance') && (
                  <div className="flex items-start gap-4 p-3 bg-amber-50 rounded-lg">
                    <input
                      type="text"
                      placeholder="Initials"
                      value={initialsInsurance}
                      onChange={e => setInitialsInsurance(e.target.value.toUpperCase())}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-medium uppercase text-black bg-white"
                      style={{ color: '#000000' }}
                      maxLength={4}
                    />
                    <p className="text-sm text-black">
                      <strong>{isContingency ? 'Insurance Contingency:' : 'Insurance Funds:'}</strong> I agree to the insurance terms for this agreement.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Signature Block */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Signatures</h2>
              
              {/* Same statement as the PDF (lib/contracts/terms.ts); the repair and contingency PDFs print none. */}
              {!isRepair && !isContingency && (
                <div className="p-4 bg-gray-50 rounded-lg mb-6 text-base text-[#2c2c2a]">
                  <p>{INSTALLATION_SIGNING_STATEMENT}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Customer Signature */}
                <div>
                  <h3 className="font-medium text-black mb-3">Customer</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Print Name *</label>
                      <input
                        type="text"
                        value={printName}
                        onChange={e => setPrintName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        style={{ color: '#000000' }}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Signature *</label>
                      <SignaturePad
                        value={signature}
                        onChange={setSignature}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Date</label>
                      <input
                        type="text"
                        value={new Date().toLocaleDateString()}
                        disabled
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-black"
                      />
                    </div>
                  </div>
                </div>

                {/* Rep Signature (read-only) */}
                <div>
                  <h3 className="font-medium text-black mb-3">{brand.name}</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Print Name</label>
                      <input
                        type="text"
                        value={contract.rep_name}
                        disabled
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-black"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Signature</label>
                      {contract.rep_signature_data && (
                        <div className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                          <img 
                            src={contract.rep_signature_data} 
                            alt="Representative signature" 
                            className="h-16 mx-auto"
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Title</label>
                      <input
                        type="text"
                        value={contract.rep_title}
                        disabled
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-black"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Date</label>
                      <input
                        type="text"
                        value={new Date(contract.rep_signed_at).toLocaleDateString()}
                        disabled
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-black"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {consent && <ConsentBlock disclosure={consent} checked={consentAccepted} onChange={setConsentAccepted} />}

            {/* Submit Button */}
            <div className="sticky bottom-0 z-10 -mx-4 border-t bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:px-0 sm:pt-6 sm:pb-0">
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] py-3 px-4 bg-green-700 text-white font-semibold rounded-lg hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing Agreement...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Sign Agreement
                  </>
                )}
              </button>
              <p className="text-xs text-gray-700 text-center mt-3">
                By clicking "Sign Agreement", you agree to the terms and conditions above.
              </p>
            </div>
          </form>
        </div>

        {declineEnabled && <DeclineBox kind="contract" token={token} companyName={brand.name} onDeclined={() => setDeclined(true)} />}

        <p className="text-center text-sm text-gray-700 mt-6">
          {brand.legalName} | {brand.website}
        </p>
      </div>
    </div>
  )
}
