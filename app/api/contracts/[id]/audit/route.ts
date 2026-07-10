import React from 'react'
import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { ContractAuditPDF } from '@/lib/pdf/ContractAuditPDF'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { authUser, profile } = await requireAuthApi()
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, authUser.id, profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, audit_pdf_path')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!contract) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
  }

  if (!contract?.audit_pdf_path) {
    const { data: fullContract } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!fullContract) {
      return NextResponse.json({ error: 'Audit trail not found' }, { status: 404 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, org_id')
      .eq('id', fullContract.project_id)
      .eq('org_id', profile.org_id)
      .single()

    const auditPdf = React.createElement(ContractAuditPDF, {
      data: {
        orgName: null,
        jobId: fullContract.project_id,
        contractId: fullContract.id,
        contractPath: fullContract.contract_pdf_path,
        signedName: fullContract.signed_name,
        signedEmail: fullContract.signed_email,
        signedAt: fullContract.signed_at,
        signedLocation: fullContract.signed_location_text,
        signedIp: fullContract.signed_ip,
        signedUserAgent: fullContract.signed_user_agent,
      },
    }) as unknown as React.ReactElement

    const pdfBuffer = await renderToBuffer(auditPdf)
    const auditPath = `org/${project?.org_id ?? profile.org_id}/contracts/audit/${fullContract.id}.pdf`

    await serviceSupabase.storage.from('files').upload(auditPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

    await supabase
      .from('contracts')
      .update({ audit_pdf_path: auditPath })
      .eq('id', fullContract.id)

    contract.audit_pdf_path = auditPath
  }

  const { data: urlData, error } = await serviceSupabase.storage
    .from('files')
    .createSignedUrl(contract.audit_pdf_path, 3600)

  if (error || !urlData) {
    return NextResponse.json({ error: 'Failed to create download URL' }, { status: 500 })
  }

  return NextResponse.redirect(urlData.signedUrl, { status: 302 })
}
