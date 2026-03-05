import { jsPDF } from 'jspdf'

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

export async function generateContractPdf(contract: ContractData): Promise<Buffer> {
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
    { label: 'Insurance Funds (if applicable)', text: 'I agree to Section 11 regarding insurance claim projects.', initials: contract.customer_initials_insurance },
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
  doc.text('_________________________________', margin, y)
  y += 14
  doc.text('Customer Signature', margin, y)
  y += 30
  doc.text('_________________________________', margin, y)
  y += 14
  doc.text('Date', margin, y)

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
        '1.2 Standard Roof Replacement (if selected) generally includes: Tear-off and disposal of existing roofing materials. Underlayment, ice/water protection where code/conditions require, drip edge, flashings, and ventilation components as specified. Installation of new shingles/metal/roofing system per manufacturer instructions and code.',
        '1.3 Exclusions unless specifically included in writing: interior repairs, mold remediation, structural framing/rafter repairs, electrical/HVAC, chimney/brick/masonry repairs, skylight interior trim, gutter guards, deck/porch repairs.',
      ],
    },
    {
      title: 'Section 2 — Payment',
      content: [
        '2.1 Final payment is due immediately upon Substantial Completion of the Work or upon approval of the completed scope by any insurance carrier, whichever occurs first.',
        '2.2 If any payment is not made when due, ARX may suspend work until payment is received. Unpaid balances may accrue interest at 1.5% per month.',
      ],
    },
    {
      title: 'Section 3 — Property Conditions',
      content: [
        '3.1 Customer represents that the Property is in reasonably suitable condition for the Work and that no known structural defects exist.',
        '3.2 ARX is not responsible for pre-existing conditions, concealed defects, or conditions outside the Scope of Work.',
      ],
    },
    {
      title: 'Section 4 — Hidden Conditions & Decking',
      content: [
        '4.1 Roofing tear-off may reveal concealed damage. These are outside the Base Scope unless specifically listed.',
        '4.2 First 3 sheets of 4\'x8\' OSB/plywood are included. Additional decking will be billed via change order.',
      ],
    },
    {
      title: 'Section 5 — Change Orders',
      content: [
        '5.1 Any work, materials, or price changes must be documented in a written change order signed by both parties.',
      ],
    },
    {
      title: 'Section 6 — Scheduling & Access',
      content: [
        '6.1 Estimated dates are estimates only. Weather, permitting, and inspections may affect schedule.',
        '6.2 Customer must provide reasonable access and secure pets/children away from work area.',
      ],
    },
    {
      title: 'Section 7 — Permits & Compliance',
      content: [
        '7.1 ARX will obtain required permits. Permit fees are included in total project price.',
        '7.2 Customer is responsible for HOA approvals unless explicitly included.',
      ],
    },
    {
      title: 'Section 8 — Cleanup & Cosmetic Damage',
      content: [
        '8.1 ARX will remove debris and perform a magnet sweep.',
        '8.2 ARX is not responsible for ordinary incidental/cosmetic impacts.',
      ],
    },
    {
      title: 'Section 9 — Warranties',
      content: [
        '9.1 ARX warrants labor/workmanship for five (5) years from Substantial Completion.',
        '9.2 ARX provides a one (1) year no-leak guarantee on workmanship.',
        '9.3 Materials are warranted by their manufacturers.',
      ],
    },
    {
      title: 'Section 10 — Warranty Exclusions',
      content: [
        'Warranties do not cover: Storm events, foot traffic, misuse, improper ventilation, pre-existing conditions, normal wear and tear, or damage by other trades.',
      ],
    },
    {
      title: 'Section 11 — Insurance Claims',
      content: [
        '11.1 Customer remains responsible for deductible and non-covered amounts.',
        '11.2 Insurance funds issued to Customer shall be promptly remitted to ARX.',
      ],
    },
    {
      title: 'Section 12 — Termination',
      content: [
        '12.1 Customer may cancel within 3 business days as stated in Notice of Cancellation.',
        '12.2 If Customer terminates after work begins, Customer will pay for work performed.',
      ],
    },
    {
      title: 'Section 13 — Limitation of Liability',
      content: [
        '13.1 ARX\'s total liability will not exceed amounts paid under this Agreement.',
      ],
    },
    {
      title: 'Section 14 — Dispute Resolution',
      content: [
        '14.1 Disputes will first be resolved informally. Lawsuits must be filed in Cabarrus County, NC.',
      ],
    },
    {
      title: 'Section 15 — Entire Agreement',
      content: [
        '15.1 This Agreement is the entire understanding. Amendments must be in writing.',
        '15.2 Electronic signatures are treated as original signatures.',
      ],
    },
  ]
}
