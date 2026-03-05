import { jsPDF } from 'jspdf'

export interface ChangeOrderData {
  coNumber: string
  date: string
  customerName: string
  projectAddress: string
  originalAmount: number
  updatedTotal: number
  updatedRemaining: number
  description: string
  customerPrintName: string
  customerSignature: string
  repName: string
  repSignature: string
  originalContractDate: string | null
}

function formatDate(dateStr?: string | null): string {
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

export async function generateChangeOrderPdf(data: ChangeOrderData): Promise<Buffer> {
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

  // ARX Header (reused from Installation Agreement)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('ARX ROOFING & EXTERIORS LLC', pageWidth / 2, y, { align: 'center' })
  y += 18
  
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('4101 Woodbury Terrace NW, Concord, NC 28027 | 704-313-8834 | info@arxroofing.com', pageWidth / 2, y, { align: 'center' })
  y += 30

  // Title
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text('CHANGE ORDER', pageWidth / 2, y, { align: 'center' })
  y += 30

  // CO Number and Date
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`Change Order #: ${data.coNumber}`, margin, y)
  doc.text(`Date: ${formatDate(data.date)}`, pageWidth - margin - 150, y)
  y += 25

  // Divider
  doc.line(margin, y, pageWidth - margin, y)
  y += 20

  // Customer Info Section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Customer Information', margin, y)
  y += 18

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Customer Name: ${data.customerName}`, margin, y)
  y += 16
  doc.text(`Job Address: ${data.projectAddress}`, margin, y)
  y += 25

  // Financial Section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Financial Details', margin, y)
  y += 3
  doc.line(margin, y, pageWidth - margin, y)
  y += 18

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  
  // Original Amount
  doc.text('Original Contract Amount:', margin, y)
  doc.setFont('helvetica', 'bold')
  doc.text(formatCurrency(data.originalAmount), margin + 180, y)
  y += 18

  // Updated Total
  doc.setFont('helvetica', 'normal')
  doc.text('Updated Total Project Cost:', margin, y)
  doc.setFont('helvetica', 'bold')
  doc.text(formatCurrency(data.updatedTotal), margin + 180, y)
  y += 18

  // Change Amount
  const changeAmount = data.updatedTotal - data.originalAmount
  doc.setFont('helvetica', 'normal')
  doc.text('Change Amount:', margin, y)
  doc.setFont('helvetica', 'bold')
  const changeText = changeAmount >= 0 ? `+${formatCurrency(changeAmount)}` : formatCurrency(changeAmount)
  doc.setTextColor(changeAmount >= 0 ? 0 : 180, changeAmount >= 0 ? 100 : 0, 0)
  doc.text(changeText, margin + 180, y)
  doc.setTextColor(0)
  y += 18

  // Updated Remaining
  doc.setFont('helvetica', 'normal')
  doc.text('Updated Remaining Balance:', margin, y)
  doc.setFont('helvetica', 'bold')
  doc.text(formatCurrency(data.updatedRemaining), margin + 180, y)
  y += 30

  // Description Section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Description of Change', margin, y)
  y += 3
  doc.line(margin, y, pageWidth - margin, y)
  y += 18

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const descriptionLines = wrapText(doc, data.description, contentWidth)
  for (const line of descriptionLines) {
    doc.text(line, margin, y)
    y += 14
  }
  y += 20

  // Agreement Text
  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  const agreementText = 'By signing below, both parties agree to the changes described above. The customer acknowledges that the updated total project cost and remaining balance are accurate.'
  const agreementLines = wrapText(doc, agreementText, contentWidth)
  for (const line of agreementLines) {
    doc.text(line, margin, y)
    y += 12
  }
  y += 25

  // Signature Block (reused structure from Installation Agreement)
  const leftCol = margin
  const rightCol = 320

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Customer', leftCol, y)
  doc.text('ARX Roofing & Exteriors', rightCol, y)
  y += 18

  doc.setFont('helvetica', 'normal')
  doc.text(`Print Name: ${data.customerPrintName}`, leftCol, y)
  doc.text(`Print Name: ${data.repName}`, rightCol, y)
  y += 16

  doc.text('Signature:', leftCol, y)
  doc.text('Signature:', rightCol, y)
  y += 5

  // Draw signature boxes
  doc.rect(leftCol, y, 150, 40)
  doc.rect(rightCol, y, 150, 40)
  
  // Add signature images
  if (data.customerSignature) {
    try {
      doc.addImage(data.customerSignature, 'PNG', leftCol + 2, y + 2, 146, 36)
    } catch (e) {
      doc.setFontSize(8)
      doc.text('[Signature on file]', leftCol + 10, y + 22)
    }
  }
  if (data.repSignature) {
    try {
      doc.addImage(data.repSignature, 'PNG', rightCol + 2, y + 2, 146, 36)
    } catch (e) {
      doc.setFontSize(8)
      doc.text('[Signature on file]', rightCol + 10, y + 22)
    }
  }
  y += 50

  doc.setFontSize(10)
  doc.text(`Date: ${formatDate(data.date)}`, leftCol, y)
  doc.text(`Date: ${formatDate(data.date)}`, rightCol, y)
  y += 40

  // Footer - Reference to original contract
  doc.setFontSize(8)
  doc.setTextColor(80)
  const footerText = data.originalContractDate 
    ? `This change order modifies the original Installation Agreement dated ${formatDate(data.originalContractDate)}. The original Installation Agreement remains in full effect except as modified herein.`
    : 'This change order modifies the original Installation Agreement. The original Installation Agreement remains in full effect except as modified herein.'
  
  const footerLines = wrapText(doc, footerText, contentWidth)
  for (const line of footerLines) {
    doc.text(line, margin, y)
    y += 11
  }
  
  // Page footer
  doc.setTextColor(100)
  doc.text(`${data.coNumber} | ARX Roofing & Exteriors LLC`, pageWidth / 2, pageHeight - 30, { align: 'center' })

  // Convert to Buffer
  const pdfOutput = doc.output('arraybuffer')
  return Buffer.from(pdfOutput)
}
