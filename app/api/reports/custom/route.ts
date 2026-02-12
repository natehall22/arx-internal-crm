import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const dashboardOnly = request.nextUrl.searchParams.get('dashboard') === 'true'

    // Get all reports the user can access
    let query = supabase
      .from('custom_reports')
      .select(`
        *,
        report_role_access(*),
        creator:users!custom_reports_created_by_fkey(full_name)
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (dashboardOnly) {
      query = query.eq('is_dashboard_widget', true)
    }

    const { data: reports, error } = await query

    if (error) {
      console.error('Reports fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 })
    }

    // Filter reports based on access
    const accessibleReports = (reports || []).filter(report => {
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
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role, team_id, region_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const { report_id } = await request.json()

    // Get the report
    const { data: report, error: reportError } = await supabase
      .from('custom_reports')
      .select('*')
      .eq('id', report_id)
      .single()

    if (reportError || !report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Calculate date filter
    const getDateFilter = (range: string) => {
      const now = new Date()
      switch (range) {
        case '7d':
          return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
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

    const dateFilter = getDateFilter(report.config?.dateRange || '30d')
    const dataSource = report.data_source
    const groupBy = report.config?.groupBy
    const aggregation = report.config?.aggregation || 'count'

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

    // Fetch raw data
    let query = supabase
      .from(tableName)
      .select('*')
      .eq('org_id', profile.org_id)
      .gte('created_at', dateFilter)

    // Apply additional filter for canvass_activity
    if (additionalFilter) {
      query = query.not(additionalFilter.column, 'is', null)
    }

    const { data: rawData, error: dataError } = await query

    if (dataError) {
      console.error('Data fetch error:', dataError)
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
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

    // Fetch user names if grouping by user
    let userNames: Record<string, string> = {}
    if (groupBy && (groupBy.includes('user_id') || groupBy === 'owner_user_id')) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('org_id', profile.org_id)
      
      if (users) {
        users.forEach(u => {
          userNames[u.id] = u.full_name || 'Unknown'
        })
      }
    }

    // Process data based on groupBy and aggregation
    if (groupBy && rawData) {
      const grouped: Record<string, any[]> = {}
      
      rawData.forEach((row: any) => {
        const key = row[groupBy] || 'Unknown'
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
          label,
          value,
          count: rows.length,
        }
      }).sort((a, b) => b.value - a.value)
    } else {
      // No grouping - return total
      data = [{
        label: 'Total',
        value: rawData?.length || 0,
        count: rawData?.length || 0,
      }]
    }

    return NextResponse.json({ 
      report,
      data,
      generated_at: new Date().toISOString(),
    })

  } catch (error) {
    console.error('Execute report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
