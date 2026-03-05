import { Document, Page, Text, View, StyleSheet, Image, pdf } from '@react-pdf/renderer'
import { createElement } from 'react'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  coverPage: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  header: {
    textAlign: 'center',
    marginBottom: 20,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  companyInfo: {
    fontSize: 9,
    color: '#666',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 40,
    padding: 10,
    borderWidth: 2,
    borderColor: '#000',
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    width: 150,
    color: '#666',
  },
  value: {
    flex: 1,
    fontWeight: 'bold',
  },
  scopeItem: {
    marginRight: 15,
    padding: '2 6',
    backgroundColor: '#f0f0f0',
  },
  signatureBlock: {
    flexDirection: 'row',
    marginTop: 20,
  },
  signatureColumn: {
    flex: 1,
    padding: 10,
  },
  signatureLabel: {
    fontSize: 9,
    color: '#666',
    marginBottom: 4,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    marginBottom: 4,
    height: 40,
  },
  signatureImage: {
    height: 40,
    marginBottom: 4,
    objectFit: 'contain',
  },
  termsText: {
    fontSize: 8,
    lineHeight: 1.4,
    textAlign: 'justify',
  },
  termsSection: {
    marginBottom: 10,
  },
  termsSectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  acknowledgementRow: {
    flexDirection: 'row',
    marginBottom: 8,
    padding: 8,
    backgroundColor: '#f9f9f9',
  },
  initialsBox: {
    width: 50,
    height: 20,
    borderWidth: 1,
    borderColor: '#000',
    marginRight: 10,
    textAlign: 'center',
    paddingTop: 4,
    fontWeight: 'bold',
  },
  acknowledgementText: {
    flex: 1,
    fontSize: 9,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: '#666',
  },
  auditFooter: {
    fontSize: 7,
    color: '#999',
    marginTop: 10,
    textAlign: 'center',
  },
  checklistItem: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  checkbox: {
    width: 12,
    height: 12,
    borderWidth: 1,
    borderColor: '#000',
    marginRight: 8,
  },
  legalText: {
    fontSize: 8,
    fontStyle: 'italic',
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#f9f9f9',
  },
  cancellationBox: {
    borderWidth: 2,
    borderColor: '#000',
    padding: 15,
    marginTop: 20,
  },
  cancellationTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
})

interface ContractData {
  id: string
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
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
  preferred_contact: string | null
  customer_print_name: string | null
  customer_initials_change_orders: string | null
  customer_initials_property_condition: string | null
  customer_initials_landscaping: string | null
  customer_initials_insurance: string | null
  rep_name: string
  rep_title: string
  rep_signature_data: string
  rep_signed_at: string
  customer_signature_data: string | null
  customer_signed_at: string | null
  customer_ip: string | null
}

const TERMS_SECTIONS = [
  {
    title: 'Section 1 — Scope Of Work',
    content: `1.1 ARX will furnish labor and materials necessary to perform the checked Scope of Work above, in a workmanlike manner, and in reasonable compliance with applicable North Carolina codes and permitting requirements.
1.2 Standard Roof Replacement (if selected) generally includes: Tear-off and disposal of existing roofing materials. Underlayment, ice/water protection where code/conditions require, drip edge, flashings, and ventilation components as specified. Installation of new shingles/metal/roofing system per manufacturer instructions and code. Basic pipe boot/penetration flashing replacement as needed for the roofing system. Final cleanup and magnet sweep (see Section 8).
1.3 Exclusions unless specifically included in writing: interior repairs (drywall/paint), mold remediation, structural framing/rafter repairs, electrical/HVAC, chimney/brick/masonry repairs, skylight interior trim, gutter guards, deck/porch repairs, and any work not expressly listed in this Agreement or a signed change order.`,
  },
  {
    title: 'Section 2 — Payment',
    content: `2.1 Final payment is due immediately upon Substantial Completion of the Work or upon approval of the completed scope by any insurance carrier, whichever occurs first. Customer's obligation to make final payment is not contingent upon receipt of insurance proceeds, recoverable depreciation, or supplemental payments.
2.2 If any payment is not made when due, ARX may, upon written notice, suspend work until payment is received. Any unpaid balances may accrue interest at the rate of one and one-half percent (1.5%) per month or the maximum allowed by law, whichever is less. Customer agrees to pay reasonable costs of collection if amounts remain unpaid.`,
  },
  {
    title: 'Section 3 — Property Conditions and Project Assumptions',
    content: `3.1 Customer represents that, to the best of their knowledge, the Property is in reasonably suitable condition for the Work described in this Agreement and that no known structural defects, unsafe conditions, or code violations affecting the roofing system exist, except as disclosed to ARX in writing prior to execution of this Agreement.
3.2 Customer acknowledges that roofing work is performed based on visual inspection and information reasonably available at the time of estimate. ARX is not responsible for pre-existing conditions, concealed defects, or conditions outside the Scope of Work that are not reasonably observable prior to commencement of the Work.
3.3 Customer understands that roofing work may temporarily expose portions of the Property to the elements during installation. ARX will take reasonable measures to protect the Property while the Work is in progress.
3.4 Customer acknowledges that ARX does not guarantee the condition or performance of underlying structural components, decking, or prior construction not expressly included in the Scope of Work.`,
  },
  {
    title: 'Section 4 — Hidden Conditions, Decking, and Code Upgrades',
    content: `4.1 Roofing tear-off may reveal concealed damage or conditions not visible at the time of inspection. These are outside the Base Scope unless specifically listed.
4.2 Decking: First 3 sheets of 4'x8' OSB/plywood are included at no extra cost. Additional Decking will be billed via written change order.
4.3 If the permit authority, manufacturer instructions, or code require additional items, Customer agrees these may be added via change order.`,
  },
  {
    title: 'Section 5 — Change Orders',
    content: `5.1 Any work, materials, or price changes not included in the Base Scope must be documented in a written change order signed by both parties before proceeding.
5.2 Change orders are due as stated on the change order; if not stated, they are due with the final payment.
5.3 Verbal discussions or informal communications that are not incorporated into a written change order will not modify this Agreement.`,
  },
  {
    title: 'Section 6 — Scheduling, Delays, and Access',
    content: `6.1 Estimated dates are estimates only. Weather, permitting, inspections, supplier availability, and safety considerations may affect schedule.
6.2 Customer Access and Cooperation: Provide reasonable access to the work area, driveway, electrical power, and water. Secure pets and keep children away from the work area.
6.3 Customer is responsible for utilities and for notifying ARX of any special utility shutoffs or restrictions.
6.4 Customer authorizes ARX to take photographs or videos of the Property for documentation, quality control, warranty, insurance, and training purposes.
6.5 ARX may temporarily suspend work when necessary due to unsafe conditions, weather events, or protection of the Property.`,
  },
  {
    title: 'Section 7 — Permits, Inspections, and Compliance',
    content: `7.1 ARX will obtain required permits and schedule inspections when included/required. Permit/inspection fees are included in total project price.
7.2 Customer is responsible for providing HOA approvals and any architectural guidelines unless explicitly included in writing.
7.3 ARX may use qualified subcontractors and remains responsible for the contracted work.`,
  },
  {
    title: 'Section 8 — Job Site Protection, Cleanup, and Cosmetic Damage',
    content: `8.1 ARX will take reasonable steps to protect landscaping and exterior features; however, exterior construction can cause incidental impacts.
8.2 ARX will remove project debris and perform a magnet sweep. Customer acknowledges that small nails/fasteners may remain despite reasonable efforts.
8.3 ARX is not responsible for ordinary incidental/cosmetic impacts unless caused by ARX's gross negligence or willful misconduct.
8.4 Customer acknowledges heavy vehicles/materials may affect asphalt, pavers, or decorative concrete.`,
  },
  {
    title: 'Section 9 — Warranties',
    content: `9.1 ARX warrants labor/workmanship against defects for five (5) years from the date of Substantial Completion.
9.2 ARX provides a one (1) year no-leak guarantee on ARX workmanship, conditioned on proper attic ventilation, drainage, and no third-party alterations.
9.3 Roofing materials are warranted solely by their manufacturers.
9.4 Claims must be submitted in writing to info@arxroofing.com within ten (10) business days of discovery.`,
  },
  {
    title: 'Section 10 — Warranty Exclusions',
    content: `Workmanship and leak warranties do not cover: Storm/Act of God events. Foot traffic, misuse, abuse, vandalism, or tampering. Improper attic ventilation, condensation, gutter/backflow issues, ice dams, or building movement. Pre-existing structural conditions. Mold, mildew, algae, fungus, or moisture-related damage. Normal wear and tear. Damage caused by other trades. Roof penetrations, modifications, or attachments made by others.`,
  },
  {
    title: 'Section 11 — Insurance Claim Projects (If Applicable)',
    content: `11.1 Customer remains responsible for: (a) the deductible; (b) non-covered upgrades or exclusions; and (c) any amounts not paid by the carrier.
11.2 If insurance funds are issued to Customer, Customer agrees to promptly endorse/submit those funds to ARX for completed work.
11.3 ARX will not waive deductibles or offer improper inducements.`,
  },
  {
    title: 'Section 12 — Termination and Ownership of Materials',
    content: `12.1 This Agreement begins on the signing date and ends upon completion and payment, unless terminated under this Section.
12.2 If this is a home-solicitation sale, Customer may cancel as stated in the attached Notice of Cancellation.
12.3 If Customer terminates after work begins, Customer will pay for work performed and costs incurred to date.
12.4 Once materials are delivered to the Property, risk of loss transfers to Customer.`,
  },
  {
    title: 'Section 13 — Limitation of Liability',
    content: `13.1 ARX disclaims liability for damages resulting from misuse, abuse, unauthorized modifications, vandalism, or Acts of God.
13.2 ARX will not be liable for indirect, incidental, special, consequential, or economic damages.
13.3 ARX's total liability will not exceed the amounts actually paid to ARX under this Agreement.`,
  },
  {
    title: 'Section 14 — Dispute Resolution; Attorneys\' Fees',
    content: `14.1 The parties will first attempt to resolve disputes informally within ten (10) business days after written notice.
14.2 Any lawsuit must be filed in the state or federal courts located in or serving Cabarrus County, North Carolina.
14.3 The prevailing party may recover reasonable attorneys' fees and costs.`,
  },
  {
    title: 'Section 15 — Entire Agreement; Signatures; Authority',
    content: `15.1 This Agreement is the entire understanding and supersedes all prior discussions, proposals, and representations.
15.2 Any amendment must be in writing and signed by both parties.
15.3 Customer acknowledges they are contracting with ARX Roofing & Exteriors LLC.
15.4 If any provision is held unenforceable, the remaining provisions remain in effect.
15.5 Signatures may be executed electronically and will be treated as original signatures.`,
  },
]

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const dayOfWeek = result.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++
    }
  }
  return result
}

function ContractDocument({ contract }: { contract: ContractData }) {
  const signingDate = contract.customer_signed_at ? new Date(contract.customer_signed_at) : new Date()
  const cancellationDeadline = addBusinessDays(signingDate, 3)

  return createElement(Document, {},
    createElement(Page, { size: 'LETTER', style: styles.coverPage },
      createElement(View, { style: styles.header },
        createElement(Text, { style: styles.companyName }, 'ARX ROOFING & EXTERIORS LLC'),
        createElement(Text, { style: styles.companyInfo }, '4101 Woodbury Terrace NW, Concord, NC 28027'),
        createElement(Text, { style: styles.companyInfo }, 'Phone: 704-313-8834 | Email: info@arxroofing.com | Website: arxroofing.com'),
      ),
      createElement(Text, { style: styles.title }, 'Order Form'),
      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 1 of 7'),
      ),
    ),

    createElement(Page, { size: 'LETTER', style: styles.page },
      createElement(View, { style: styles.header },
        createElement(Text, { style: { fontSize: 14, fontWeight: 'bold' } }, 'ARX ROOFING & EXTERIORS LLC - Order Form'),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, 'Customer And Premise'),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Customer Name(s):'),
          createElement(Text, { style: styles.value }, contract.customer_name),
        ),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Project Address:'),
          createElement(Text, { style: styles.value }, contract.project_address),
        ),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Phone Number:'),
          createElement(Text, { style: styles.value }, contract.customer_phone || 'N/A'),
        ),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Email:'),
          createElement(Text, { style: styles.value }, contract.customer_email || 'N/A'),
        ),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Preferred Contact:'),
          createElement(Text, { style: styles.value }, contract.preferred_contact || 'N/A'),
        ),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, 'Project Details'),
        createElement(View, { style: { ...styles.row, marginBottom: 8 } },
          createElement(Text, { style: styles.label }, 'Scope Of Work:'),
          createElement(View, { style: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' } },
            contract.scope_roof_replacement && createElement(Text, { style: styles.scopeItem }, 'Roof Replacement'),
            contract.scope_roof_repair && createElement(Text, { style: styles.scopeItem }, 'Roof Repair'),
            contract.scope_gutters && createElement(Text, { style: styles.scopeItem }, 'Gutters'),
            contract.scope_siding && createElement(Text, { style: styles.scopeItem }, 'Siding'),
            contract.scope_other && createElement(Text, { style: styles.scopeItem }, contract.scope_other),
          ),
        ),
        contract.roofing_material && createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Primary Roofing System:'),
          createElement(Text, { style: styles.value }, contract.roofing_material),
        ),
        contract.total_squares && createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Total Squares:'),
          createElement(Text, { style: styles.value }, String(contract.total_squares)),
        ),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Project Cost:'),
          createElement(Text, { style: { ...styles.value, fontSize: 12 } }, `$${contract.project_cost.toLocaleString()}`),
        ),
        contract.est_completion_date && createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Est. Completion Date:'),
          createElement(Text, { style: styles.value }, new Date(contract.est_completion_date).toLocaleDateString()),
        ),
        contract.exclusions && createElement(View, { style: { marginTop: 8 } },
          createElement(Text, { style: { ...styles.label, marginBottom: 4 } }, 'Exclusions / Observations:'),
          createElement(Text, { style: { fontSize: 9 } }, contract.exclusions),
        ),
        contract.additional_products && createElement(View, { style: { marginTop: 8 } },
          createElement(Text, { style: { ...styles.label, marginBottom: 4 } }, 'Additional Products:'),
          createElement(Text, { style: { fontSize: 9 } }, contract.additional_products),
        ),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, 'Payment Details'),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Payment Method:'),
          createElement(Text, { style: styles.value }, 
            `${contract.payment_method}${contract.finance_company ? ` (${contract.finance_company})` : ''}`
          ),
        ),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Deposit (Due At Signing):'),
          createElement(Text, { style: styles.value }, `$${contract.deposit_amount.toLocaleString()}`),
        ),
        contract.notes && createElement(View, { style: { marginTop: 8 } },
          createElement(Text, { style: { ...styles.label, marginBottom: 4 } }, 'Notes:'),
          createElement(Text, { style: { fontSize: 9 } }, contract.notes),
        ),
      ),

      createElement(View, { style: styles.legalText },
        createElement(Text, {}, 
          'By signing below, the undersigned represents that (i) he or she has read the above Order Form and the Terms and Conditions (collectively, the "Agreement") in its entirety, and (ii) he or she agrees to be bound by the terms and conditions of the Agreement.'
        ),
      ),

      createElement(View, { style: styles.signatureBlock },
        createElement(View, { style: styles.signatureColumn },
          createElement(Text, { style: { fontWeight: 'bold', marginBottom: 10 } }, 'Customer'),
          createElement(Text, { style: styles.signatureLabel }, 'Print Name:'),
          createElement(Text, { style: { marginBottom: 8, fontWeight: 'bold' } }, contract.customer_print_name || ''),
          createElement(Text, { style: styles.signatureLabel }, 'Signature:'),
          contract.customer_signature_data 
            ? createElement(Image, { src: contract.customer_signature_data, style: styles.signatureImage })
            : createElement(View, { style: styles.signatureLine }),
          createElement(Text, { style: styles.signatureLabel }, 'Date:'),
          createElement(Text, {}, contract.customer_signed_at ? new Date(contract.customer_signed_at).toLocaleDateString() : ''),
        ),
        createElement(View, { style: styles.signatureColumn },
          createElement(Text, { style: { fontWeight: 'bold', marginBottom: 10 } }, 'ARX Roofing & Exteriors'),
          createElement(Text, { style: styles.signatureLabel }, 'Print Name:'),
          createElement(Text, { style: { marginBottom: 8, fontWeight: 'bold' } }, contract.rep_name),
          createElement(Text, { style: styles.signatureLabel }, 'Signature:'),
          contract.rep_signature_data 
            ? createElement(Image, { src: contract.rep_signature_data, style: styles.signatureImage })
            : createElement(View, { style: styles.signatureLine }),
          createElement(Text, { style: styles.signatureLabel }, 'Title:'),
          createElement(Text, { style: { marginBottom: 4 } }, contract.rep_title),
          createElement(Text, { style: styles.signatureLabel }, 'Date:'),
          createElement(Text, {}, new Date(contract.rep_signed_at).toLocaleDateString()),
        ),
      ),

      contract.customer_ip && createElement(Text, { style: styles.auditFooter },
        `Signed electronically by customer from IP: ${contract.customer_ip} on ${contract.customer_signed_at ? new Date(contract.customer_signed_at).toLocaleString() : ''}`
      ),

      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 2 of 7'),
      ),
    ),

    createElement(Page, { size: 'LETTER', style: styles.page },
      createElement(Text, { style: { fontSize: 14, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' } }, 'Terms And Conditions'),
      ...TERMS_SECTIONS.slice(0, 5).map((section, index) =>
        createElement(View, { key: index, style: styles.termsSection },
          createElement(Text, { style: styles.termsSectionTitle }, section.title),
          createElement(Text, { style: styles.termsText }, section.content),
        )
      ),
      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 3 of 7'),
      ),
    ),

    createElement(Page, { size: 'LETTER', style: styles.page },
      createElement(Text, { style: { fontSize: 14, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' } }, 'Terms And Conditions (Continued)'),
      ...TERMS_SECTIONS.slice(5, 10).map((section, index) =>
        createElement(View, { key: index, style: styles.termsSection },
          createElement(Text, { style: styles.termsSectionTitle }, section.title),
          createElement(Text, { style: styles.termsText }, section.content),
        )
      ),
      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 4 of 7'),
      ),
    ),

    createElement(Page, { size: 'LETTER', style: styles.page },
      createElement(Text, { style: { fontSize: 14, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' } }, 'Terms And Conditions (Continued)'),
      ...TERMS_SECTIONS.slice(10).map((section, index) =>
        createElement(View, { key: index, style: styles.termsSection },
          createElement(Text, { style: styles.termsSectionTitle }, section.title),
          createElement(Text, { style: styles.termsText }, section.content),
        )
      ),
      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 5 of 7'),
      ),
    ),

    createElement(Page, { size: 'LETTER', style: styles.page },
      createElement(Text, { style: { fontSize: 14, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' } }, 'Customer Acknowledgements'),
      
      createElement(View, { style: styles.acknowledgementRow },
        createElement(View, { style: styles.initialsBox },
          createElement(Text, {}, contract.customer_initials_change_orders || ''),
        ),
        createElement(View, { style: { flex: 1 } },
          createElement(Text, { style: { fontWeight: 'bold', fontSize: 9, marginBottom: 2 } }, 'Change Orders'),
          createElement(Text, { style: styles.acknowledgementText }, 
            'I understand additional work beyond the Base Scope requires a signed change order.'
          ),
        ),
      ),

      createElement(View, { style: styles.acknowledgementRow },
        createElement(View, { style: styles.initialsBox },
          createElement(Text, {}, contract.customer_initials_property_condition || ''),
        ),
        createElement(View, { style: { flex: 1 } },
          createElement(Text, { style: { fontWeight: 'bold', fontSize: 9, marginBottom: 2 } }, 'Property Condition'),
          createElement(Text, { style: styles.acknowledgementText }, 
            'I affirm there are no known structural defects (rotted rafters, sagging roof lines, etc.) other than disclosed in writing.'
          ),
        ),
      ),

      createElement(View, { style: styles.acknowledgementRow },
        createElement(View, { style: styles.initialsBox },
          createElement(Text, {}, contract.customer_initials_landscaping || ''),
        ),
        createElement(View, { style: { flex: 1 } },
          createElement(Text, { style: { fontWeight: 'bold', fontSize: 9, marginBottom: 2 } }, 'Landscaping/Cosmetic Impacts'),
          createElement(Text, { style: styles.acknowledgementText }, 
            'I understand incidental cosmetic impacts may occur as described in Section 8.'
          ),
        ),
      ),

      contract.payment_method === 'insurance' && createElement(View, { style: { ...styles.acknowledgementRow, backgroundColor: '#fff8e6' } },
        createElement(View, { style: styles.initialsBox },
          createElement(Text, {}, contract.customer_initials_insurance || ''),
        ),
        createElement(View, { style: { flex: 1 } },
          createElement(Text, { style: { fontWeight: 'bold', fontSize: 9, marginBottom: 2 } }, 'Insurance Funds (If Applicable)'),
          createElement(Text, { style: styles.acknowledgementText }, 
            'I agree to Section 11 regarding insurance claim projects.'
          ),
        ),
      ),

      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 6 of 7'),
      ),
    ),

    createElement(Page, { size: 'LETTER', style: styles.page },
      createElement(View, { style: styles.cancellationBox },
        createElement(Text, { style: styles.cancellationTitle }, 'NOTICE OF CANCELLATION'),
        
        createElement(View, { style: { marginBottom: 15 } },
          createElement(View, { style: styles.row },
            createElement(Text, { style: styles.label }, 'Date of Transaction:'),
            createElement(Text, { style: styles.value }, signingDate.toLocaleDateString()),
          ),
          createElement(View, { style: styles.row },
            createElement(Text, { style: styles.label }, 'NOT LATER THAN MIDNIGHT OF:'),
            createElement(Text, { style: { ...styles.value, fontWeight: 'bold' } }, cancellationDeadline.toLocaleDateString()),
          ),
        ),

        createElement(Text, { style: { fontSize: 9, marginBottom: 10 } },
          'You may CANCEL this transaction, without any penalty or obligation, within THREE BUSINESS DAYS from the above date.'
        ),

        createElement(Text, { style: { fontSize: 9, marginBottom: 10 } },
          'If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within TEN BUSINESS DAYS following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be cancelled.'
        ),

        createElement(Text, { style: { fontSize: 9, marginBottom: 10 } },
          'If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale; or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller\'s expense and risk.'
        ),

        createElement(Text, { style: { fontSize: 9, marginBottom: 10 } },
          'If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation.'
        ),

        createElement(Text, { style: { fontSize: 9, marginBottom: 15 } },
          'To cancel this transaction, mail or deliver a signed and dated copy of this cancellation notice or any other written notice, or send a telegram to ARX Roofing & Exteriors LLC, 4101 Woodbury Terrace NW, Concord, NC 28027, NOT LATER THAN MIDNIGHT OF the date shown above.'
        ),

        createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', marginBottom: 10 } }, 'I HEREBY CANCEL THIS TRANSACTION.'),

        createElement(View, { style: { marginTop: 20 } },
          createElement(Text, { style: styles.signatureLabel }, 'Customer Signature:'),
          createElement(View, { style: { ...styles.signatureLine, marginBottom: 15 } }),
          createElement(Text, { style: styles.signatureLabel }, 'Date:'),
          createElement(View, { style: styles.signatureLine }),
        ),
      ),

      createElement(Text, { style: { fontSize: 8, textAlign: 'center', marginTop: 20, color: '#666' } },
        'This is your copy. Detach and keep for your records.'
      ),

      createElement(View, { style: styles.footer },
        createElement(Text, {}, 'ARX Roofing & Exteriors LLC'),
        createElement(Text, {}, 'Page 7 of 7'),
      ),
    ),
  )
}

export async function generateContractPdf(contract: ContractData): Promise<Buffer> {
  const doc = createElement(ContractDocument, { contract }) as any
  const pdfBlob = await pdf(doc).toBlob()
  const arrayBuffer = await pdfBlob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
