import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { jsPDF } from 'jspdf'
import { SupabaseClient } from '@supabase/supabase-js'
import { FILES_BUCKET, buildJobDocumentStoragePath } from '@/lib/files/storage'
import { newDocumentInsert } from '@/lib/files/documents'
import { ARX_DEFAULT_OFFICE_ADDRESS } from '@/lib/company-address'

export const COMPLETION_CERTIFICATE_CATEGORY = 'completion_certificate'
export const COMPLETION_CERTIFICATE_TITLE = 'Certificate of Completion'

/** Printed signature line for Authorized ARX Representative (certificate template). */
const COMPLETION_CERTIFICATE_AUTH_REP_NAME = 'Nathan Hall'

type JoinedCustomer = { id?: string | null; name?: string | null; email?: string | null; phone?: string | null }

function firstJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function safePdfFilename(jobNumber?: string | null) {
  const suffix = (jobNumber || 'job').replace(/[^A-Za-z0-9_-]/g, '_')
  return `certificate-of-completion-${suffix}.pdf`
}

function displayDate(value?: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function titleCase(value?: string | null) {
  if (!value) return 'Exterior'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Server-only PDF (jsPDF). Avoids @react-pdf/renderer in this path — Next/Vercel bundling
 * can throw "Component is not a constructor" when react-pdf is packed into route handlers.
 */
function buildCompletionCertificatePdfBuffer(args: {
  companyName: string
  companyAddress: string
  companyPhone: string | null
  companyEmail: string | null
  logoAbsolutePath?: string | null
  jobNumber?: string | null
  customerName: string
  propertyAddress: string
  jobType?: string | null
  workDescription?: string | null
  completionDate?: string | null
  generatedDate: string
}): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const innerPad = 34
  let y = margin + innerPad

  doc.setDrawColor(31, 41, 55)
  doc.setLineWidth(2)
  doc.rect(margin, margin, pageW - 2 * margin, pageH - 2 * margin)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(17, 24, 39)
  doc.text(args.companyName, pageW / 2, y, { align: 'center' })
  y += 22

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(75, 85, 99)
  const metaLines = [args.companyAddress]
  if (args.companyPhone) metaLines.push(args.companyPhone)
  if (args.companyEmail) metaLines.push(args.companyEmail)
  const meta = doc.splitTextToSize(metaLines.join('\n'), pageW - 2 * margin - 2 * innerPad)
  doc.text(meta, pageW / 2, y, { align: 'center' })
  y += meta.length * 12 + 8

  if (args.logoAbsolutePath && existsSync(args.logoAbsolutePath)) {
    try {
      const buf = readFileSync(args.logoAbsolutePath)
      const b64 = buf.toString('base64')
      const dataUrl = `data:image/png;base64,${b64}`
      doc.addImage(dataUrl, 'PNG', pageW / 2 - 58, y, 116, 78)
      y += 86
    } catch {
      /* skip broken logo */
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(15, 23, 42)
  doc.text('Certificate of Completion', pageW / 2, y, { align: 'center' })
  y += 28

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(71, 85, 105)
  doc.text('Issued as confirmation of completed work', pageW / 2, y, { align: 'center' })
  y += 28

  doc.setFontSize(13)
  doc.setTextColor(17, 24, 39)
  const workTypeDisplay = args.workDescription?.trim() || titleCase(args.jobType)
  const workTypePhrase = workTypeDisplay.toLowerCase()
  /** Custom work-type text (e.g. "Roofing and Interior Work") often already ends in "work" — don't double it. */
  const workTypeClause = /\bwork$/.test(workTypePhrase) ? workTypePhrase : `${workTypePhrase} work`
  const intro = doc.splitTextToSize(
    `This certifies that ${args.companyName} has completed the contracted ${workTypeClause} for the property listed below.`,
    pageW - 2 * margin - 2 * innerPad
  )
  doc.text(intro, pageW / 2, y, { align: 'center' })
  y += intro.length * 18 + 20

  const boxLeft = margin + innerPad
  const boxW = pageW - 2 * margin - 2 * innerPad
  const boxTop = y
  y += 14

  const rows: [string, string][] = [
    ['CUSTOMER', args.customerName],
    ['PROPERTY', args.propertyAddress || '—'],
    ['JOB NUMBER', args.jobNumber || 'Not assigned'],
    ['COMPLETION DATE', displayDate(args.completionDate)],
    ['WORK TYPE', workTypeDisplay],
  ]

  doc.setFontSize(10)
  for (let i = 0; i < rows.length; i++) {
    const [label, value] = rows[i]
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(107, 114, 128)
    doc.text(label, boxLeft + 12, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(17, 24, 39)
    const valueLines = doc.splitTextToSize(value, boxW * 0.62 - 24)
    doc.text(valueLines, boxLeft + boxW * 0.34, y)
    y += Math.max(16, valueLines.length * 12)
    if (i < rows.length - 1) {
      doc.setDrawColor(229, 231, 235)
      doc.line(boxLeft + 8, y - 4, boxLeft + boxW - 8, y - 4)
      y += 6
    }
  }

  y += 10
  doc.setDrawColor(209, 213, 219)
  doc.setLineWidth(0.5)
  doc.rect(boxLeft, boxTop, boxW, y - boxTop)

  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(55, 65, 81)
  const cert = doc.splitTextToSize(
    `Based on ${args.companyName} records, the above referenced job has been marked complete in the operations system. This certificate is provided as confirmation of completion for the customer file, mortgage company, insurance carrier, or other party requiring proof that the contracted work is complete.`,
    pageW - 2 * margin - 2 * innerPad
  )
  doc.text(cert, margin + innerPad, y)
  y += cert.length * 14 + 24

  const sigY = Math.min(pageH - margin - innerPad - 60, y + 20)
  const colW = (boxW - 24) / 2
  doc.setDrawColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(17, 24, 39)
  doc.text(COMPLETION_CERTIFICATE_AUTH_REP_NAME, boxLeft, sigY - 3)
  doc.setLineWidth(0.75)
  doc.line(boxLeft, sigY, boxLeft + colW, sigY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(75, 85, 99)
  doc.text('Authorized ARX Representative', boxLeft, sigY + 14)

  doc.text('Authorized ARX Representative', boxLeft, sigY + 14)

  const dateColLeft = boxLeft + colW + 24
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(17, 24, 39)
  doc.text(displayDate(args.generatedDate), dateColLeft, sigY - 3)
  doc.line(dateColLeft, sigY, boxLeft + boxW, sigY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(75, 85, 99)
  doc.text('Date Issued', dateColLeft, sigY + 14)

  doc.setFontSize(9)
  doc.setTextColor(107, 114, 128)
  doc.text(`${args.companyName} | Certificate generated from ARX CRM`, pageW / 2, pageH - margin - 12, {
    align: 'center',
  })

  return Buffer.from(doc.output('arraybuffer'))
}

export async function getExistingCompletionCertificate(
  supabase: SupabaseClient,
  args: { orgId: string; jobId: string }
) {
  const { data } = await supabase
    .from('documents')
    .select('id, title, filename, storage_path, updated_at')
    .eq('org_id', args.orgId)
    .eq('job_id', args.jobId)
    .eq('category', COMPLETION_CERTIFICATE_CATEGORY)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data || null
}

export async function generateCompletionCertificateDocument(
  supabase: SupabaseClient,
  args: {
    orgId: string
    jobId: string
    uploadedBy: string
    force?: boolean
    /** When provided, persisted to production_jobs and used as the certificate's WORK TYPE text instead of job_type. */
    workDescription?: string | null
  }
) {
  if (typeof args.workDescription === 'string') {
    const trimmed = args.workDescription.trim()
    await supabase
      .from('production_jobs')
      .update({ completion_certificate_work_description: trimmed || null })
      .eq('id', args.jobId)
      .eq('org_id', args.orgId)
  }

  if (!args.force) {
    const existing = await getExistingCompletionCertificate(supabase, args)
    if (existing) return { document: existing, generated: false }
  }

  const { data: job } = await supabase
    .from('production_jobs')
    .select(`
      id,
      org_id,
      customer_id,
      job_number,
      job_type,
      completion_certificate_work_description,
      status,
      address_text,
      completed_at,
      scheduled_date,
      customer:customers(id, name, email, phone)
    `)
    .eq('id', args.jobId)
    .eq('org_id', args.orgId)
    .single()

  if (!job) throw new Error('Job not found')

  const customer = firstJoin<JoinedCustomer>((job as any).customer)
  const generatedDate = new Date().toISOString()
  const logoPath = join(process.cwd(), 'public', 'brand', 'arx-shield.png')

  const pdfBuffer = buildCompletionCertificatePdfBuffer({
    companyName: 'ARX Roofing & Exteriors',
    companyAddress: ARX_DEFAULT_OFFICE_ADDRESS,
    companyPhone: '704-313-8834',
    companyEmail: 'info@arxroofing.com',
    logoAbsolutePath: logoPath,
    jobNumber: (job as any).job_number,
    customerName: customer?.name || 'Customer',
    propertyAddress: (job as any).address_text || '',
    jobType: (job as any).job_type,
    workDescription: (job as any).completion_certificate_work_description,
    completionDate: (job as any).completed_at || generatedDate,
    generatedDate,
  })

  const documentId = crypto.randomUUID()
  const filename = safePdfFilename((job as any).job_number)
  const storagePath = buildJobDocumentStoragePath({
    orgId: args.orgId,
    jobId: args.jobId,
    documentId,
    filename,
    folder: 'documents',
  })

  const { error: uploadError } = await supabase.storage.from(FILES_BUCKET).upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (uploadError) throw new Error(uploadError.message)

  const insertPayload = newDocumentInsert({
    orgId: args.orgId,
    jobId: args.jobId,
    customerId: (job as any).customer_id || customer?.id || null,
    linkedRecordType: null,
    linkedRecordId: null,
    /** Null when unlinked — DB check documents_linked_role_guard requires this */
    documentRole: null,
    storagePath,
    filename,
    fileSize: pdfBuffer.length,
    mimeType: 'application/pdf',
    category: COMPLETION_CERTIFICATE_CATEGORY,
    title: COMPLETION_CERTIFICATE_TITLE,
    description: 'Certificate confirming the job has been completed.',
    uploadedBy: args.uploadedBy,
  })

  const { data: document, error: insertError } = await supabase
    .from('documents')
    .insert({ id: documentId, ...insertPayload })
    .select('id, title, filename, storage_path, updated_at')
    .single()

  if (insertError) {
    await supabase.storage.from(FILES_BUCKET).remove([storagePath])
    throw new Error(insertError.message)
  }

  return { document, generated: true }
}
