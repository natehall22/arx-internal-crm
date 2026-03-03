import PDFDocument from 'pdfkit'

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

export async function generateJobPacketPDF(data: JobPacketData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 40,
        bufferPages: true,
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = doc.page.width - 80
      let y = 40

      // Header
      doc.fontSize(18).font('Helvetica-Bold')
      doc.text('ARX Roofing & Exteriors, LLC', 40, y, { align: 'center', width: pageWidth })
      y += 25

      doc.fontSize(14).font('Helvetica-Bold')
      doc.text(`Job Packet - ${data.job_number}`, 40, y, { align: 'center', width: pageWidth })
      y += 20

      doc.fontSize(10).font('Helvetica')
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 40, y, { align: 'center', width: pageWidth })
      y += 25

      // Divider
      doc.moveTo(40, y).lineTo(40 + pageWidth, y).stroke()
      y += 15

      // Job Info Section
      doc.fontSize(12).font('Helvetica-Bold')
      doc.text('JOB INFORMATION', 40, y)
      y += 15

      doc.fontSize(10).font('Helvetica')
      
      // Two column layout for job info
      const col1X = 40
      const col2X = 300

      doc.font('Helvetica-Bold').text('Customer:', col1X, y)
      doc.font('Helvetica').text(data.customer_name, col1X + 70, y)
      
      doc.font('Helvetica-Bold').text('Phone:', col2X, y)
      doc.font('Helvetica').text(data.customer_phone || 'N/A', col2X + 50, y)
      y += 15

      doc.font('Helvetica-Bold').text('Address:', col1X, y)
      doc.font('Helvetica').text(data.address, col1X + 70, y, { width: 200 })
      
      doc.font('Helvetica-Bold').text('Job Type:', col2X, y)
      doc.font('Helvetica').text(data.job_type.charAt(0).toUpperCase() + data.job_type.slice(1), col2X + 60, y)
      y += 15

      if (data.scheduled_date) {
        const schedDate = new Date(data.scheduled_date + 'T12:00:00')
        doc.font('Helvetica-Bold').text('Install Date:', col1X, y)
        doc.font('Helvetica').text(schedDate.toLocaleDateString('en-US', { 
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
        }), col1X + 70, y)
        
        if (data.scheduled_time_start) {
          doc.font('Helvetica-Bold').text('Start Time:', col2X, y)
          doc.font('Helvetica').text(data.scheduled_time_start, col2X + 65, y)
        }
        y += 15
      }

      doc.font('Helvetica-Bold').text('Assigned To:', col1X, y)
      doc.font('Helvetica').text(data.assigned_to, col1X + 75, y)
      
      if (data.estimated_duration_hours) {
        doc.font('Helvetica-Bold').text('Est. Duration:', col2X, y)
        doc.font('Helvetica').text(`${data.estimated_duration_hours} hours`, col2X + 80, y)
      }
      y += 15

      if (data.permit_required) {
        doc.font('Helvetica-Bold').text('Permit #:', col1X, y)
        doc.font('Helvetica').text(data.permit_number || 'Required - Check Status', col1X + 60, y)
        y += 15
      }

      y += 10

      // Product Section
      if (data.product_summary) {
        doc.fontSize(12).font('Helvetica-Bold')
        doc.text('PRODUCT', 40, y)
        y += 15

        doc.fontSize(10).font('Helvetica')
        doc.text(data.product_summary, 40, y, { width: pageWidth })
        y += doc.heightOfString(data.product_summary, { width: pageWidth }) + 10
      }

      // Scope of Work Section
      if (data.scope_of_work) {
        doc.fontSize(12).font('Helvetica-Bold')
        doc.text('SCOPE OF WORK', 40, y)
        y += 15

        doc.fontSize(9).font('Helvetica')
        const scopeText = data.scope_of_work.substring(0, 500) + (data.scope_of_work.length > 500 ? '...' : '')
        doc.text(scopeText, 40, y, { width: pageWidth })
        y += doc.heightOfString(scopeText, { width: pageWidth }) + 10
      }

      // Line Items Section
      if (data.line_items.length > 0) {
        doc.fontSize(12).font('Helvetica-Bold')
        doc.text('WORK ITEMS', 40, y)
        y += 15

        // Table header
        doc.fontSize(9).font('Helvetica-Bold')
        doc.text('Qty', 40, y, { width: 40 })
        doc.text('Unit', 85, y, { width: 50 })
        doc.text('Description', 140, y, { width: 300 })
        y += 12

        doc.moveTo(40, y).lineTo(40 + pageWidth, y).stroke()
        y += 5

        // Table rows (limit to fit on page)
        doc.font('Helvetica')
        const maxItems = Math.min(data.line_items.length, 15)
        for (let i = 0; i < maxItems; i++) {
          const item = data.line_items[i]
          if (y > 650) break
          
          doc.text(String(item.quantity), 40, y, { width: 40 })
          doc.text(item.unit, 85, y, { width: 50 })
          doc.text(item.name, 140, y, { width: 300 })
          y += 12
        }

        if (data.line_items.length > maxItems) {
          doc.font('Helvetica-Oblique')
          doc.text(`... and ${data.line_items.length - maxItems} more items`, 140, y)
          y += 12
        }

        y += 10
      }

      // Special Instructions
      if (data.special_instructions) {
        doc.fontSize(12).font('Helvetica-Bold')
        doc.text('SPECIAL INSTRUCTIONS', 40, y)
        y += 15

        doc.fontSize(9).font('Helvetica')
        const instrText = data.special_instructions.substring(0, 300) + (data.special_instructions.length > 300 ? '...' : '')
        doc.rect(40, y - 2, pageWidth, doc.heightOfString(instrText, { width: pageWidth - 10 }) + 10)
           .stroke()
        doc.text(instrText, 45, y + 3, { width: pageWidth - 10 })
        y += doc.heightOfString(instrText, { width: pageWidth - 10 }) + 20
      }

      // Notes Section
      if (data.shared_notes.length > 0) {
        doc.fontSize(12).font('Helvetica-Bold')
        doc.text('NOTES', 40, y)
        y += 15

        doc.fontSize(9).font('Helvetica')
        for (const note of data.shared_notes.slice(0, 3)) {
          if (y > 680) break
          const noteText = note.note.substring(0, 150) + (note.note.length > 150 ? '...' : '')
          doc.text(`• ${noteText}`, 40, y, { width: pageWidth })
          y += doc.heightOfString(`• ${noteText}`, { width: pageWidth }) + 5
        }
        y += 10
      }

      // Photo Checklist (if space allows)
      if (y < 620) {
        doc.fontSize(12).font('Helvetica-Bold')
        doc.text('PHOTO CHECKLIST', 40, y)
        y += 15

        doc.fontSize(9).font('Helvetica')
        const checklistCols = 3
        const colWidth = pageWidth / checklistCols
        
        data.photo_checklist.forEach((item, idx) => {
          const col = idx % checklistCols
          const row = Math.floor(idx / checklistCols)
          const itemY = y + (row * 15)
          const itemX = 40 + (col * colWidth)
          
          doc.rect(itemX, itemY, 10, 10).stroke()
          doc.text(item, itemX + 15, itemY + 1, { width: colWidth - 20 })
        })
        
        y += Math.ceil(data.photo_checklist.length / checklistCols) * 15 + 15
      }

      // Signature Section at bottom
      const sigY = Math.max(y + 20, 700)
      
      doc.fontSize(10).font('Helvetica')
      doc.text('Crew Lead Signature:', 40, sigY)
      doc.moveTo(150, sigY + 12).lineTo(300, sigY + 12).stroke()
      
      doc.text('Date:', 350, sigY)
      doc.moveTo(385, sigY + 12).lineTo(500, sigY + 12).stroke()

      // Footer
      doc.fontSize(8).font('Helvetica')
      doc.text('ARX Roofing & Exteriors, LLC - Confidential', 40, 750, { align: 'center', width: pageWidth })

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}
