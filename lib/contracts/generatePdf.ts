import { jsPDF } from 'jspdf'

export interface ContractData {
  id: string
  agreement_type?: string
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

function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const paragraphs = text.split('\n')
  
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }
    const words = paragraph.split(' ')
    let currentLine = ''
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const testWidth = doc.getTextWidth(testLine)
      
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) {
      lines.push(currentLine)
    }
  }
  
  return lines
}

function generateContingencyPdf(contract: ContractData): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = 612
  const pageHeight = 792
  const margin = 42
  const contentWidth = pageWidth - margin * 2
  let y = margin

  const addWrapped = (text: string, fontSize = 8.5, gap = 10) => {
    doc.setFontSize(fontSize)
    const lines = wrapText(doc, text, contentWidth)
    for (const line of lines) {
      doc.text(line, margin, y)
      y += gap
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('ARX ROOFING & EXTERIORS LLC', pageWidth / 2, y, { align: 'center' })
  y += 15
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('4101 Woodbury Terrace NW, Concord, NC 28027 | 704-313-8834 | info@arxroofing.com', pageWidth / 2, y, { align: 'center' })
  y += 24

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Insurance Contingency Agreement', pageWidth / 2, y, { align: 'center' })
  y += 22

  doc.setFontSize(9)
  doc.text('Customer And Property', margin, y)
  y += 4
  doc.line(margin, y, pageWidth - margin, y)
  y += 12
  doc.setFont('helvetica', 'normal')
  doc.text(`Customer: ${contract.customer_name || ''}`, margin, y)
  y += 12
  doc.text(`Property: ${contract.project_address || ''}`, margin, y)
  y += 12
  doc.text(`Phone: ${contract.customer_phone || ''}`, margin, y)
  doc.text(`Email: ${contract.customer_email || ''}`, 300, y)
  y += 18

  doc.setFont('helvetica', 'bold')
  doc.text('Claim Scope', margin, y)
  y += 4
  doc.line(margin, y, pageWidth - margin, y)
  y += 12
  doc.setFont('helvetica', 'normal')
  const scope = [
    contract.scope_roof_replacement && 'Roof Replacement',
    contract.scope_roof_repair && 'Roof Repair',
    contract.scope_gutters && 'Gutters',
    contract.scope_siding && 'Siding',
    contract.scope_other,
  ].filter(Boolean).join(', ') || 'Exterior storm damage claim assistance'
  addWrapped(`Requested scope: ${scope}`)
  if (contract.roofing_material) addWrapped(`Primary roofing system: ${contract.roofing_material}`)
  if (contract.notes) addWrapped(`Notes: ${contract.notes}`)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('Terms', margin, y)
  y += 4
  doc.line(margin, y, pageWidth - margin, y)
  y += 12
  doc.setFont('helvetica', 'normal')
  const terms = [
    '1. Purpose. Customer authorizes ARX to inspect, document, estimate, and communicate with the insurance carrier about exterior storm damage. This agreement does not authorize construction work.',
    '2. Contingency. Customer has no obligation to move forward unless the insurance carrier approves the claim and ARX accepts the approved scope and price.',
    '3. Contractor Selection. If the claim, scope, and price are approved, Customer agrees to use ARX for the approved exterior work, subject to a final Installation Agreement before construction starts.',
    '4. Customer Costs. Customer remains responsible for the deductible, upgrades, non-covered work, code items not paid by insurance, and signed change orders. ARX will not waive deductibles or offer improper inducements.',
    '5. Claim Help. ARX may provide photos, measurements, estimates, supplements, and meeting support. ARX is not a public adjuster and does not decide coverage.',
    '6. No Construction Start. Materials are not ordered and work does not start until the final Installation Agreement is signed.',
    '7. Cancellation. Customer may cancel within any required 3-business-day cancellation period and before the final Installation Agreement. If Customer asks ARX to incur outside costs, Customer will reimburse documented costs.',
    '8. Photos And Communication. Customer authorizes ARX to take photos/video for claim documentation, quality control, training, and project records.',
  ]
  for (const term of terms) addWrapped(term)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.text(`Customer Initials: ${contract.customer_initials_insurance || '________'}`, margin, y)
  y += 22

  const leftCol = margin
  const rightCol = 320
  doc.text('Customer', leftCol, y)
  doc.text('ARX Roofing & Exteriors', rightCol, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.text(`Print Name: ${contract.customer_print_name || ''}`, leftCol, y)
  doc.text(`Print Name: ${contract.rep_name || ''}`, rightCol, y)
  y += 14
  doc.text('Signature:', leftCol, y)
  doc.text('Signature:', rightCol, y)
  y += 4
  doc.rect(leftCol, y, 150, 38)
  doc.rect(rightCol, y, 150, 38)
  if (contract.customer_signature_data) {
    try {
      doc.addImage(contract.customer_signature_data, 'PNG', leftCol + 2, y + 2, 146, 34)
    } catch {
      doc.text('[Signature on file]', leftCol + 10, y + 22)
    }
  }
  if (contract.rep_signature_data) {
    try {
      doc.addImage(contract.rep_signature_data, 'PNG', rightCol + 2, y + 2, 146, 34)
    } catch {
      doc.text('[Signature on file]', rightCol + 10, y + 22)
    }
  }
  y += 48
  doc.text(`Date: ${formatDate(contract.customer_signed_at)}`, leftCol, y)
  doc.text(`Title: ${contract.rep_title || ''}`, rightCol, y)
  y += 14
  doc.text(`Signed IP: ${contract.customer_ip || ''}`, leftCol, y)
  doc.text(`Date: ${formatDate(contract.rep_signed_at)}`, rightCol, y)

  doc.setFontSize(7)
  doc.setTextColor(100)
  doc.text('Page 1 of 1 | ARX Roofing & Exteriors LLC', pageWidth / 2, pageHeight - 24, { align: 'center' })

  return Buffer.from(doc.output('arraybuffer'))
}

export async function generateContractPdf(contract: ContractData): Promise<Buffer> {
  if (contract.agreement_type === 'contingency') {
    return generateContingencyPdf(contract)
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  })

  const pageWidth = 612
  const pageHeight = 792
  const margin = 50
  const contentWidth = pageWidth - (margin * 2)
  let y = margin
  let pageNum = 1

  const addPageNumber = () => {
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(`Page ${pageNum} of 7 | ARX Roofing & Exteriors LLC`, pageWidth / 2, pageHeight - 30, { align: 'center' })
    doc.setTextColor(0)
  }

  const checkNewPage = (neededHeight: number = 50) => {
    if (y + neededHeight > pageHeight - 60) {
      addPageNumber()
      doc.addPage()
      pageNum++
      y = margin
    }
  }

  // PAGE 1: Cover Page
  doc.setFontSize(24)
  doc.setFont('helvetica', 'bold')
  doc.text('ARX ROOFING & EXTERIORS LLC', pageWidth / 2, 200, { align: 'center' })
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('4101 Woodbury Terrace NW, Concord, NC 28027', pageWidth / 2, 240, { align: 'center' })
  doc.text('Phone: 704-313-8834 | Email: info@arxroofing.com | arxroofing.com', pageWidth / 2, 255, { align: 'center' })
  
  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.rect(200, 340, 212, 50)
  doc.text('Order Form', pageWidth / 2, 375, { align: 'center' })
  
  addPageNumber()

  // PAGE 2: Order Form
  doc.addPage()
  pageNum++
  y = margin

  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('ARX ROOFING & EXTERIORS LLC', pageWidth / 2, y, { align: 'center' })
  y += 18
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('4101 Woodbury Terrace NW, Concord, NC 28027 | 704-313-8834 | info@arxroofing.com', pageWidth / 2, y, { align: 'center' })
  y += 25

  // Customer And Premise Section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Customer And Premise', margin, y)
  y += 3
  doc.line(margin, y, pageWidth - margin, y)
  y += 15

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Customer Name(s): ${contract.customer_name || ''}`, margin, y)
  y += 16
  doc.text(`Project Address: ${contract.project_address || ''}`, margin, y)
  y += 16
  doc.text(`Phone Number: ${contract.customer_phone || ''}`, margin, y)
  doc.text(`Email: ${contract.customer_email || ''}`, 300, y)
  y += 16
  const contactPref = contract.preferred_contact === 'phone' ? '[X] Phone  [ ] Email' : contract.preferred_contact === 'email' ? '[ ] Phone  [X] Email' : '[ ] Phone  [ ] Email'
  doc.text(`Preferred Method Of Contact: ${contactPref}`, margin, y)
  y += 25

  // Project Details Section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Project Details', margin, y)
  y += 3
  doc.line(margin, y, pageWidth - margin, y)
  y += 15

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const scopeText = `Scope Of Work: ${contract.scope_roof_replacement ? '[X]' : '[ ]'} Roof Replacement  ${contract.scope_roof_repair ? '[X]' : '[ ]'} Roof Repair  ${contract.scope_gutters ? '[X]' : '[ ]'} Gutters  ${contract.scope_siding ? '[X]' : '[ ]'} Siding`
  doc.text(scopeText, margin, y)
  y += 16
  if (contract.scope_other) {
    doc.text(`Other: ${contract.scope_other}`, margin, y)
    y += 16
  }
  doc.text(`Primary Roofing System / Material: ${contract.roofing_material || ''}`, margin, y)
  y += 16
  doc.text(`Total Squares: ${contract.total_squares || ''}`, margin, y)
  doc.text(`Project Cost: ${formatCurrency(contract.project_cost)}`, 300, y)
  y += 16
  doc.text(`Est. Completion Date: ${formatDate(contract.est_completion_date)}`, margin, y)
  y += 16

  if (contract.exclusions) {
    doc.text('Exclusions / Observations:', margin, y)
    y += 14
    doc.setFontSize(9)
    const exclusionLines = wrapText(doc, contract.exclusions, contentWidth)
    for (const line of exclusionLines) {
      checkNewPage()
      doc.text(line, margin, y)
      y += 12
    }
    y += 5
    doc.setFontSize(10)
  }

  if (contract.additional_products) {
    doc.text('Additional Products:', margin, y)
    y += 14
    doc.setFontSize(9)
    const productLines = wrapText(doc, contract.additional_products, contentWidth)
    for (const line of productLines) {
      checkNewPage()
      doc.text(line, margin, y)
      y += 12
    }
    y += 5
    doc.setFontSize(10)
  }
  y += 10

  // Payment Details Section
  checkNewPage(100)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Payment Details', margin, y)
  y += 3
  doc.line(margin, y, pageWidth - margin, y)
  y += 15

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const paymentMethodText = contract.payment_method === 'finance' 
    ? `Finance Co: ${contract.finance_company || ''}`
    : contract.payment_method === 'cash' ? 'Cash'
    : contract.payment_method === 'insurance' ? 'Insurance Claim'
    : contract.payment_method || ''
  doc.text(`Payment Method: ${paymentMethodText}`, margin, y)
  y += 16
  doc.text(`Deposit: ${formatCurrency(contract.deposit_amount)} (Due At Signing)`, margin, y)
  y += 16

  if (contract.notes) {
    doc.text('Notes:', margin, y)
    y += 14
    doc.setFontSize(9)
    const noteLines = wrapText(doc, contract.notes, contentWidth)
    for (const line of noteLines) {
      checkNewPage()
      doc.text(line, margin, y)
      y += 12
    }
    y += 5
    doc.setFontSize(10)
  }
  y += 20

  // Signature Block
  checkNewPage(180)
  doc.setFontSize(8)
  const legalText = 'By signing below, the undersigned represents that (i) he or she has read the above Order Form and the Terms and Conditions (collectively, the "Agreement") in its entirety, and (ii) he or she agrees to be bound by the terms and conditions of the Agreement.'
  const legalLines = wrapText(doc, legalText, contentWidth)
  for (const line of legalLines) {
    doc.text(line, margin, y)
    y += 11
  }
  y += 20

  // Two column signatures
  const leftCol = margin
  const rightCol = 320

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Customer', leftCol, y)
  doc.text('ARX Roofing & Exteriors', rightCol, y)
  y += 18

  doc.setFont('helvetica', 'normal')
  doc.text(`Print Name: ${contract.customer_print_name || ''}`, leftCol, y)
  doc.text(`Print Name: ${contract.rep_name || ''}`, rightCol, y)
  y += 16

  doc.text('Signature:', leftCol, y)
  doc.text('Signature:', rightCol, y)
  y += 5

  // Draw signature boxes
  doc.rect(leftCol, y, 150, 40)
  doc.rect(rightCol, y, 150, 40)
  
  // Add signature images if available
  if (contract.customer_signature_data) {
    try {
      doc.addImage(contract.customer_signature_data, 'PNG', leftCol + 2, y + 2, 146, 36)
    } catch (e) {
      doc.setFontSize(8)
      doc.text('[Signature on file]', leftCol + 10, y + 22)
    }
  }
  if (contract.rep_signature_data) {
    try {
      doc.addImage(contract.rep_signature_data, 'PNG', rightCol + 2, y + 2, 146, 36)
    } catch (e) {
      doc.setFontSize(8)
      doc.text('[Signature on file]', rightCol + 10, y + 22)
    }
  }
  y += 50

  doc.setFontSize(10)
  doc.text(`Date: ${formatDate(contract.customer_signed_at)}`, leftCol, y)
  doc.text(`Title: ${contract.rep_title || ''}`, rightCol, y)
  y += 16
  doc.text('', leftCol, y)
  doc.text(`Date: ${formatDate(contract.rep_signed_at)}`, rightCol, y)

  // Audit info
  if (contract.customer_ip && contract.customer_signed_at) {
    y += 25
    doc.setFontSize(7)
    doc.setTextColor(100)
    doc.text(`Signed electronically from IP: ${contract.customer_ip} on ${new Date(contract.customer_signed_at).toISOString()}`, margin, y)
    doc.setTextColor(0)
  }

  addPageNumber()

  // PAGES 3-5: Terms and Conditions
  doc.addPage()
  pageNum++
  y = margin

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Terms And Conditions', pageWidth / 2, y, { align: 'center' })
  y += 25

  const terms = getTermsAndConditions()
  
  for (const section of terms) {
    checkNewPage(40)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(section.title, margin, y)
    y += 14
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    
    for (const paragraph of section.content) {
      const lines = wrapText(doc, paragraph, contentWidth)
      for (const line of lines) {
        checkNewPage(12)
        doc.text(line, margin, y)
        y += 11
      }
      y += 4
    }
    y += 8
  }

  addPageNumber()

  // PAGE 6: Customer Acknowledgements
  doc.addPage()
  pageNum++
  y = margin

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Customer Acknowledgements', pageWidth / 2, y, { align: 'center' })
  y += 30

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')

  const acknowledgements = [
    { label: 'Change Orders', text: 'I understand additional work beyond the Base Scope requires a signed change order.', initials: contract.customer_initials_change_orders },
    { label: 'Property Condition', text: 'I affirm there are no known structural defects (rotted rafters, sagging roof lines, etc.) other than disclosed in writing.', initials: contract.customer_initials_property_condition },
    { label: 'Landscaping/Cosmetic Impacts', text: 'I understand incidental cosmetic impacts may occur as described in Section 8.', initials: contract.customer_initials_landscaping },
    { label: 'Insurance Funds (if applicable)', text: 'I agree to Section 11.', initials: contract.customer_initials_insurance },
  ]

  for (const ack of acknowledgements) {
    checkNewPage(60)
    doc.setFont('helvetica', 'bold')
    doc.text(`${ack.label}:`, margin, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    const ackLines = wrapText(doc, ack.text, contentWidth - 100)
    for (const line of ackLines) {
      doc.text(line, margin, y)
      y += 12
    }
    y += 5
    doc.text(`Customer Initials: ${ack.initials || '________'}`, margin, y)
    y += 30
  }

  addPageNumber()

  // PAGE 7: Notice of Cancellation
  doc.addPage()
  pageNum++
  y = margin

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Notice of Cancellation', pageWidth / 2, y, { align: 'center' })
  y += 30

  const signingDate = contract.customer_signed_at ? new Date(contract.customer_signed_at) : new Date()
  const cancellationDeadline = addBusinessDays(signingDate, 3)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Date of Transaction: ${formatDate(contract.customer_signed_at)}`, margin, y)
  y += 25

  doc.setFont('helvetica', 'bold')
  doc.text(`NOT LATER THAN MIDNIGHT OF: ${formatDate(cancellationDeadline.toISOString())}`, margin, y)
  y += 30

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  const cancellationText = `You may CANCEL this transaction, without any Penalty or Obligation, within THREE BUSINESS DAYS from the above date.

If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within TEN BUSINESS DAYS following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be cancelled.

If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller's expense and risk.

If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation.

To cancel this transaction, mail or deliver a signed and dated copy of this cancellation notice or any other written notice to:

ARX Roofing & Exteriors LLC
4101 Woodbury Terrace NW
Concord, NC 28027

NOT LATER THAN MIDNIGHT OF ${formatDate(cancellationDeadline.toISOString())}`

  const cancellationLines = wrapText(doc, cancellationText, contentWidth)
  for (const line of cancellationLines) {
    checkNewPage(12)
    doc.text(line, margin, y)
    y += 12
  }
  y += 30

  doc.setFontSize(10)
  doc.text('I HEREBY CANCEL THIS TRANSACTION.', margin, y)
  y += 30
  
  doc.text('Printed Name: _________________________________', margin, y)
  y += 30
  
  doc.text('Signature: _________________________________', margin, y)
  y += 30
  
  doc.text('Date: _________________________________', margin, y)

  addPageNumber()

  // Convert to Buffer
  const pdfOutput = doc.output('arraybuffer')
  return Buffer.from(pdfOutput)
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
}
