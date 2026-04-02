import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = 'files'

function isPdfBlob(file: Blob, filename: string): boolean {
  const t = (file.type || '').toLowerCase()
  if (t === 'application/pdf' || t === 'application/x-pdf') return true
  if (t === '' || t === 'application/octet-stream') {
    return filename.toLowerCase().endsWith('.pdf')
  }
  return false
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()

    const { data: opportunity, error: oppErr } = await admin
      .from('opportunities')
      .select('id, org_id, status, owner_user_id, setter_user_id, leads(closer_user_id)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (oppErr || !opportunity) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const leadRow = opportunity.leads
      ? Array.isArray(opportunity.leads)
        ? opportunity.leads[0]
        : opportunity.leads
      : null
    const closerUserIdFromLead = (leadRow as { closer_user_id?: string | null } | null)
      ?.closer_user_id ?? null

    const repLikeRoles = ['rep', 'sales_rep', 'closer'] as const
    if (repLikeRoles.includes(profile.role as (typeof repLikeRoles)[number])) {
      const isOwner = opportunity.owner_user_id === profile.id
      const isSetter = opportunity.setter_user_id === profile.id
      const isLeadCloser = closerUserIdFromLead === profile.id
      if (!isOwner && !isSetter && !isLeadCloser) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const formData = await request.formData()
    const raw = formData.get('design_pdf')

    if (!raw || typeof raw === 'string' || !(raw instanceof Blob) || raw.size === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const originalName = raw instanceof File ? raw.name : 'design.pdf'
    const safeFilename =
      originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'design.pdf'

    if (!isPdfBlob(raw, originalName)) {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    const storagePath = `org/${profile.org_id}/opportunities/${params.id}/design/${Date.now()}_${safeFilename}`
    const fileBuffer = Buffer.from(await raw.arrayBuffer())

    const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, fileBuffer, {
      contentType: raw.type || 'application/pdf',
      upsert: false,
    })

    if (uploadError) {
      console.error('Design PDF upload error:', uploadError)
      return NextResponse.json(
        { error: uploadError.message || 'Storage upload failed' },
        { status: 500 }
      )
    }

    const { error: updateError } = await admin
      .from('opportunities')
      .update({
        design_pdf_path: storagePath,
        status: opportunity.status === 'open' ? 'in_progress' : opportunity.status,
      })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (updateError) {
      console.error('Design PDF DB update error:', updateError)
      await admin.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Failed to save design reference' }, { status: 500 })
    }

    await admin.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: params.id,
      user_id: profile.id,
      type: 'note',
      body: 'Design PDF uploaded.',
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'Unauthorized' || msg.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Design PDF route error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
