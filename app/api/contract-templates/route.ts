import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()
  const formData = await request.formData()
  const name = String(formData.get('name') ?? '')
  const storagePath = String(formData.get('storage_path') ?? '')
  const projectId = String(formData.get('project_id') ?? '')

  if (!name || !storagePath) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  if (profile.role === 'rep') {
    return NextResponse.redirect(new URL(projectId ? `/projects/${projectId}` : '/projects', request.url), {
      status: 303,
    })
  }

  await supabase.from('contract_templates').insert({
    org_id: profile.org_id,
    name,
    storage_path: storagePath,
    active: true,
  })

  return NextResponse.redirect(new URL(projectId ? `/projects/${projectId}` : '/projects', request.url), {
    status: 303,
  })
}
