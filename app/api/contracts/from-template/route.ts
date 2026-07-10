import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isBarredFromSalesDocApis } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

export async function POST(request: Request) {
  const { profile } = await requireAuthApi()

  if (isBarredFromSalesDocApis(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createClient()
  const formData = await request.formData()
  const projectId = String(formData.get('project_id') ?? '')
  const templateId = String(formData.get('template_id') ?? '')

  if (!projectId || !templateId) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  let projectQuery = supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', profile.org_id)

  if (profile.role === 'rep') {
    projectQuery = projectQuery.eq('owner_user_id', profile.id)
  }

  const { data: project } = await projectQuery.single()
  if (!project) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  const { data: template } = await supabase
    .from('contract_templates')
    .select('*')
    .eq('id', templateId)
    .eq('org_id', profile.org_id)
    .single()

  if (!template) {
    return NextResponse.redirect(new URL(`/projects/${projectId}`, request.url), { status: 303 })
  }

  await supabase
    .from('contracts')
    .update({ status: 'superseded' })
    .eq('project_id', projectId)
    .eq('org_id', profile.org_id)
    .in('status', ['sent', 'rep_signed', 'customer_signed'])

  const { data: created } = await supabase
    .from('contracts')
    .insert({
    org_id: profile.org_id,
    project_id: projectId,
    contract_pdf_path: template.storage_path,
    token: randomUUID(),
    status: 'sent',
  })
    .select('token')
    .single()

  await supabase
    .from('projects')
    .update({ contract_pdf_path: template.storage_path })
    .eq('id', projectId)
    .eq('org_id', profile.org_id)

  if (created?.token) {
    return NextResponse.redirect(new URL(`/contracts/${created.token}/rep`, request.url), {
      status: 303,
    })
  }

  return NextResponse.redirect(new URL(`/projects/${projectId}`, request.url), { status: 303 })
}
