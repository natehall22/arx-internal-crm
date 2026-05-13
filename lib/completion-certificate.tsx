import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { SupabaseClient } from '@supabase/supabase-js'
import { CompletionCertificatePDF } from '@/lib/pdf/CompletionCertificatePDF'
import { FILES_BUCKET, buildJobDocumentStoragePath } from '@/lib/files/storage'
import { newDocumentInsert } from '@/lib/files/documents'

export const COMPLETION_CERTIFICATE_CATEGORY = 'completion_certificate'
export const COMPLETION_CERTIFICATE_TITLE = 'Certificate of Completion'

type JoinedCustomer = { id?: string | null; name?: string | null; email?: string | null; phone?: string | null }

function firstJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function safePdfFilename(jobNumber?: string | null) {
  const suffix = (jobNumber || 'job').replace(/[^A-Za-z0-9_-]/g, '_')
  return `certificate-of-completion-${suffix}.pdf`
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
  args: { orgId: string; jobId: string; uploadedBy: string; force?: boolean }
) {
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
  const pdfBuffer = await renderToBuffer(
    <CompletionCertificatePDF
      companyName="ARX Roofing & Exteriors"
      companyAddress={'4101 Woodbury Ter NW\nConcord, NC 28027'}
      companyPhone="704-313-8834"
      companyEmail="info@arxroofing.com"
      logoSrc={`${process.cwd()}/public/brand/arx-shield.png`}
      jobNumber={(job as any).job_number}
      customerName={customer?.name || 'Customer'}
      propertyAddress={(job as any).address_text || ''}
      jobType={(job as any).job_type}
      completionDate={(job as any).completed_at || generatedDate}
      generatedDate={generatedDate}
    />
  )

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
    documentRole: 'customer_copy',
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
