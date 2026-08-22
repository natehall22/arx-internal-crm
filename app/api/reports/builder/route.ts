import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { canAccessReportsFromPermissionNames, canCreateReportsFromPermissionNames, canExportReportsFromPermissionNames, getReportScopeFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

function getAuthClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  
  const authHeader = request.headers.get('authorization')
  const cookieHeader = request.headers.get('cookie')
  
  let accessToken: string | null = null
  
  if (authHeader?.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7)
  } else if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = value
      return acc
    }, {} as Record<string, string>)
    
    const tokenCookie = Object.keys(cookies).find(key => 
      key.includes('auth-token') || key.includes('sb-') && key.includes('-auth-token')
    )
    if (tokenCookie) {
      try {
        const tokenData = JSON.parse(decodeURIComponent(cookies[tokenCookie]))
        accessToken = tokenData.access_token || tokenData
      } catch {
        accessToken = cookies[tokenCookie]
      }
    }
  }
  
  const client = createAnonClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })
  
  return { client, accessToken }
}

function canEditReport(input: {
  report: { created_by?: string | null }
  userId: string
  role?: string | null
}) {
  return ['admin', 'owner'].includes(String(input.role || '').toLowerCase()) || input.report.created_by === input.userId
}

// GET - Load user profile and initial data
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const adminClient = createServiceClient()
    
    // Get user profile
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()
    
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const reportPermissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canAccessReportsFromPermissionNames(reportPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    
    // Get users in org
    const { data: users } = await adminClient
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile.org_id)
    
    // Get custom roles
    const { data: roles } = await adminClient
      .from('custom_roles')
      .select('*')
      .eq('org_id', profile.org_id)
    
    return NextResponse.json({
      profile,
      users: users || [],
      roles: roles || [],
      canCreateReports: canCreateReportsFromPermissionNames(reportPermissions),
      canExportReports: canExportReportsFromPermissionNames(reportPermissions),
      reportScope: getReportScopeFromPermissionNames(reportPermissions),
    })
    
  } catch (error) {
    console.error('Reports builder GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create or update a report
export async function POST(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const adminClient = createServiceClient()
    
    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()
    
    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const reportPermissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canCreateReportsFromPermissionNames(reportPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    
    const body = await request.json()
    const {
      editId,
      name,
      description,
      reportType,
      dataSource,
      config,
      isPublic,
      isDashboardWidget,
      roleAccess,
    } = body
    
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Report name is required' }, { status: 400 })
    }
    
    // Map canvass_activity to leads for storage
    const storedDataSource = dataSource === 'canvass_activity' ? 'leads' : dataSource
    const storedConfig = dataSource === 'canvass_activity' 
      ? { ...config, isCanvassActivity: true }
      : config
    
    if (editId) {
      const { data: existingReport, error: existingError } = await adminClient
        .from('custom_reports')
        .select('id, org_id, created_by')
        .eq('id', editId)
        .eq('org_id', profile.org_id)
        .single()

      if (existingError || !existingReport) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 })
      }

      if (!canEditReport({ report: existingReport, userId: user.id, role: profile.role })) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }

      // Update existing report
      const { error: updateError } = await adminClient
        .from('custom_reports')
        .update({
          name,
          description,
          report_type: reportType,
          data_source: storedDataSource,
          config: storedConfig,
          is_public: isPublic,
          is_dashboard_widget: isDashboardWidget,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editId)
        .eq('org_id', profile.org_id)
      
      if (updateError) {
        console.error('Update report error:', updateError)
        return NextResponse.json({ error: `Failed to update report: ${updateError.message}` }, { status: 500 })
      }
      
      // Update role access
      await adminClient
        .from('report_role_access')
        .delete()
        .eq('report_id', editId)
      
      const accessRecords = Object.entries(roleAccess || {})
        .filter(([_, canView]) => canView)
        .map(([role]) => ({
          report_id: editId,
          role,
          can_view: true,
          can_edit: role === 'admin',
        }))
      
      if (accessRecords.length > 0) {
        await adminClient
          .from('report_role_access')
          .insert(accessRecords)
      }
      
      return NextResponse.json({ success: true, id: editId })
      
    } else {
      // Create new report
      const { data: newReport, error: insertError } = await adminClient
        .from('custom_reports')
        .insert({
          org_id: profile.org_id,
          created_by: user.id,
          name,
          description,
          report_type: reportType,
          data_source: storedDataSource,
          config: storedConfig,
          is_public: isPublic,
          is_dashboard_widget: isDashboardWidget,
        })
        .select()
        .single()
      
      if (insertError) {
        console.error('Insert report error:', insertError)
        if (insertError.message?.includes('custom_reports') || insertError.code === '42P01') {
          return NextResponse.json({ 
            error: 'The reports table has not been set up. Please ask your admin to run the database migration.' 
          }, { status: 500 })
        }
        return NextResponse.json({ error: `Failed to create report: ${insertError.message}` }, { status: 500 })
      }
      
      // Add role access
      const accessRecords = Object.entries(roleAccess || {})
        .filter(([_, canView]) => canView)
        .map(([role]) => ({
          report_id: newReport.id,
          role,
          can_view: true,
          can_edit: role === 'admin',
        }))
      
      if (accessRecords.length > 0) {
        await adminClient
          .from('report_role_access')
          .insert(accessRecords)
      }
      
      return NextResponse.json({ success: true, id: newReport.id })
    }
    
  } catch (error) {
    console.error('Reports builder POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
