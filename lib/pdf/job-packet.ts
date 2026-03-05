import { jsPDF } from 'jspdf'

interface LineItem {
  name: string
  description?: string | null
  category: string
  quantity: number
  unit: string
}

interface JobPacketData {
  job_number: string
  customer_name: string
  customer_phone: string
  address: string
  job_type: string
  scheduled_date: string | null
  scheduled_time_start: string | null
  estimated_duration_hours: number | null
  scope_of_work: string
  product_summary: string
  special_instructions: string
  line_items: LineItem[]
  shared_notes: { note: string; created_at: string }[]
  assigned_to: string
  permit_required: boolean
  permit_number: string | null
  photo_checklist: string[]
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

export async function generateJobPacketPDF(data: JobPacketData): Promise<Buffer> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  })

  const pageWidth = 612
  const pageHeight = 792
  const margin = 40
  const contentWidth = pageWidth - (margin * 2)
  let y = margin

  // Header
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('ARX Roofing & Exteriors, LLC', pageWidth / 2, y, { align: 'center' })
  y += 25

  doc.setFontSize(14)
  doc.text(`Job Packet - ${data.job_number}`, pageWidth / 2, y, { align: 'center' })
  y += 20

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, y, { align: 'center' })
  y += 25

  // Divider
  doc.line(margin, y, pageWidth - margin, y)
  y += 15

  // Job Info Section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('JOB INFORMATION', margin, y)
  y += 18

  doc.setFontSize(10)
  
  // Two column layout for job info
  const col1X = margin
  const col2X = 300

  doc.setFont('helvetica', 'bold')
  doc.text('Customer:', col1X, y)
  doc.setFont('helvetica', 'normal')
  doc.text(data.customer_name, col1X + 70, y)
  
  doc.setFont('helvetica', 'bold')
  doc.text('Phone:', col2X, y)
  doc.setFont('helvetica', 'normal')
  doc.text(data.customer_phone || 'N/A', col2X + 50, y)
  y += 15

  doc.setFont('helvetica', 'bold')
  doc.text('Address:', col1X, y)
  doc.setFont('helvetica', 'normal')
  const addressLines = wrapText(doc, data.address, 200)
  doc.text(addressLines[0] || '', col1X + 70, y)
  
  doc.setFont('helvetica', 'bold')
  doc.text('Job Type:', col2X, y)
  doc.setFont('helvetica', 'normal')
  doc.text(data.job_type.charAt(0).toUpperCase() + data.job_type.slice(1), col2X + 60, y)
  y += 15

  if (data.scheduled_date) {
    const schedDate = new Date(data.scheduled_date + 'T12:00:00')
    doc.setFont('helvetica', 'bold')
    doc.text('Install Date:', col1X, y)
    doc.setFont('helvetica', 'normal')
    doc.text(schedDate.toLocaleDateString('en-US', { 
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
    }), col1X + 70, y)
    
    if (data.scheduled_time_start) {
      doc.setFont('helvetica', 'bold')
      doc.text('Start Time:', col2X, y)
      doc.setFont('helvetica', 'normal')
      doc.text(data.scheduled_time_start, col2X + 65, y)
    }
    y += 15
  }

  doc.setFont('helvetica', 'bold')
  doc.text('Assigned To:', col1X, y)
  doc.setFont('helvetica', 'normal')
  doc.text(data.assigned_to, col1X + 75, y)
  
  if (data.estimated_duration_hours) {
    doc.setFont('helvetica', 'bold')
    doc.text('Est. Duration:', col2X, y)
    doc.setFont('helvetica', 'normal')
    doc.text(`${data.estimated_duration_hours} hours`, col2X + 80, y)
  }
  y += 15

  if (data.permit_required) {
    doc.setFont('helvetica', 'bold')
    doc.text('Permit #:', col1X, y)
    doc.setFont('helvetica', 'normal')
    doc.text(data.permit_number || 'Required - Check Status', col1X + 60, y)
    y += 15
  }

  y += 10

  // Product Section
  if (data.product_summary) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('PRODUCT', margin, y)
    y += 15

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    const productLines = wrapText(doc, data.product_summary, contentWidth)
    for (const line of productLines) {
      doc.text(line, margin, y)
      y += 12
    }
    y += 10
  }

  // Scope of Work Section
  if (data.scope_of_work) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('SCOPE OF WORK', margin, y)
    y += 15

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const scopeText = data.scope_of_work.substring(0, 500) + (data.scope_of_work.length > 500 ? '...' : '')
    const scopeLines = wrapText(doc, scopeText, contentWidth)
    for (const line of scopeLines) {
      if (y > pageHeight - 100) break
      doc.text(line, margin, y)
      y += 11
    }
    y += 10
  }

  // Line Items Section
  if (data.line_items.length > 0) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('WORK ITEMS', margin, y)
    y += 15

    // Table header
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Qty', margin, y)
    doc.text('Unit', margin + 45, y)
    doc.text('Description', margin + 100, y)
    y += 12

    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    // Table rows (limit to fit on page)
    doc.setFont('helvetica', 'normal')
    const maxItems = Math.min(data.line_items.length, 15)
    for (let i = 0; i < maxItems; i++) {
      const item = data.line_items[i]
      if (y > 650) break
      
      doc.text(String(item.quantity), margin, y)
      doc.text(item.unit, margin + 45, y)
      doc.text(item.name.substring(0, 60), margin + 100, y)
      y += 12
    }

    if (data.line_items.length > maxItems) {
      doc.setFont('helvetica', 'italic')
      doc.text(`... and ${data.line_items.length - maxItems} more items`, margin + 100, y)
      y += 12
    }

    y += 10
  }

  // Special Instructions
  if (data.special_instructions && y < 600) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('SPECIAL INSTRUCTIONS', margin, y)
    y += 15

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const instrText = data.special_instructions.substring(0, 300) + (data.special_instructions.length > 300 ? '...' : '')
    const instrLines = wrapText(doc, instrText, contentWidth - 10)
    
    const boxHeight = instrLines.length * 11 + 10
    doc.rect(margin, y - 2, contentWidth, boxHeight)
    
    for (const line of instrLines) {
      doc.text(line, margin + 5, y + 8)
      y += 11
    }
    y += 20
  }

  // Notes Section
  if (data.shared_notes.length > 0 && y < 650) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('NOTES', margin, y)
    y += 15

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    for (const note of data.shared_notes.slice(0, 3)) {
      if (y > 680) break
      const noteText = note.note.substring(0, 150) + (note.note.length > 150 ? '...' : '')
      const noteLines = wrapText(doc, `• ${noteText}`, contentWidth)
      for (const line of noteLines) {
        doc.text(line, margin, y)
        y += 11
      }
      y += 3
    }
    y += 10
  }

  // Photo Checklist (if space allows)
  if (y < 620 && data.photo_checklist.length > 0) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('PHOTO CHECKLIST', margin, y)
    y += 15

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const checklistCols = 3
    const colWidth = contentWidth / checklistCols
    
    data.photo_checklist.forEach((item, idx) => {
      const col = idx % checklistCols
      const row = Math.floor(idx / checklistCols)
      const itemY = y + (row * 15)
      const itemX = margin + (col * colWidth)
      
      doc.rect(itemX, itemY - 8, 10, 10)
      doc.text(item.substring(0, 20), itemX + 15, itemY)
    })
    
    y += Math.ceil(data.photo_checklist.length / checklistCols) * 15 + 15
  }

  // Signature Section at bottom
  const sigY = Math.max(y + 20, 700)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Crew Lead Signature:', margin, sigY)
  doc.line(150, sigY + 3, 300, sigY + 3)
  
  doc.text('Date:', 350, sigY)
  doc.line(385, sigY + 3, 500, sigY + 3)

  // Footer
  doc.setFontSize(8)
  doc.text('ARX Roofing & Exteriors, LLC - Confidential', pageWidth / 2, 750, { align: 'center' })

  // Convert to Buffer
  const pdfOutput = doc.output('arraybuffer')
  return Buffer.from(pdfOutput)
}
