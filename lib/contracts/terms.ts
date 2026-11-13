import type { DocumentBrand } from '@/lib/org-brand'

/**
 * Contract terms — the ONE source (Nathan, 2026-11-06: the PDF wording wins). The signing screens
 * (app/contracts/sign, app/change-orders/sign) and the PDFs (generatePdf.ts, generateChangeOrderPdf.ts) both render
 * from this file, so what a customer reads before signing is what their signed PDF says.
 *
 * Signed contracts are stored PDFs and are never re-rendered from here: a wording change affects new signings only.
 * Any change here also changes the PDF golden hashes (lib/__tests__/fixtures/brand-documents-golden.json) — on purpose.
 * Clause wording still names the original company; per-company templates are multi-company slice 2b.
 */

export interface TermsSection {
  title: string
  content: readonly string[]
}

/** Installation Agreement — Terms And Conditions (PDF pages 3-5). */
export const INSTALLATION_TERMS: readonly TermsSection[] = [
  {
    title: 'Section 1 — Scope Of Work',
    content: [
      '1.1 ARX will furnish labor and materials necessary to perform the checked Scope of Work above, in a workmanlike manner, and in reasonable compliance with applicable North Carolina codes and permitting requirements.',
      '1.2 Standard Roof Replacement (if selected) generally includes: Tear-off and disposal of existing roofing materials. Underlayment, ice/water protection where code/conditions require, drip edge, flashings, and ventilation components as specified. Installation of new shingles/metal/roofing system per manufacturer instructions and code. Basic pipe boot/penetration flashing replacement as needed for the roofing system. Final cleanup and magnet sweep (see Section 8).',
      '1.3 Exclusions unless specifically included in writing: interior repairs (drywall/paint), mold remediation, structural framing/rafter repairs, electrical/HVAC, chimney/brick/masonry repairs, skylight interior trim, gutter guards, deck/porch repairs, and any work not expressly listed in this Agreement or a signed change order.',
    ],
  },
  {
    title: 'Section 2 — Payment',
    content: [
      '2.1 Final payment is due immediately upon Substantial Completion of the Work or upon approval of the completed scope by any insurance carrier, whichever occurs first. Customer\'s obligation to make final payment is not contingent upon receipt of insurance proceeds, recoverable depreciation, or supplemental payments.',
      '2.2 If any payment is not made when due, ARX may, upon written notice, suspend work until payment is received. Any unpaid balances may accrue interest at the rate of one and one-half percent (1.5%) per month or the maximum allowed by law, whichever is less. Customer agrees to pay reasonable costs of collection if amounts remain unpaid.',
    ],
  },
  {
    title: 'Section 3 — Property Conditions and Project Assumptions',
    content: [
      '3.1 Customer represents that, to the best of their knowledge, the Property is in reasonably suitable condition for the Work described in this Agreement and that no known structural defects, unsafe conditions, or code violations affecting the roofing system exist, except as disclosed to ARX in writing prior to execution of this Agreement.',
      '3.2 Customer acknowledges that roofing work is performed based on visual inspection and information reasonably available at the time of estimate. ARX is not responsible for pre-existing conditions, concealed defects, or conditions outside the Scope of Work that are not reasonably observable prior to commencement of the Work, including but not limited to deteriorated decking, framing issues, prior improper installations, or inadequate ventilation.',
      '3.3 Customer understands that roofing work may temporarily expose portions of the Property to the elements during installation. ARX will take reasonable measures to protect the Property while the Work is in progress; however, ARX is not responsible for damage caused by sudden or unforeseen weather events beyond ARX\'s control.',
      '3.4 Customer acknowledges that ARX does not guarantee the condition or performance of underlying structural components, decking, or prior construction not expressly included in the Scope of Work.',
    ],
  },
  {
    title: 'Section 4 — Hidden Conditions, Decking, and Code Upgrades',
    content: [
      '4.1 Roofing tear-off may reveal concealed damage or conditions not visible at the time of inspection (e.g., rotten decking, damaged flashing, multiple roof layers, inadequate ventilation, code-required items). These are outside the Base Scope unless specifically listed.',
      '4.2 Decking: Included Decking: First 3 sheets of 4\'x8\' OSB/plywood are included at no extra cost. Additional Decking, over the three sheets mentioned above, if needed at installation will be billed to customer via written change order. ARX will present documentation and obtain Customer approval before installing additional decking, except where immediate stabilization is required for safety or weather protection.',
      '4.3 If the permit authority, manufacturer instructions, or code require additional items (e.g., drip edge, starter strip, ventilation changes, ice/water coverage, flashing upgrades), Customer agrees these may be added via change order as necessary to complete a compliant installation.',
    ],
  },
  {
    title: 'Section 5 — Change Orders',
    content: [
      '5.1 Any work, materials, or price changes not included in the Base Scope must be documented in a written change order signed by both parties before proceeding, except as allowed in Section 4.2 for emergency stabilization.',
      '5.2 Change orders are due as stated on the change order; if not stated, they are due with the final payment.',
      '5.3 Any changes to the Scope of Work or price must be confirmed in a written change order signed by both parties. Verbal discussions or informal communications that are not incorporated into a written change order will not modify this Agreement.',
    ],
  },
  {
    title: 'Section 6 — Scheduling, Delays, and Access',
    content: [
      '6.1 Estimated dates are estimates only. Weather, permitting, inspections, supplier availability, and safety considerations may affect schedule. Delays caused by these factors do not constitute breach.',
      '6.2 Customer Access and Cooperation: Provide reasonable access to the work area, driveway, electrical power (if needed), and water (if needed). Secure pets and keep children away from the work area and debris. Identify sprinkler heads, invisible fences, septic components, and any known hazards before work begins.',
      '6.3 Customer is responsible for utilities and for notifying ARX of any special utility shutoffs or restrictions.',
      '6.4 Customer authorizes ARX to take photographs or videos of the Property before, during, and after the Work for documentation, quality control, warranty, insurance, and training purposes. Any use for marketing or promotional materials will not include personally identifying information without Customer consent.',
      '6.5 ARX may temporarily suspend work when necessary due to unsafe conditions, weather events, or protection of the Property. Such suspension will not constitute a breach of this Agreement.',
    ],
  },
  {
    title: 'Section 7 — Permits, Inspections, and Compliance',
    content: [
      '7.1 ARX will obtain required permits and schedule inspections when included/required. Permit/inspection fees are included in total project price.',
      '7.2 Customer is responsible for providing HOA approvals and any architectural guidelines unless explicitly included in writing.',
      '7.3 ARX may use qualified subcontractors and remains responsible for the contracted work.',
    ],
  },
  {
    title: 'Section 8 — Job Site Protection, Cleanup, and Cosmetic Damage',
    content: [
      '8.1 ARX will take reasonable steps to protect landscaping and exterior features; however, exterior construction can cause incidental impacts.',
      '8.2 ARX will remove project debris and perform a magnet sweep. Customer acknowledges that small nails/fasteners may remain despite reasonable efforts.',
      '8.3 ARX is not responsible for ordinary incidental/cosmetic impacts (e.g., scuffs, minor lawn divots, disturbed mulch) unless caused by ARX\'s gross negligence or willful misconduct.',
      '8.4 Customer acknowledges heavy vehicles/materials may affect asphalt, pavers, or decorative concrete; pre-existing cracks/settling may worsen.',
    ],
  },
  {
    title: 'Section 9 — Warranties',
    content: [
      '9.1 ARX warrants labor/workmanship against defects for five (5) years from the date of Substantial Completion. This covers installation-related defects only.',
      '9.2 ARX provides a one (1) year no-leak guarantee on ARX workmanship, conditioned on proper attic ventilation, drainage, and no third-party alterations.',
      '9.3 Roofing materials are warranted solely by their manufacturers. ARX makes no independent warranty regarding material performance beyond applicable manufacturer warranties. Copies are available upon request.',
      '9.4 Claims must be submitted in writing to info@arxroofing.com within ten (10) business days of discovery. ARX may inspect before performing warranty work.',
    ],
  },
  {
    title: 'Section 10 — Warranty Exclusions',
    content: [
      'Workmanship and leak warranties do not cover: Storm/Act of God events (hail, wind, lightning, tornado, heavy rain, hurricane, tree impact). Foot traffic, misuse, abuse, vandalism, or tampering by Customer or third parties. Improper attic ventilation, condensation, gutter/backflow issues, ice dams, or building movement/settlement. Pre-existing structural conditions, substrate failures, rotten rafters, sagging roof lines, or latent defects. Mold, mildew, algae, fungus, or moisture-related damage not directly caused by ARX workmanship. Normal wear and tear, fading, cosmetic changes, and minor waviness/telegraphing of decking irregularities. Damage caused by other trades, antennas/satellites, solar installers, HVAC work, or unapproved repairs. Roof penetrations, modifications, or attachments made by others, whether occurring before or after ARX\'s work.',
    ],
  },
  {
    title: 'Section 11 — Insurance Claim Projects (If Applicable)',
    content: [
      '11.1 Customer remains responsible for: (a) the deductible; (b) non-covered upgrades or exclusions; and (c) any amounts not paid by the carrier.',
      '11.2 If insurance funds are issued to Customer, Customer agrees to promptly endorse/submit those funds to ARX for completed work. Customer agrees that recoverable depreciation is considered payment for completed work once approved by the carrier and shall be promptly remitted to ARX.',
      '11.3 ARX will not waive deductibles or offer improper inducements. Customer agrees not to request such waivers.',
    ],
  },
  {
    title: 'Section 12 — Termination and Ownership of Materials',
    content: [
      '12.1 This Agreement begins on the signing date and ends upon completion and payment, unless terminated under this Section.',
      '12.2 If this is a home-solicitation sale or otherwise subject to a 3-business-day right to cancel, Customer may cancel as stated in the attached Notice of Cancellation.',
      '12.3 If Customer terminates after work begins, Customer will pay for work performed and costs incurred to date (labor, materials ordered, permits, disposal) less any amounts already paid.',
      '12.4 Once materials are delivered to the Property, risk of loss due to theft, vandalism, or weather generally transfers to Customer, except to the extent caused by ARX\'s negligence while materials are under ARX\'s control.',
    ],
  },
  {
    title: 'Section 13 — Limitation of Liability',
    content: [
      '13.1 ARX disclaims liability for damages resulting from misuse, abuse, unauthorized modifications/repairs, vandalism, or damage caused by Customer/third parties, or by fire, storms, or other Acts of God.',
      '13.2 To the fullest extent permitted by law, ARX will not be liable for indirect, incidental, special, consequential, or economic damages (including loss of use, lost profits, or diminution in value).',
      '13.3 ARX\'s total liability for any claim arising out of this Agreement will not exceed the amounts actually paid to ARX under this Agreement, except for damages caused by ARX\'s gross negligence or willful misconduct where such limitation is prohibited by law.',
    ],
  },
  {
    title: 'Section 14 — Dispute Resolution; Attorneys\' Fees',
    content: [
      '14.1 The parties will first attempt to resolve disputes informally within ten (10) business days after written notice.',
      '14.2 Unless prohibited by law, any lawsuit must be filed in the state or federal courts located in or serving Cabarrus County, North Carolina.',
      '14.3 In any action to enforce this Agreement, the prevailing party may recover reasonable attorneys\' fees and costs to the extent permitted by law.',
    ],
  },
  {
    title: 'Section 15 — Entire Agreement; Signatures; Authority',
    content: [
      '15.1 This Agreement (including exhibits/change orders) is the entire understanding and supersedes all prior discussions, proposals, and representations, whether oral or written.',
      '15.2 Any amendment must be in writing and signed by both parties.',
      '15.3 Customer acknowledges they are contracting with ARX Roofing & Exteriors LLC and that any salesperson/representative is acting as an authorized representative only to the extent of this written Agreement.',
      '15.4 If any provision is held unenforceable, the remaining provisions remain in effect.',
      '15.5 Signatures may be executed electronically and will be treated as original signatures.',
    ],
  },
  ]

/** Insurance Contingency Agreement — Terms. */
export const CONTINGENCY_TERMS: readonly string[] = [
  '1. Purpose. Customer authorizes ARX to inspect, document, estimate, and communicate with the insurance carrier about exterior storm damage. This agreement does not authorize construction work.',
  '2. Contingency. Customer has no obligation to move forward unless the insurance carrier approves the claim and ARX accepts the approved scope and price.',
  '3. Contractor Selection. If the claim, scope, and price are approved, Customer agrees to use ARX for the approved exterior work, subject to a final Installation Agreement before construction starts.',
  '4. Customer Costs. Customer remains responsible for the deductible, upgrades, non-covered work, code items not paid by insurance, and signed change orders. ARX will not waive deductibles or offer improper inducements.',
  '5. Claim Help. ARX may provide photos, measurements, estimates, supplements, and meeting support. ARX is not a public adjuster and does not decide coverage.',
  '6. No Construction Start. Materials are not ordered and work does not start until the final Installation Agreement is signed.',
  '7. Cancellation. Customer may cancel within any required 3-business-day cancellation period and before the final Installation Agreement. If Customer asks ARX to incur outside costs, Customer will reimburse documented costs.',
  '8. Photos And Communication. Customer authorizes ARX to take photos/video for claim documentation, quality control, training, and project records.',
  ]

/** Repair Agreement — Terms. */
export const REPAIR_TERMS: readonly string[] = [
  '1. Only the work and price on this page count. That can be roofing, gutters, siding, or other repairs—whatever is listed. Not a whole new roof or whole building unless we say so in writing.',
  '2. Anything not listed needs a written change order before we do it.',
  '3. ARX only stands behind the work ARX does here—not old damage, hidden issues, other parts of the home, or other companies\' work.',
  '4. Dates are approximate. Rain, supplies, permits, or access can slow things down.',
  '5. You pay what this page says. With insurance, you still pay deductible, upgrades, and what insurance does not pay unless we agree in writing.',
  '6. You let us into the work area. We may take photos or measurements for the job and our files.',
  '7. Signing on a phone or computer still counts.',
  ]

/** Installation agreement signing statement (printed above the signatures on the PDF and shown on the signing screen). */
export const INSTALLATION_SIGNING_STATEMENT =
  'By signing below, the undersigned represents that (i) he or she has read the above Order Form and the Terms and Conditions (collectively, the "Agreement") in its entirety, and (ii) he or she agrees to be bound by the terms and conditions of the Agreement.'

export type InstallationAcknowledgementKey = 'changeOrders' | 'propertyCondition' | 'color' | 'landscaping'

export interface InstallationAcknowledgement {
  key: InstallationAcknowledgementKey
  label: string
  text: string
}

/**
 * Installation Agreement — "Customer Acknowledgements" (initialed), shared by the signing screen and PDF page 6.
 * Landscaping/cosmetic impacts is covered by Section 8, so it is no longer initialed (Nathan, 2026-11-12); Color replaced
 * it. The rep types the color when sending the agreement (order_form_contracts.roof_color).
 * A contract signed before this change keeps its landscaping line (it has landscaping initials and no color), so a
 * re-rendered old PDF still shows what the customer initialed. A contract sent before this change and still unsigned has
 * neither: it is initialed on the two lines it has.
 */
export const COLOR_ACKNOWLEDGEMENT_LABEL = 'Color'
export const colorAcknowledgementText = (color: string) => `I confirm the color I selected is ${color}.`

export function cleanRoofColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.replace(/\s+/g, ' ').trim()
  return v.length > 0 && v.length <= 120 ? v : null
}

export function installationAcknowledgements(contract: {
  roof_color?: string | null
  customer_initials_landscaping?: string | null
}): InstallationAcknowledgement[] {
  const list: InstallationAcknowledgement[] = [
    { key: 'changeOrders', label: 'Change Orders', text: 'I understand additional work beyond the Base Scope requires a signed change order.' },
    { key: 'propertyCondition', label: 'Property Condition', text: 'I affirm there are no known structural defects (rotted rafters, sagging roof lines, etc.) other than disclosed in writing.' },
  ]
  const color = cleanRoofColor(contract.roof_color)
  if (color) {
    list.push({ key: 'color', label: COLOR_ACKNOWLEDGEMENT_LABEL, text: colorAcknowledgementText(color) })
  } else if (contract.customer_initials_landscaping) {
    list.push({ key: 'landscaping', label: 'Landscaping/Cosmetic Impacts', text: 'I understand incidental cosmetic impacts may occur as described in Section 8.' })
  }
  return list
}

/** Change order — the agreement sentence above the signatures. */
export const CHANGE_ORDER_AGREEMENT =
  'By signing below, both parties agree to the changes described above. The customer acknowledges that the updated total project cost and remaining balance are accurate.'

export const NOTICE_OF_CANCELLATION_TITLE = 'Notice of Cancellation'
export const NOTICE_OF_CANCELLATION_CANCEL_LINE = 'I HEREBY CANCEL THIS TRANSACTION.'

export function formatContractDate(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date)
  let count = 0
  while (count < days) {
    result.setDate(result.getDate() + 1)
    const dayOfWeek = result.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++
    }
  }
  return result
}

export interface CancellationNotice {
  /** "Date of Transaction" value — the signing date (the signing screen passes today, "as if signed now"). */
  transactionDate: string
  /** "NOT LATER THAN MIDNIGHT OF" value. */
  deadline: string
  /** The notice body, line breaks as on the PDF. */
  body: string
}

/**
 * Installation Agreement — Notice of Cancellation (PDF page 7). The deadline is 3 business days from the signing time,
 * or from now when not signed yet (the signing screen) — the same computation the PDF has always used.
 */
export function noticeOfCancellation(
  signedAt: string | undefined,
  brand: Pick<DocumentBrand, 'legalName' | 'addressLines'>,
): CancellationNotice {
  const signingDate = signedAt ? new Date(signedAt) : new Date()
  const cancellationDeadline = addBusinessDays(signingDate, 3)
  const deadline = formatContractDate(cancellationDeadline.toISOString())
  const body = `You may CANCEL this transaction, without any Penalty or Obligation, within THREE BUSINESS DAYS from the above date.

If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within TEN BUSINESS DAYS following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be cancelled.

If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller's expense and risk.

If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation.

To cancel this transaction, mail or deliver a signed and dated copy of this cancellation notice or any other written notice to:

${[brand.legalName, ...brand.addressLines].join('\n')}

NOT LATER THAN MIDNIGHT OF ${deadline}`
  return { transactionDate: formatContractDate(signedAt), deadline, body }
}
