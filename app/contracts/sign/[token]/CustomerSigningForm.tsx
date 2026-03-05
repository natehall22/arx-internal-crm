'use client'

import { useState } from 'react'
import SignaturePad from '@/components/contracts/SignaturePad'

interface Contract {
  id: string
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
}

const TERMS_AND_CONDITIONS = `
Section 1 — Scope Of Work
1.1 ARX will furnish labor and materials necessary to perform the checked Scope of Work above, in a workmanlike manner, and in reasonable compliance with applicable North Carolina codes and permitting requirements.
1.2 Standard Roof Replacement (if selected) generally includes: Tear-off and disposal of existing roofing materials. Underlayment, ice/water protection where code/conditions require, drip edge, flashings, and ventilation components as specified. Installation of new shingles/metal/roofing system per manufacturer instructions and code. Basic pipe boot/penetration flashing replacement as needed for the roofing system. Final cleanup and magnet sweep (see Section 8).
1.3 Exclusions unless specifically included in writing: interior repairs (drywall/paint), mold remediation, structural framing/rafter repairs, electrical/HVAC, chimney/brick/masonry repairs, skylight interior trim, gutter guards, deck/porch repairs, and any work not expressly listed in this Agreement or a signed change order.

Section 2 — Payment
2.1 Final payment is due immediately upon Substantial Completion of the Work or upon approval of the completed scope by any insurance carrier, whichever occurs first. Customer's obligation to make final payment is not contingent upon receipt of insurance proceeds, recoverable depreciation, or supplemental payments.
2.2 If any payment is not made when due, ARX may, upon written notice, suspend work until payment is received. Any unpaid balances may accrue interest at the rate of one and one-half percent (1.5%) per month or the maximum allowed by law, whichever is less. Customer agrees to pay reasonable costs of collection if amounts remain unpaid.

Section 3 — Property Conditions and Project Assumptions
3.1 Customer represents that, to the best of their knowledge, the Property is in reasonably suitable condition for the Work described in this Agreement and that no known structural defects, unsafe conditions, or code violations affecting the roofing system exist, except as disclosed to ARX in writing prior to execution of this Agreement.
3.2 Customer acknowledges that roofing work is performed based on visual inspection and information reasonably available at the time of estimate. ARX is not responsible for pre-existing conditions, concealed defects, or conditions outside the Scope of Work that are not reasonably observable prior to commencement of the Work, including but not limited to deteriorated decking, framing issues, prior improper installations, or inadequate ventilation.
3.3 Customer understands that roofing work may temporarily expose portions of the Property to the elements during installation. ARX will take reasonable measures to protect the Property while the Work is in progress; however, ARX is not responsible for damage caused by sudden or unforeseen weather events beyond ARX's control.
3.4 Customer acknowledges that ARX does not guarantee the condition or performance of underlying structural components, decking, or prior construction not expressly included in the Scope of Work.

Section 4 — Hidden Conditions, Decking, and Code Upgrades
4.1 Roofing tear-off may reveal concealed damage or conditions not visible at the time of inspection (e.g., rotten decking, damaged flashing, multiple roof layers, inadequate ventilation, code-required items). These are outside the Base Scope unless specifically listed.
4.2 Decking: Included Decking: First 3 sheets of 4'x8' OSB/plywood are included at no extra cost. Additional Decking, over the three sheets mentioned above, if needed at installation will be billed to customer via written change order. ARX will present documentation and obtain Customer approval before installing additional decking, except where immediate stabilization is required for safety or weather protection.
4.3 If the permit authority, manufacturer instructions, or code require additional items (e.g., drip edge, starter strip, ventilation changes, ice/water coverage, flashing upgrades), Customer agrees these may be added via change order as necessary to complete a compliant installation.

Section 5 — Change Orders
5.1 Any work, materials, or price changes not included in the Base Scope must be documented in a written change order signed by both parties before proceeding, except as allowed in Section 4.2 for emergency stabilization.
5.2 Change orders are due as stated on the change order; if not stated, they are due with the final payment.
5.3 Any changes to the Scope of Work or price must be confirmed in a written change order signed by both parties. Verbal discussions or informal communications that are not incorporated into a written change order will not modify this Agreement.

Section 6 — Scheduling, Delays, and Access
6.1 Estimated dates are estimates only. Weather, permitting, inspections, supplier availability, and safety considerations may affect schedule. Delays caused by these factors do not constitute breach.
6.2 Customer Access and Cooperation: Provide reasonable access to the work area, driveway, electrical power (if needed), and water (if needed). Secure pets and keep children away from the work area and debris. Identify sprinkler heads, invisible fences, septic components, and any known hazards before work begins.
6.3 Customer is responsible for utilities and for notifying ARX of any special utility shutoffs or restrictions.
6.4 Customer authorizes ARX to take photographs or videos of the Property before, during, and after the Work for documentation, quality control, warranty, insurance, and training purposes. Any use for marketing or promotional materials will not include personally identifying information without Customer consent.
6.5 ARX may temporarily suspend work when necessary due to unsafe conditions, weather events, or protection of the Property. Such suspension will not constitute a breach of this Agreement.

Section 7 — Permits, Inspections, and Compliance
7.1 ARX will obtain required permits and schedule inspections when included/required. Permit/inspection fees are included in total project price.
7.2 Customer is responsible for providing HOA approvals and any architectural guidelines unless explicitly included in writing.
7.3 ARX may use qualified subcontractors and remains responsible for the contracted work.

Section 8 — Job Site Protection, Cleanup, and Cosmetic Damage
8.1 ARX will take reasonable steps to protect landscaping and exterior features; however, exterior construction can cause incidental impacts.
8.2 ARX will remove project debris and perform a magnet sweep. Customer acknowledges that small nails/fasteners may remain despite reasonable efforts.
8.3 ARX is not responsible for ordinary incidental/cosmetic impacts (e.g., scuffs, minor lawn divots, disturbed mulch) unless caused by ARX's gross negligence or willful misconduct.
8.4 Customer acknowledges heavy vehicles/materials may affect asphalt, pavers, or decorative concrete; pre-existing cracks/settling may worsen.

Section 9 — Warranties
9.1 ARX warrants labor/workmanship against defects for five (5) years from the date of Substantial Completion. This covers installation-related defects only.
9.2 ARX provides a one (1) year no-leak guarantee on ARX workmanship, conditioned on proper attic ventilation, drainage, and no third-party alterations.
9.3 Roofing materials are warranted solely by their manufacturers. ARX makes no independent warranty regarding material performance beyond applicable manufacturer warranties. Copies are available upon request.
9.4 Claims must be submitted in writing to info@arxroofing.com within ten (10) business days of discovery. ARX may inspect before performing warranty work.

Section 10 — Warranty Exclusions
Workmanship and leak warranties do not cover: Storm/Act of God events (hail, wind, lightning, tornado, heavy rain, hurricane, tree impact). Foot traffic, misuse, abuse, vandalism, or tampering by Customer or third parties. Improper attic ventilation, condensation, gutter/backflow issues, ice dams, or building movement/settlement. Pre-existing structural conditions, substrate failures, rotten rafters, sagging roof lines, or latent defects. Mold, mildew, algae, fungus, or moisture-related damage not directly caused by ARX workmanship. Normal wear and tear, fading, cosmetic changes, and minor waviness/telegraphing of decking irregularities. Damage caused by other trades, antennas/satellites, solar installers, HVAC work, or unapproved repairs. Roof penetrations, modifications, or attachments made by others, whether occurring before or after ARX's work.

Section 11 — Insurance Claim Projects (If Applicable)
11.1 Customer remains responsible for: (a) the deductible; (b) non-covered upgrades or exclusions; and (c) any amounts not paid by the carrier.
11.2 If insurance funds are issued to Customer, Customer agrees to promptly endorse/submit those funds to ARX for completed work. Customer agrees that recoverable depreciation is considered payment for completed work once approved by the carrier and shall be promptly remitted to ARX.
11.3 ARX will not waive deductibles or offer improper inducements. Customer agrees not to request such waivers.

Section 12 — Termination and Ownership of Materials
12.1 This Agreement begins on the signing date and ends upon completion and payment, unless terminated under this Section.
12.2 If this is a home-solicitation sale or otherwise subject to a 3-business-day right to cancel, Customer may cancel as stated in the attached Notice of Cancellation.
12.3 If Customer terminates after work begins, Customer will pay for work performed and costs incurred to date (labor, materials ordered, permits, disposal) less any amounts already paid.
12.4 Once materials are delivered to the Property, risk of loss due to theft, vandalism, or weather generally transfers to Customer, except to the extent caused by ARX's negligence while materials are under ARX's control.

Section 13 — Limitation of Liability
13.1 ARX disclaims liability for damages resulting from misuse, abuse, unauthorized modifications/repairs, vandalism, or damage caused by Customer/third parties, or by fire, storms, or other Acts of God.
13.2 To the fullest extent permitted by law, ARX will not be liable for indirect, incidental, special, consequential, or economic damages (including loss of use, lost profits, or diminution in value).
13.3 ARX's total liability for any claim arising out of this Agreement will not exceed the amounts actually paid to ARX under this Agreement, except for damages caused by ARX's gross negligence or willful misconduct where such limitation is prohibited by law.

Section 14 — Dispute Resolution; Attorneys' Fees
14.1 The parties will first attempt to resolve disputes informally within ten (10) business days after written notice.
14.2 Unless prohibited by law, any lawsuit must be filed in the state or federal courts located in or serving Cabarrus County, North Carolina.
14.3 In any action to enforce this Agreement, the prevailing party may recover reasonable attorneys' fees and costs to the extent permitted by law.

Section 15 — Entire Agreement; Signatures; Authority
15.1 This Agreement (including exhibits/change orders) is the entire understanding and supersedes all prior discussions, proposals, and representations, whether oral or written.
15.2 Any amendment must be in writing and signed by both parties.
15.3 Customer acknowledges they are contracting with ARX Roofing & Exteriors LLC and that any salesperson/representative is acting as an authorized representative only to the extent of this written Agreement.
15.4 If any provision is held unenforceable, the remaining provisions remain in effect.
15.5 Signatures may be executed electronically and will be treated as original signatures.
`

export default function CustomerSigningForm({ contract, token }: CustomerSigningFormProps) {
  const [preferredContact, setPreferredContact] = useState<'phone' | 'email'>('phone')
  const [printName, setPrintName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  
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
      setError('Please sign the contract')
      return
    }
    if (!initialsChangeOrders || !initialsPropertyCondition || !initialsLandscaping) {
      setError('Please initial all acknowledgement sections')
      return
    }
    if (contract.payment_method === 'insurance' && !initialsInsurance) {
      setError('Please initial the insurance acknowledgement section')
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
          initialsChangeOrders,
          initialsPropertyCondition,
          initialsLandscaping,
          initialsInsurance: contract.payment_method === 'insurance' ? initialsInsurance : null,
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

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Contract Signed Successfully!</h1>
          <p className="text-gray-600 mb-4">
            Thank you for signing. A copy of the signed contract has been sent to your email.
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
              Download Signed Contract
            </a>
          )}
          <p className="text-sm text-gray-500 mt-6">
            ARX Roofing & Exteriors LLC<br />
            704-313-8834 | info@arxroofing.com
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-900 text-white p-6 text-center">
            <h1 className="text-2xl font-bold">ARX ROOFING & EXTERIORS LLC</h1>
            <p className="text-indigo-200 text-sm mt-1">
              4101 Woodbury Terrace NW, Concord, NC 28027
            </p>
            <p className="text-indigo-200 text-sm">
              Phone: 704-313-8834 | Email: info@arxroofing.com
            </p>
            <div className="mt-4 inline-block bg-white text-indigo-900 px-4 py-2 rounded-lg font-bold">
              Order Form
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-8">
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
                  <span className="text-gray-500">Customer Name(s):</span>
                  <span className="ml-2 font-medium text-black">{contract.customer_name}</span>
                </div>
                <div>
                  <span className="text-gray-500">Project Address:</span>
                  <span className="ml-2 font-medium text-black">{contract.project_address}</span>
                </div>
                <div>
                  <span className="text-gray-500">Phone Number:</span>
                  <span className="ml-2 font-medium text-black">{contract.customer_phone || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Email:</span>
                  <span className="ml-2 font-medium text-black">{contract.customer_email || 'N/A'}</span>
                </div>
              </div>
              
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Method Of Contact *
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="preferredContact"
                      value="phone"
                      checked={preferredContact === 'phone'}
                      onChange={() => setPreferredContact('phone')}
                      className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm">Phone</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="preferredContact"
                      value="email"
                      checked={preferredContact === 'email'}
                      onChange={() => setPreferredContact('email')}
                      className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm">Email</span>
                  </label>
                </div>
              </div>
            </section>

            {/* Project Details */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Project Details</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-gray-500">Scope Of Work:</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {contract.scope_roof_replacement && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Roof Replacement</span>}
                    {contract.scope_roof_repair && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Roof Repair</span>}
                    {contract.scope_gutters && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Gutters</span>}
                    {contract.scope_siding && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">Siding</span>}
                    {contract.scope_other && <span className="px-2 py-1 bg-indigo-100 text-black font-medium rounded">{contract.scope_other}</span>}
                  </div>
                </div>
                {contract.roofing_material && (
                  <div>
                    <span className="text-gray-500">Primary Roofing System:</span>
                    <span className="ml-2 font-medium text-black">{contract.roofing_material}</span>
                  </div>
                )}
                {contract.total_squares && (
                  <div>
                    <span className="text-gray-500">Total Squares:</span>
                    <span className="ml-2 font-medium text-black">{contract.total_squares}</span>
                  </div>
                )}
                <div>
                  <span className="text-gray-500">Project Cost:</span>
                  <span className="ml-2 font-medium text-lg text-black">${contract.project_cost.toLocaleString()}</span>
                </div>
                {contract.est_completion_date && (
                  <div>
                    <span className="text-gray-500">Est. Completion Date:</span>
                    <span className="ml-2 font-medium text-black">{new Date(contract.est_completion_date).toLocaleDateString()}</span>
                  </div>
                )}
                {contract.exclusions && (
                  <div>
                    <span className="text-gray-500">Exclusions / Observations:</span>
                    <p className="mt-1 text-black whitespace-pre-wrap">{contract.exclusions}</p>
                  </div>
                )}
                {contract.additional_products && (
                  <div>
                    <span className="text-gray-500">Additional Products:</span>
                    <p className="mt-1 text-black whitespace-pre-wrap">{contract.additional_products}</p>
                  </div>
                )}
              </div>
            </section>

            {/* Payment Details */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Payment Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Payment Method:</span>
                  <span className="ml-2 font-medium capitalize text-black">
                    {contract.payment_method}
                    {contract.finance_company && ` (${contract.finance_company})`}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Deposit (Due At Signing):</span>
                  <span className="ml-2 font-medium text-black">${contract.deposit_amount.toLocaleString()}</span>
                </div>
              </div>
              {contract.notes && (
                <div className="mt-3 text-sm">
                  <span className="text-gray-500">Notes:</span>
                  <p className="mt-1 text-black whitespace-pre-wrap">{contract.notes}</p>
                </div>
              )}
            </section>

            {/* Terms and Conditions */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Terms And Conditions</h2>
              <button
                type="button"
                onClick={() => setShowTerms(!showTerms)}
                className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              >
                <svg className={`w-4 h-4 transition-transform ${showTerms ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {showTerms ? 'Hide' : 'View'} Full Terms and Conditions
              </button>
              {showTerms && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg max-h-96 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">
                  {TERMS_AND_CONDITIONS}
                </div>
              )}
            </section>

            {/* Customer Acknowledgements */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Customer Acknowledgements</h2>
              <p className="text-sm text-gray-600 mb-4">Please initial each acknowledgement below:</p>
              
              <div className="space-y-4">
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

                {contract.payment_method === 'insurance' && (
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
                      <strong>Insurance Funds:</strong> I agree to Section 11 regarding insurance claim projects.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Signature Block */}
            <section>
              <h2 className="text-lg font-bold text-black border-b pb-2 mb-4">Signatures</h2>
              
              <div className="p-4 bg-gray-50 rounded-lg mb-6 text-sm text-black">
                By signing below, the undersigned represents that (i) he or she has read the above Order Form and the Terms and Conditions (collectively, the "Agreement") in its entirety, and (ii) he or she agrees to be bound by the terms and conditions of the Agreement.
              </div>

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
                  <h3 className="font-medium text-black mb-3">ARX Roofing & Exteriors</h3>
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

            {/* Submit Button */}
            <div className="pt-6 border-t">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing Contract...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Sign Contract
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 text-center mt-3">
                By clicking "Sign Contract", you agree to the terms and conditions above.
              </p>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          ARX Roofing & Exteriors LLC | arxroofing.com
        </p>
      </div>
    </div>
  )
}
