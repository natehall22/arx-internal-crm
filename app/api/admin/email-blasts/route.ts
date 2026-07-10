import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  EMAIL_BLAST_DEFINITIONS,
  EMAIL_BLAST_ROLE_OPTIONS,
  getOrgEmailBlastSettings,
  mergeOrgSettingsWithEmailBlasts,
  MORNING_UPDATE_CONFIG_ROLES,
} from '@/lib/admin-email-blasts'

const ADMIN_EMAIL_BLAST_ROLES = new Set([
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'operations',
])

export async function GET() {
  try {
    const { profile } = await requireAuthApi()

    if (!ADMIN_EMAIL_BLAST_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const [{ data: org, error: orgError }, { data: users, error: usersError }] = await Promise.all([
      supabase
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single(),
      supabase
        .from('users')
        .select('id, full_name, email, role, active')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('full_name', { ascending: true }),
    ])

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 400 })
    }

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 400 })
    }

    return NextResponse.json({
      definitions: EMAIL_BLAST_DEFINITIONS,
      roleOptions: EMAIL_BLAST_ROLE_OPTIONS,
      settings: getOrgEmailBlastSettings(org?.settings),
      users: (users || []).filter((user) => typeof user.email === 'string' && user.email.includes('@')),
    })
  } catch (error: any) {
    console.error('GET /api/admin/email-blasts error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load email blast settings' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { profile } = await requireAuthApi()

    if (!ADMIN_EMAIL_BLAST_ROLES.has(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const supabase = createServiceClient()

    const { data: org, error: orgError } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 400 })
    }

    const settings = getOrgEmailBlastSettings(body?.settings)
    const existingSettings = getOrgEmailBlastSettings(org?.settings || {})
    const canConfigureMorningUpdate = MORNING_UPDATE_CONFIG_ROLES.has(profile.role as 'owner' | 'admin')
    const mergedBlastSettings = canConfigureMorningUpdate
      ? settings
      : {
          ...settings,
          morning_update: existingSettings.morning_update,
        }
    const mergedSettings = mergeOrgSettingsWithEmailBlasts(org?.settings || {}, mergedBlastSettings)

    const { error: updateError } = await supabase
      .from('orgs')
      .update({ settings: mergedSettings })
      .eq('id', profile.org_id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, settings: mergedBlastSettings })
  } catch (error: any) {
    console.error('PUT /api/admin/email-blasts error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to save email blast settings' }, { status: 500 })
  }
}
