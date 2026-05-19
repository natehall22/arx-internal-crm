import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canAccessReportsFromPermissionNames, getReportScopeFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames, type EffectivePermissionsResult } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

/** Must match report builder + Reports UI; used when POST body includes dateRange override */
const VALID_CUSTOM_REPORT_DATE_RANGES = new Set([
  'week',
  '7d',
  '30d',
  '90d',
  'ytd',
  'all',
])

type ReportAccessProfile = {
  role: string
  custom_role_id?: string | null
}

type ReportAccessRow = {
  role?: string | null
  custom_role_id?: string | null
  can_view?: boolean | null
  can_edit?: boolean | null
}

function canAccessReport(input: {
  report: { created_by?: string | null; is_public?: boolean | null }
  userId: string
  profile: ReportAccessProfile
  roleAccess?: ReportAccessRow[]
  requireEdit?: boolean
}) {
  const { report, userId, profile, roleAccess = [], requireEdit = false } = input
  if (['admin', 'owner'].includes(String(profile.role || '').toLowerCase())) return true
  if (report.created_by === userId) return true
  if (!requireEdit && report.is_public) return true

  return roleAccess.some((ra) => {
    const roleMatches = ra.role === profile.role || ra.custom_role_id === profile.custom_role_id
    if (!roleMatches) return false
    return requireEdit ? ra.can_edit === true : ra.can_view === true
  })
}

async function getScopedUserIds(supabase: ReturnType<typeof getAdminClient>, profile: {
  role: string
  org_id: string
  id?: string
  team_id?: string | null
  region_id?: string | null
}, reportPermissions: EffectivePermissionsResult) {
  const scope = getReportScopeFromPermissionNames(reportPermissions)
  if (scope === 'all') return null
  if (scope === 'own') return profile.id ? [profile.id] : []

  if (scope === 'team') {
    if (!profile.team_id) return profile.id ? [profile.id] : []
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('team_id', profile.team_id)
    return (data || []).map((u) => u.id as string)
  }

  if (scope === 'region') {
    if (!profile.region_id) return profile.id ? [profile.id] : []
    const { data: teams } = await supabase
      .from('teams')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('region_id', profile.region_id)
    const teamIds = (teams || []).map((t) => t.id as string)
    if (teamIds.length === 0) return []
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', profile.org_id)
      .in('team_id', teamIds)
    return (data || []).map((u) => u.id as string)
  }

  return profile.id ? [profile.id] : []
}

function applyReportScope(query: any, dataSource: string, scopedUserIds: string[] | null) {
  if (scopedUserIds === null) return query
  if (scopedUserIds.length === 0) return query.limit(0)

  const list = scopedUserIds.join(',')
  switch (dataSource) {
    case 'leads':
    case 'canvass_activity':
      return query.or(`owner_user_id.in.(${list}),pin_attributed_user_id.in.(${list})`)
    case 'opportunities':
      return query.or(`owner_user_id.in.(${list}),setter_user_id.in.(${list})`)
    case 'appointments':
      return query.or(`canvasser_user_id.in.(${list}),closer_user_id.in.(${list})`)
    case 'projects':
      return query.in('owner_user_id', scopedUserIds)
    case 'inspection_outcomes':
      return query.or(`closer_user_id.in.(${list}),setter_user_id.in.(${list})`)
    default:
      return query
  }
}

function getReportDateColumn(dataSource: string): string {
  if (dataSource === 'inspection_outcomes') return 'completed_at'
  return 'created_at'
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

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
  
  const client = createServiceClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })
  
  return { client, accessToken }
}

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

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const reportPermissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canAccessReportsFromPermissionNames(reportPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const dashboardOnly = request.nextUrl.searchParams.get('dashboard') === 'true'
    const debug = request.nextUrl.searchParams.get('debug') === 'true'

    // Get all reports the user can access - use simple query first
    let query = adminClient
      .from('custom_reports')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (dashboardOnly) {
      query = query.eq('is_dashboard_widget', true)
    }

    const { data: reports, error } = await query

    if (error) {
      console.error('Reports fetch error:', error)
      // Check if table doesn't exist
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json({ reports: [], message: 'Custom reports table not yet created' })
      }
      return NextResponse.json({ error: 'Failed to fetch reports', details: error.message }, { status: 500 })
    }

    // Debug: return raw data if requested
    if (debug) {
      return NextResponse.json({
        debug: true,
        user_id: user.id,
        org_id: profile.org_id,
        dashboardOnly,
        raw_reports_count: reports?.length || 0,
        raw_reports: reports,
      })
    }

    // Fetch creator names separately to avoid foreign key issues
    const creatorIds = Array.from(new Set((reports || []).map(r => r.created_by).filter(Boolean)))
    let creatorMap: Record<string, string> = {}
    
    if (creatorIds.length > 0) {
      const { data: creators } = await adminClient
        .from('users')
        .select('id, full_name')
        .in('id', creatorIds)
      
      creatorMap = (creators || []).reduce((acc, c) => {
        acc[c.id] = c.full_name || 'Unknown'
        return acc
      }, {} as Record<string, string>)
    }

    // Fetch role access separately (ignore errors if table doesn't exist)
    const reportIds = (reports || []).map(r => r.id)
    let roleAccessMap: Record<string, any[]> = {}
    
    if (reportIds.length > 0) {
      const { data: roleAccess, error: roleAccessError } = await adminClient
        .from('report_role_access')
        .select('*')
        .in('report_id', reportIds)
      
      // Ignore errors (table might not exist)
      if (!roleAccessError && roleAccess) {
        roleAccessMap = roleAccess.reduce((acc, ra) => {
          if (!acc[ra.report_id]) acc[ra.report_id] = []
          acc[ra.report_id].push(ra)
          return acc
        }, {} as Record<string, any[]>)
      }
    }

    // Combine data
    const reportsWithDetails = (reports || []).map(report => ({
      ...report,
      creator: { full_name: creatorMap[report.created_by] || 'Unknown' },
      report_role_access: roleAccessMap[report.id] || [],
    }))

    // Filter reports based on access
    const accessibleReports = reportsWithDetails.filter(report => {
      // Creator always has access
      if (report.created_by === user.id) return true
      
      // Public reports are accessible
      if (report.is_public) return true
      
      // Check role-based access
      const hasRoleAccess = report.report_role_access?.some((ra: any) => {
        if (ra.role === profile.role && ra.can_view) return true
        if (ra.custom_role_id === profile.custom_role_id && ra.can_view) return true
        return false
      })
      
      return hasRoleAccess
    })

    return NextResponse.json({ reports: accessibleReports })

  } catch (error) {
    console.error('Custom reports error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Execute a report and get data
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

    const supabase = getAdminClient()

    const { data: profile } = await supabase
      .from('users')
      .select('id, org_id, role, custom_role_id, team_id, region_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const reportPermissions = await resolveEffectivePermissionNames(supabase, user.id, profile)
    if (!canAccessReportsFromPermissionNames(reportPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get org settings to check if admins should be included in reports
    const { data: org } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()
    
    const includeAdminsInReports = org?.settings?.reports?.include_admins_in_reports !== false // Default true

    const body = await request.json()
    const report_id = body.report_id as string | undefined
    const dateRangeOverride = body.dateRange as string | undefined

    // Get the report
    const { data: report, error: reportError } = await supabase
      .from('custom_reports')
      .select('*')
      .eq('id', report_id)
      .eq('org_id', profile.org_id)
      .single()

    if (reportError || !report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const { data: roleAccess } = await supabase
      .from('report_role_access')
      .select('role, custom_role_id, can_view, can_edit')
      .eq('report_id', report.id)

    if (!canAccessReport({ report, userId: user.id, profile, roleAccess: roleAccess || [] })) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    // Calculate date filter
    const getDateFilter = (range: string) => {
      const now = new Date()
      switch (range) {
        case '7d':
          return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
        case 'week': {
          // Start of current week (Sunday)
          const startOfWeek = new Date(now)
          startOfWeek.setDate(now.getDate() - now.getDay())
          startOfWeek.setHours(0, 0, 0, 0)
          return startOfWeek.toISOString()
        }
        case '30d':
          return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
        case '90d':
          return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
        case 'ytd':
          return new Date(now.getFullYear(), 0, 1).toISOString()
        default:
          return new Date(2000, 0, 1).toISOString()
      }
    }

    const effectiveDateRange =
      typeof dateRangeOverride === 'string' &&
      VALID_CUSTOM_REPORT_DATE_RANGES.has(dateRangeOverride)
        ? dateRangeOverride
        : report.config?.dateRange || '30d'

    const dateFilter = getDateFilter(effectiveDateRange)
    const dataSource = report.data_source
    const groupBy = report.config?.groupBy
    const aggregation = report.config?.aggregation || 'count'
    const dateColumn = getReportDateColumn(dataSource)

    // Build and execute query based on data source
    let data: any[] = []
    let tableName = ''
    let additionalFilter: { column: string; op: string; value: any } | null = null

    // Check if this is a canvass activity report (stored as leads with isCanvassActivity flag)
    const isCanvassActivity = report.config?.isCanvassActivity === true

    switch (dataSource) {
      case 'canvass_activity':
        // Canvass activity = leads with a canvass_disposition (doors knocked)
        tableName = 'leads'
        additionalFilter = { column: 'canvass_disposition', op: 'not.is', value: null }
        break
      case 'leads':
        tableName = 'leads'
        // If this was saved as a canvass activity report, filter to only canvassed leads
        if (isCanvassActivity) {
          additionalFilter = { column: 'canvass_disposition', op: 'not.is', value: null }
        }
        break
      case 'opportunities':
        tableName = 'opportunities'
        break
      case 'projects':
        tableName = 'projects'
        break
      case 'appointments':
        tableName = 'scheduled_appointments'
        break
      case 'inspection_outcomes':
        tableName = 'inspection_status_updates'
        break
      default:
        tableName = 'leads'
    }

    // Fetch raw data with appropriate joins based on data source
    let selectFields = '*'
    
    // For appointments, join with leads to get homeowner info
    if (dataSource === 'appointments') {
      selectFields = '*, leads(homeowner_name, phone, email)'
    }
    
    let query = supabase
      .from(tableName)
      .select(selectFields)
      .eq('org_id', profile.org_id)
      .gte(dateColumn, dateFilter)

    const scopedUserIds = await getScopedUserIds(supabase, profile, reportPermissions)
    query = applyReportScope(query, dataSource, scopedUserIds)

    // Apply additional filter for canvass_activity
    if (additionalFilter) {
      query = query.not(additionalFilter.column, 'is', null)
    }

    // Apply disposition filter if specified
    const selectedDispositions = report.config?.selectedDispositions
    if (selectedDispositions && Array.isArray(selectedDispositions) && selectedDispositions.length > 0) {
      query = query.in('canvass_disposition', selectedDispositions)
    }

    const { data: rawData, error: dataError } = await query
    
    if (dataError) {
      console.error('Data fetch error:', dataError)
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
    }
    
    // Flatten joined data for appointments
    let processedData = rawData
    if (dataSource === 'appointments' && rawData) {
      processedData = rawData.map((r: any) => ({
        ...r,
        homeowner_name: r.leads?.homeowner_name || r.homeowner_name,
        phone: r.leads?.phone || r.phone,
        email: r.leads?.email || r.email,
      }))
    }
    
    // Helper function to format records based on data source
    const formatRecord = (r: any, source: string) => {
      let name = ''
      let address = ''
      
      switch (source) {
        case 'leads':
        case 'canvass_activity':
          name = r.homeowner_name || ''
          address = r.address_text || r.address || ''
          break
        case 'opportunities':
          name = r.customer_name || r.homeowner_name || ''
          address = r.address_text || r.address || ''
          break
        case 'appointments':
          name = r.homeowner_name || r.customer_name || ''
          address = r.address_text || ''
          break
        case 'projects':
          name = r.customer_name || r.name || ''
          address = r.address_text || r.address || ''
          break
        default:
          name = r.name || r.homeowner_name || r.customer_name || r.full_name || ''
          address = r.address_text || r.address || ''
      }
      
      // If still no name, use address as name
      if (!name && address) {
        name = address
        address = ''
      }
      
      // Last resort fallback
      if (!name) {
        name = `Record ${r.id?.slice(0, 8) || 'Unknown'}`
      }
      
      return {
        id: r.id,
        name,
        address,
        status: r.status || r.canvass_disposition || r.outcome,
        created_at: r.created_at,
        completed_at: r.completed_at,
        scheduled_at: r.scheduled_at || r.scheduled_for,
        phone: r.phone,
        email: r.email,
      }
    }

    // Helper to format disposition labels
    const formatDispositionLabel = (key: string): string => {
      const labels: Record<string, string> = {
        'not_home': 'Not Home',
        'bad_roof': 'Bad Roof',
        'renter': 'Renter',
        'go_back': 'Go Back',
        'hot_lead': 'Hot Lead',
        'not_interested': 'Not Interested',
        'inspection': 'Inspection Set',
      }
      return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }

    // Fetch user names and roles if grouping by user
    let userNames: Record<string, string> = {}
    let adminUserIds: Set<string> = new Set()
    if (groupBy && (groupBy.includes('user_id') || groupBy === 'owner_user_id')) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
      
      if (users) {
        users.forEach(u => {
          userNames[u.id] = u.full_name || 'Unknown'
          if (u.role === 'admin') {
            adminUserIds.add(u.id)
          }
        })
      }
    }

    // Process data based on groupBy and aggregation
    if (groupBy && processedData) {
      const grouped: Record<string, any[]> = {}
      
      processedData.forEach((row: any) => {
        const key = row[groupBy] || 'Unknown'
        
        // Skip admin users if setting is disabled and we're grouping by user
        if (!includeAdminsInReports && 
            (groupBy.includes('user_id') || groupBy === 'owner_user_id') && 
            adminUserIds.has(key)) {
          return
        }
        
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(row)
      })

      data = Object.entries(grouped).map(([key, rows]) => {
        let value = rows.length // default count
        
        if (aggregation === 'sum' && report.config?.valueColumn) {
          value = rows.reduce((sum, row) => sum + (parseFloat(row[report.config.valueColumn]) || 0), 0)
        } else if (aggregation === 'avg' && report.config?.valueColumn) {
          const sum = rows.reduce((s, row) => s + (parseFloat(row[report.config.valueColumn]) || 0), 0)
          value = rows.length > 0 ? sum / rows.length : 0
        }

        // Format label based on groupBy type
        let label = key
        if (groupBy === 'canvass_disposition') {
          label = formatDispositionLabel(key)
        } else if (groupBy.includes('user_id') || groupBy === 'owner_user_id') {
          label = userNames[key] || 'Unknown'
        }

        return {
          key,
          label,
          value,
          count: rows.length,
          records: rows.map(r => formatRecord(r, dataSource)),
        }
      }).sort((a, b) => b.value - a.value)
    } else {
      // No grouping - return total with all records
      data = [{
        key: 'total',
        label: 'Total',
        value: processedData?.length || 0,
        count: processedData?.length || 0,
        records: (processedData || []).map((r: any) => formatRecord(r, dataSource)),
      }]
    }

    return NextResponse.json({
      report,
      data,
      dataSource,
      dateRange: effectiveDateRange,
      generated_at: new Date().toISOString(),
    })

  } catch (error) {
    console.error('Execute report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Delete a report
export async function DELETE(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const reportPermissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canAccessReportsFromPermissionNames(reportPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get report_id from query params
    const reportId = request.nextUrl.searchParams.get('id')
    
    if (!reportId) {
      return NextResponse.json({ error: 'Report ID is required' }, { status: 400 })
    }

    // Verify the report exists and belongs to user's org
    const { data: report, error: reportError } = await adminClient
      .from('custom_reports')
      .select('id, created_by, org_id, is_public')
      .eq('id', reportId)
      .eq('org_id', profile.org_id)
      .single()

    if (reportError || !report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Check if user can delete (must be creator or admin in the same org)
    const canDelete = report.created_by === user.id || ['admin', 'owner'].includes(String(profile.role || '').toLowerCase())
    
    if (!canDelete) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    // Delete role access first
    await adminClient
      .from('report_role_access')
      .delete()
      .eq('report_id', reportId)

    // Delete the report
    const { error: deleteError } = await adminClient
      .from('custom_reports')
      .delete()
      .eq('id', reportId)

    if (deleteError) {
      console.error('Delete report error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Delete report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
