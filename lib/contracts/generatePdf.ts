import PDFDocument from 'pdfkit'

export interface ContractData {
  id: string
  customer_name: string
  customer_email?: string
  customer_phone?: string
  project_address: string
  project_cost: number
  total_squares?: number
  roofing_material?: string
  scope_roof_replacement?: boolean
  scope_roof_repair?: boolean
  scope_gutters?: boolean
  scope_siding?: boolean
  scope_other?: string
  payment_method?: string
  finance_company?: string
  deposit_amount?: number
  est_completion_date?: string
  exclusions?: string
  additional_products?: string
  notes?: string
  preferred_contact?: string
  customer_print_name?: string
  customer_initials_change_orders?: string
  customer_initials_property_condition?: string
  customer_initials_landscaping?: string
  customer_initials_insurance?: string
  rep_name?: string
  rep_title?: string
  rep_signature_data?: string
  rep_signed_at?: string
  customer_signature_data?: string
  customer_signed_at?: string
  customer_ip?: string
}

function formatDate(dateStr?: string): string {
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

function formatCurrency(amount?: number): string {
  if (amount === undefined || amount === null) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function addBusinessDays(date: Date, days: number): Date {
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

export async function generateContractPdf(contract: ContractData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = []
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
      })

      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = 612
      const contentWidth = pageWidth - 100

      // Page 1: Cover Page
      doc.fontSize(24).font('Helvetica-Bold')
      doc.text('ARX ROOFING & EXTERIORS LLC', 50, 200, { align: 'center', width: contentWidth })
      
      doc.fontSize(10).font('Helvetica')
      doc.text('4101 Woodbury Terrace NW, Concord, NC 28027', 50, 240, { align: 'center', width: contentWidth })
      doc.text('Phone: 704-313-8834 | Email: info@arxroofing.com | arxroofing.com', 50, 255, { align: 'center', width: contentWidth })
      
      doc.fontSize(28).font('Helvetica-Bold')
      doc.text('Order Form', 50, 350, { align: 'center', width: contentWidth })
      
      doc.rect(200, 340, 212, 50).stroke()

      // Page 2: Order Form
      doc.addPage()
      let y = 50

      // Header
      doc.fontSize(16).font('Helvetica-Bold')
      doc.text('ARX ROOFING & EXTERIORS LLC', 50, y, { align: 'center', width: contentWidth })
      y += 20
      doc.fontSize(9).font('Helvetica')
      doc.text('4101 Woodbury Terrace NW, Concord, NC 28027 | 704-313-8834 | info@arxroofing.com', 50, y, { align: 'center', width: contentWidth })
      y += 30

      // Customer And Premise Section
      doc.fontSize(12).font('Helvetica-Bold')
      doc.text('Customer And Premise', 50, y)
      y += 5
      doc.moveTo(50, y).lineTo(562, y).stroke()
      y += 15

      doc.fontSize(10).font('Helvetica')
      doc.text(`Customer Name(s): ${contract.customer_name || ''}`, 50, y)
      y += 18
      doc.text(`Project Address: ${contract.project_address || ''}`, 50, y)
      y += 18
      doc.text(`Phone Number: ${contract.customer_phone || ''}`, 50, y)
      doc.text(`Email: ${contract.customer_email || ''}`, 300, y)
      y += 18
      doc.text(`Preferred Method Of Contact: ${contract.preferred_contact === 'phone' ? '☑ Phone  ☐ Email' : contract.preferred_contact === 'email' ? '☐ Phone  ☑ Email' : '☐ Phone  ☐ Email'}`, 50, y)
      y += 25

      // Project Details Section
      doc.fontSize(12).font('Helvetica-Bold')
      doc.text('Project Details', 50, y)
      y += 5
      doc.moveTo(50, y).lineTo(562, y).stroke()
      y += 15

      doc.fontSize(10).font('Helvetica')
      const scopeItems = [
        contract.scope_roof_replacement ? '☑' : '☐', 'Roof Replacement',
        contract.scope_roof_repair ? '☑' : '☐', 'Roof Repair',
        contract.scope_gutters ? '☑' : '☐', 'Gutters',
        contract.scope_siding ? '☑' : '☐', 'Siding',
      ]
      doc.text(`Scope Of Work: ${scopeItems[0]} Roof Replacement  ${scopeItems[2]} Roof Repair  ${scopeItems[4]} Gutters  ${scopeItems[6]} Siding`, 50, y)
      y += 18
      if (contract.scope_other) {
        doc.text(`Other: ${contract.scope_other}`, 50, y)
        y += 18
      }
      doc.text(`Primary Roofing System: ${contract.roofing_material || ''}`, 50, y)
      y += 18
      doc.text(`Material / Brand / Color: ${contract.roofing_material || ''}`, 50, y)
      y += 18
      doc.text(`Total Squares: ${contract.total_squares || ''}`, 50, y)
      doc.text(`Project Cost: ${formatCurrency(contract.project_cost)}`, 300, y)
      y += 18
      doc.text(`Est. Completion Date: ${formatDate(contract.est_completion_date)}`, 50, y)
      y += 18
      if (contract.exclusions) {
        doc.text(`Exclusions / Observations:`, 50, y)
        y += 15
        doc.fontSize(9).text(contract.exclusions, 50, y, { width: contentWidth })
        y += doc.heightOfString(contract.exclusions, { width: contentWidth }) + 10
        doc.fontSize(10)
      }
      if (contract.additional_products) {
        doc.text(`Additional Products:`, 50, y)
        y += 15
        doc.fontSize(9).text(contract.additional_products, 50, y, { width: contentWidth })
        y += doc.heightOfString(contract.additional_products, { width: contentWidth }) + 10
        doc.fontSize(10)
      }
      y += 10

      // Payment Details Section
      doc.fontSize(12).font('Helvetica-Bold')
      doc.text('Payment Details', 50, y)
      y += 5
      doc.moveTo(50, y).lineTo(562, y).stroke()
      y += 15

      doc.fontSize(10).font('Helvetica')
      const paymentMethodText = contract.payment_method === 'finance' 
        ? `Finance Co: ${contract.finance_company || ''}`
        : contract.payment_method === 'cash' ? 'Cash'
        : contract.payment_method === 'insurance' ? 'Insurance Claim'
        : contract.payment_method || ''
      doc.text(`Payment Method: ${paymentMethodText}`, 50, y)
      y += 18
      doc.text(`Deposit: ${formatCurrency(contract.deposit_amount)} (Due At Signing)`, 50, y)
      y += 18
      if (contract.notes) {
        doc.text(`Notes:`, 50, y)
        y += 15
        doc.fontSize(9).text(contract.notes, 50, y, { width: contentWidth })
        y += doc.heightOfString(contract.notes, { width: contentWidth }) + 10
        doc.fontSize(10)
      }
      y += 20

      // Signature Block
      doc.fontSize(8).font('Helvetica')
      doc.text('By signing below, the undersigned represents that (i) he or she has read the above Order Form and the Terms and Conditions (collectively, the "Agreement") in its entirety, and (ii) he or she agrees to be bound by the terms and conditions of the Agreement.', 50, y, { width: contentWidth })
      y += 40

      // Two column signatures
      const leftCol = 50
      const rightCol = 320

      doc.fontSize(10).font('Helvetica-Bold')
      doc.text('Customer', leftCol, y)
      doc.text('ARX Roofing & Exteriors', rightCol, y)
      y += 20

      doc.font('Helvetica')
      doc.text(`Print Name: ${contract.customer_print_name || ''}`, leftCol, y)
      doc.text(`Print Name: ${contract.rep_name || ''}`, rightCol, y)
      y += 18

      doc.text('Signature:', leftCol, y)
      doc.text('Signature:', rightCol, y)
      y += 5

      // Draw signature images if available
      if (contract.customer_signature_data) {
        try {
          const sigData = contract.customer_signature_data.replace(/^data:image\/\w+;base64,/, '')
          const sigBuffer = Buffer.from(sigData, 'base64')
          doc.image(sigBuffer, leftCol, y, { width: 150, height: 40 })
        } catch (e) {
          doc.text('[Signature on file]', leftCol, y + 15)
        }
      }
      if (contract.rep_signature_data) {
        try {
          const sigData = contract.rep_signature_data.replace(/^data:image\/\w+;base64,/, '')
          const sigBuffer = Buffer.from(sigData, 'base64')
          doc.image(sigBuffer, rightCol, y, { width: 150, height: 40 })
        } catch (e) {
          doc.text('[Signature on file]', rightCol, y + 15)
        }
      }
      y += 50

      doc.text(`Date: ${formatDate(contract.customer_signed_at)}`, leftCol, y)
      doc.text(`Title: ${contract.rep_title || ''}`, rightCol, y)
      y += 18
      doc.text('', leftCol, y)
      doc.text(`Date: ${formatDate(contract.rep_signed_at)}`, rightCol, y)

      // Audit info
      if (contract.customer_ip && contract.customer_signed_at) {
        y += 30
        doc.fontSize(7).fillColor('#666')
        doc.text(`Signed electronically from IP: ${contract.customer_ip} on ${new Date(contract.customer_signed_at).toISOString()}`, 50, y)
        doc.fillColor('#000')
      }

      // Pages 3-5: Terms and Conditions
      doc.addPage()
      y = 50

      doc.fontSize(14).font('Helvetica-Bold')
      doc.text('Terms And Conditions', 50, y, { align: 'center', width: contentWidth })
      y += 30

      const terms = getTermsAndConditions()
      doc.fontSize(8).font('Helvetica')

      for (const section of terms) {
        if (y > 700) {
          doc.addPage()
          y = 50
        }
        
        doc.font('Helvetica-Bold').fontSize(9)
        doc.text(section.title, 50, y, { width: contentWidth })
        y += 15
        
        doc.font('Helvetica').fontSize(8)
        for (const paragraph of section.content) {
          if (y > 700) {
            doc.addPage()
            y = 50
          }
          doc.text(paragraph, 50, y, { width: contentWidth })
          y += doc.heightOfString(paragraph, { width: contentWidth }) + 8
        }
        y += 10
      }

      // Page 6: Customer Acknowledgements
      doc.addPage()
      y = 50

      doc.fontSize(14).font('Helvetica-Bold')
      doc.text('Customer Acknowledgements', 50, y, { align: 'center', width: contentWidth })
      y += 30

      doc.fontSize(10).font('Helvetica')
      const acknowledgements = [
        { label: 'Change Orders', text: 'I understand additional work beyond the Base Scope requires a signed change order.', initials: contract.customer_initials_change_orders },
        { label: 'Property Condition', text: 'I affirm there are no known structural defects (rotted rafters, sagging roof lines, etc.) other than disclosed in writing.', initials: contract.customer_initials_property_condition },
        { label: 'Landscaping/Cosmetic Impacts', text: 'I understand incidental cosmetic impacts may occur as described in Section 8.', initials: contract.customer_initials_landscaping },
        { label: 'Insurance Funds (if applicable)', text: 'I agree to Section 11.', initials: contract.customer_initials_insurance },
      ]

      for (const ack of acknowledgements) {
        doc.font('Helvetica-Bold').text(`${ack.label}:`, 50, y)
        y += 15
        doc.font('Helvetica').text(ack.text, 50, y, { width: contentWidth - 100 })
        y += doc.heightOfString(ack.text, { width: contentWidth - 100 }) + 5
        doc.text(`Customer Initials: ${ack.initials || '________'}`, 50, y)
        y += 30
      }

      // Page 7: Notice of Cancellation
      doc.addPage()
      y = 50

      doc.fontSize(14).font('Helvetica-Bold')
      doc.text('Notice of Cancellation', 50, y, { align: 'center', width: contentWidth })
      y += 30

      const signingDate = contract.customer_signed_at ? new Date(contract.customer_signed_at) : new Date()
      const cancellationDeadline = addBusinessDays(signingDate, 3)

      doc.fontSize(10).font('Helvetica')
      doc.text(`Date of Transaction: ${formatDate(contract.customer_signed_at)}`, 50, y)
      y += 25

      doc.font('Helvetica-Bold')
      doc.text(`NOT LATER THAN MIDNIGHT OF: ${formatDate(cancellationDeadline.toISOString())}`, 50, y)
      y += 30

      doc.font('Helvetica').fontSize(9)
      const cancellationText = `You may CANCEL this transaction, without any Penalty or Obligation, within THREE BUSINESS DAYS from the above date.

If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within TEN BUSINESS DAYS following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be cancelled.

If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller's expense and risk.

If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to the seller, or if you agree to return the goods to the seller and fail to do so, then you remain liable for performance of all obligations under the contract.

To cancel this transaction, mail or deliver a signed and dated copy of this cancellation notice or any other written notice, or send a telegram, to:

ARX Roofing & Exteriors LLC
4101 Woodbury Terrace NW
Concord, NC 28027

NOT LATER THAN MIDNIGHT OF ${formatDate(cancellationDeadline.toISOString())}`

      doc.text(cancellationText, 50, y, { width: contentWidth })
      y += doc.heightOfString(cancellationText, { width: contentWidth }) + 30

      doc.fontSize(10)
      doc.text('I HEREBY CANCEL THIS TRANSACTION.', 50, y)
      y += 30
      doc.text('_________________________________', 50, y)
      y += 15
      doc.text('Customer Signature', 50, y)
      y += 30
      doc.text('_________________________________', 50, y)
      y += 15
      doc.text('Date', 50, y)

      // Add page numbers
      const pages = doc.bufferedPageRange()
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i)
        doc.fontSize(8).fillColor('#666')
        doc.text(
          `Page ${i + 1} of ${pages.count} | ARX Roofing & Exteriors LLC`,
          50,
          750,
          { align: 'center', width: contentWidth }
        )
      }

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

function getTermsAndConditions(): { title: string; content: string[] }[] {
  return [
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
        '3.2 Customer acknowledges that roofing work is performed based on visual inspection and information reasonably available at the time of estimate. ARX is not responsible for pre-existing conditions, concealed defects, or conditions outside the Scope of Work that are not reasonably observable prior to commencement of the Work.',
        '3.3 Customer understands that roofing work may temporarily expose portions of the Property to the elements during installation. ARX will take reasonable measures to protect the Property while the Work is in progress.',
        '3.4 Customer acknowledges that ARX does not guarantee the condition or performance of underlying structural components, decking, or prior construction not expressly included in the Scope of Work.',
      ],
    },
    {
      title: 'Section 4 — Hidden Conditions, Decking, and Code Upgrades',
      content: [
        '4.1 Roofing tear-off may reveal concealed damage or conditions not visible at the time of inspection (e.g., rotten decking, damaged flashing, multiple roof layers, inadequate ventilation). These are outside the Base Scope unless specifically listed.',
        '4.2 Decking: Included Decking: First 3 sheets of 4\'x8\' OSB/plywood are included at no extra cost. Additional Decking, over the three sheets mentioned above, if needed at installation will be billed to customer via written change order.',
        '4.3 If the permit authority, manufacturer instructions, or code require additional items, Customer agrees these may be added via change order as necessary to complete a compliant installation.',
      ],
    },
    {
      title: 'Section 5 — Change Orders',
      content: [
        '5.1 Any work, materials, or price changes not included in the Base Scope must be documented in a written change order signed by both parties before proceeding.',
        '5.2 Change orders are due as stated on the change order; if not stated, they are due with the final payment.',
        '5.3 Any changes to the Scope of Work or price must be confirmed in a written change order signed by both parties.',
      ],
    },
    {
      title: 'Section 6 — Scheduling, Delays, and Access',
      content: [
        '6.1 Estimated dates are estimates only. Weather, permitting, inspections, supplier availability, and safety considerations may affect schedule.',
        '6.2 Customer Access and Cooperation: Provide reasonable access to the work area, driveway, electrical power (if needed), and water (if needed). Secure pets and keep children away from the work area and debris.',
        '6.3 Customer is responsible for utilities and for notifying ARX of any special utility shutoffs or restrictions.',
        '6.4 Customer authorizes ARX to take photographs or videos of the Property for documentation, quality control, warranty, insurance, and training purposes.',
        '6.5 ARX may temporarily suspend work when necessary due to unsafe conditions, weather events, or protection of the Property.',
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
        '8.3 ARX is not responsible for ordinary incidental/cosmetic impacts unless caused by ARX\'s gross negligence or willful misconduct.',
        '8.4 Customer acknowledges heavy vehicles/materials may affect asphalt, pavers, or decorative concrete; pre-existing cracks/settling may worsen.',
      ],
    },
    {
      title: 'Section 9 — Warranties',
      content: [
        '9.1 ARX warrants labor/workmanship against defects for five (5) years from the date of Substantial Completion.',
        '9.2 ARX provides a one (1) year no-leak guarantee on ARX workmanship, conditioned on proper attic ventilation, drainage, and no third-party alterations.',
        '9.3 Roofing materials are warranted solely by their manufacturers. Copies are available upon request.',
        '9.4 Claims must be submitted in writing to info@arxroofing.com within ten (10) business days of discovery.',
      ],
    },
    {
      title: 'Section 10 — Warranty Exclusions',
      content: [
        'Workmanship and leak warranties do not cover: Storm/Act of God events, foot traffic, misuse, abuse, vandalism, or tampering. Improper attic ventilation, condensation, gutter/backflow issues, ice dams, or building movement/settlement. Pre-existing structural conditions, substrate failures, rotten rafters, sagging roof lines, or latent defects. Mold, mildew, algae, fungus, or moisture-related damage not directly caused by ARX workmanship. Normal wear and tear, fading, cosmetic changes. Damage caused by other trades or unapproved repairs.',
      ],
    },
    {
      title: 'Section 11 — Insurance Claim Projects (If Applicable)',
      content: [
        '11.1 Customer remains responsible for: (a) the deductible; (b) non-covered upgrades or exclusions; and (c) any amounts not paid by the carrier.',
        '11.2 If insurance funds are issued to Customer, Customer agrees to promptly endorse/submit those funds to ARX for completed work.',
        '11.3 ARX will not waive deductibles or offer improper inducements. Customer agrees not to request such waivers.',
      ],
    },
    {
      title: 'Section 12 — Termination and Ownership of Materials',
      content: [
        '12.1 This Agreement begins on the signing date and ends upon completion and payment, unless terminated under this Section.',
        '12.2 If this is a home-solicitation sale or otherwise subject to a 3-business-day right to cancel, Customer may cancel as stated in the attached Notice of Cancellation.',
        '12.3 If Customer terminates after work begins, Customer will pay for work performed and costs incurred to date.',
        '12.4 Once materials are delivered to the Property, risk of loss due to theft, vandalism, or weather generally transfers to Customer.',
      ],
    },
    {
      title: 'Section 13 — Limitation of Liability',
      content: [
        '13.1 ARX disclaims liability for damages resulting from misuse, abuse, unauthorized modifications/repairs, vandalism, or damage caused by Customer/third parties, or by fire, storms, or other Acts of God.',
        '13.2 To the fullest extent permitted by law, ARX will not be liable for indirect, incidental, special, consequential, or economic damages.',
        '13.3 ARX\'s total liability for any claim arising out of this Agreement will not exceed the amounts actually paid to ARX under this Agreement.',
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
        '15.1 This Agreement (including exhibits/change orders) is the entire understanding and supersedes all prior discussions, proposals, and representations.',
        '15.2 Any amendment must be in writing and signed by both parties.',
        '15.3 Customer acknowledges they are contracting with ARX Roofing & Exteriors LLC and that any salesperson/representative is acting as an authorized representative only to the extent of this written Agreement.',
        '15.4 If any provision is held unenforceable, the remaining provisions remain in effect.',
        '15.5 Signatures may be executed electronically and will be treated as original signatures.',
      ],
    },
  ]
}
