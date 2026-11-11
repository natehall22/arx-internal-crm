import { jsPDF } from 'jspdf'

import type { DocumentBrand } from '@/lib/org-brand'
import {
  CONTINGENCY_TERMS,
  formatContractDate as formatDate,
  INSTALLATION_SIGNING_STATEMENT,
  INSTALLATION_TERMS,
  NOTICE_OF_CANCELLATION_CANCEL_LINE,
  NOTICE_OF_CANCELLATION_TITLE,
  noticeOfCancellation,
  REPAIR_TERMS,
} from '@/lib/contracts/terms'

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

function formatCurrency(amount?: number): string {
  if (amount === undefined || amount === null) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
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

function generateContingencyPdf(contract: ContractData, brand: DocumentBrand): Buffer {
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
  doc.text(brand.legalNameUpper, pageWidth / 2, y, { align: 'center' })
  y += 15
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`${brand.addressLine} | ${brand.phone} | ${brand.email}`, pageWidth / 2, y, { align: 'center' })
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
  if (contract.notes) addWrapped(`Notes: ${contract.notes}`)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('Terms', margin, y)
  y += 4
  doc.line(margin, y, pageWidth - margin, y)
  y += 12
  doc.setFont('helvetica', 'normal')
  for (const term of CONTINGENCY_TERMS) addWrapped(term)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.text(`Customer Initials: ${contract.customer_initials_insurance || '________'}`, margin, y)
  y += 22

  const leftCol = margin
  const rightCol = 320
  doc.text('Customer', leftCol, y)
  doc.text(brand.name, rightCol, y)
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
      if (contract.customer_signature_data.startsWith('typed:')) {
        // A typed approval (online quote): the typed name stands in for a drawn signature.
        doc.text(contract.customer_signature_data.slice(6), leftCol + 10, y + 22)
      } else {
        doc.addImage(contract.customer_signature_data, 'PNG', leftCol + 2, y + 2, 146, 34)
      }
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
  doc.text(`Page 1 of 1 | ${brand.legalName}`, pageWidth / 2, pageHeight - 24, { align: 'center' })

  return Buffer.from(doc.output('arraybuffer'))
}

function generateRepairPdf(contract: ContractData, brand: DocumentBrand): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = 612
  const pageHeight = 792
  const margin = 42
  const contentWidth = pageWidth - margin * 2
  let y = margin

  const addWrapped = (text: string, fontSize = 8.5, gap = 9) => {
    doc.setFontSize(fontSize)
    const lines = wrapText(doc, text, contentWidth)
    for (const line of lines) {
      doc.text(line, margin, y)
      y += gap
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(brand.legalNameUpper, pageWidth / 2, y, { align: 'center' })
  y += 15
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`${brand.addressLine} | ${brand.phone} | ${brand.email}`, pageWidth / 2, y, { align: 'center' })
  y += 24

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Repair Agreement', pageWidth / 2, y, { align: 'center' })
  y += 22

  doc.setFontSize(9)
  doc.text('Customer & property', margin, y)
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
  doc.text('Work and price', margin, y)
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
  ].filter(Boolean).join(', ') || 'As listed above'

  addWrapped(`Work: ${scope}`)
  addWrapped(`Price: ${formatCurrency(contract.project_cost)}`)
  if (contract.payment_method) {
    addWrapped(`Payment: ${contract.payment_method}${contract.payment_method === 'finance' && contract.finance_company ? ` (${contract.finance_company})` : ''}`)
  }
  if (contract.deposit_amount) {
    addWrapped(`Deposit: ${formatCurrency(contract.deposit_amount)}`)
  }
  if (contract.est_completion_date) {
    addWrapped(`Finish by about: ${formatDate(contract.est_completion_date)}`)
  }
  if (contract.exclusions) addWrapped(`Not included: ${contract.exclusions}`)
  if (contract.notes) addWrapped(`Notes: ${contract.notes}`)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('Terms', margin, y)
  y += 4
  doc.line(margin, y, pageWidth - margin, y)
  y += 10
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  for (const term of REPAIR_TERMS) addWrapped(term, 7.5, 8)
  doc.setFontSize(9)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Initials: ${contract.customer_initials_change_orders || '____'}`, margin, y)
  y += 22
  if (contract.payment_method === 'insurance' && contract.customer_initials_insurance) {
    doc.text(`Initials (insurance): ${contract.customer_initials_insurance}`, margin, y)
    y += 22
  }

  const leftCol = margin
  const rightCol = 320
  doc.text('Customer', leftCol, y)
  doc.text(brand.name, rightCol, y)
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
      if (contract.customer_signature_data.startsWith('typed:')) {
        // A typed approval (online quote): the typed name stands in for a drawn signature.
        doc.text(contract.customer_signature_data.slice(6), leftCol + 10, y + 22)
      } else {
        doc.addImage(contract.customer_signature_data, 'PNG', leftCol + 2, y + 2, 146, 34)
      }
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
  doc.text(`Page 1 of 1 | ${brand.legalName}`, pageWidth / 2, pageHeight - 24, { align: 'center' })

  return Buffer.from(doc.output('arraybuffer'))
}

/** Clause wording (lib/contracts/terms.ts) still names the original company; per-company templates are slice 2b (docs/multi-company-plan.md). */
export async function generateContractPdf(contract: ContractData, brand: DocumentBrand): Promise<Buffer> {
  if (contract.agreement_type === 'contingency') {
    return generateContingencyPdf(contract, brand)
  }
  if (contract.agreement_type === 'repair') {
    return generateRepairPdf(contract, brand)
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
    doc.text(`Page ${pageNum} of 7 | ${brand.legalName}`, pageWidth / 2, pageHeight - 30, { align: 'center' })
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
  doc.text(brand.legalNameUpper, pageWidth / 2, 200, { align: 'center' })
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(brand.addressLine, pageWidth / 2, 240, { align: 'center' })
  doc.text(`Phone: ${brand.phone} | Email: ${brand.email} | ${brand.website}`, pageWidth / 2, 255, { align: 'center' })
  
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
  doc.text(brand.legalNameUpper, pageWidth / 2, y, { align: 'center' })
  y += 18
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`${brand.addressLine} | ${brand.phone} | ${brand.email}`, pageWidth / 2, y, { align: 'center' })
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
  const legalText = INSTALLATION_SIGNING_STATEMENT
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
  doc.text(brand.name, rightCol, y)
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
      if (contract.customer_signature_data.startsWith('typed:')) {
        // A typed approval (online quote): the typed name stands in for a drawn signature.
        doc.text(contract.customer_signature_data.slice(6), leftCol + 10, y + 22)
      } else {
        doc.addImage(contract.customer_signature_data, 'PNG', leftCol + 2, y + 2, 146, 36)
      }
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

  for (const section of INSTALLATION_TERMS) {
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
  doc.text(NOTICE_OF_CANCELLATION_TITLE, pageWidth / 2, y, { align: 'center' })
  y += 30

  const notice = noticeOfCancellation(contract.customer_signed_at, brand)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Date of Transaction: ${notice.transactionDate}`, margin, y)
  y += 25

  doc.setFont('helvetica', 'bold')
  doc.text(`NOT LATER THAN MIDNIGHT OF: ${notice.deadline}`, margin, y)
  y += 30

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  const cancellationLines = wrapText(doc, notice.body, contentWidth)
  for (const line of cancellationLines) {
    checkNewPage(12)
    doc.text(line, margin, y)
    y += 12
  }
  y += 30

  doc.setFontSize(10)
  doc.text(NOTICE_OF_CANCELLATION_CANCEL_LINE, margin, y)
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
