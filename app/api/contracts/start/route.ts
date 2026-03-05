import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()
  const formData = await request.formData()
  const projectId = String(formData.get('project_id') ?? '')

  if (!projectId) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  let projectQuery = supabase
    .from('projects')
    .select('id, org_id')
    .eq('id', projectId)
    .eq('org_id', profile.org_id)

  if (profile.role === 'rep') {
    projectQuery = projectQuery.eq('owner_user_id', profile.id)
  }

  const { data: project } = await projectQuery.single()
  if (!project) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  const { data: contract } = await supabase
    .from('contracts')
    .select('*')
    .eq('project_id', projectId)
    .not('status', 'in', '(superseded,voided)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!contract) {
    return NextResponse.redirect(new URL(`/projects/${projectId}`, request.url), { status: 303 })
  }

  await supabase
    .from('projects')
    .update({ contract_sent_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('org_id', profile.org_id)

  await supabase.from('activities').insert({
    org_id: profile.org_id,
    project_id: projectId,
    user_id: profile.id,
    type: 'status_change',
    body: 'Contract sent to customer.',
  })

  return NextResponse.redirect(new URL(`/contracts/${contract.token}/rep`, request.url), {
    status: 303,
  })
}
