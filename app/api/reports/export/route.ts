import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'

type DateRange = '7d' | '30d' | '90d' | 'ytd' | 'all'

function getDateFilter(range: DateRange): string {
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
    case 'all':
      return new Date(2000, 0, 1).toISOString()
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to check permissions
    const { data: profile } = await supabase
      .from('users')
      .select('role, org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    // Check if user can export reports
    const canExport = ['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)
    if (!canExport) {
      return NextResponse.json({ error: 'Not authorized to export reports' }, { status: 403 })
    }

    const range = (request.nextUrl.searchParams.get('range') || '30d') as DateRange
    const dateFilter = getDateFilter(range)

    // Fetch all data
    const [usersRes, leadsRes, oppsRes, projectsRes, regionsRes, teamsRes] = await Promise.all([
      supabase.from('users').select('*').eq('active', true).order('full_name'),
      supabase.from('leads').select('*').gte('created_at', dateFilter),
      supabase.from('opportunities').select('*').gte('created_at', dateFilter),
      supabase.from('projects').select('*').gte('created_at', dateFilter),
      supabase.from('regions').select('*').order('name'),
      supabase.from('teams').select('*').order('name'),
    ])

    const users = usersRes.data || []
    const leads = leadsRes.data || []
    const opps = oppsRes.data || []
    const projects = projectsRes.data || []
    const regions = regionsRes.data || []
    const teams = teamsRes.data || []

    // Create workbook
    const wb = XLSX.utils.book_new()

    // Summary Sheet
    const summaryData = [
      ['Report Summary'],
      ['Date Range', range],
      ['Generated', new Date().toISOString()],
      [''],
      ['Metric', 'Value'],
      ['Total Doors Knocked', leads.length],
      ['Total Contacts', leads.filter(l => ['go_back', 'hot_lead', 'not_interested', 'renter'].includes(l.canvass_disposition || '')).length],
      ['Inspections Set', leads.filter(l => l.status === 'inspection').length],
      ['Opportunities Created', opps.length],
      ['Contracts Signed', opps.filter(o => o.status === 'won').length],
      ['Projects Completed', projects.filter(p => p.status === 'complete').length],
    ]
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

    // By User Sheet
    const userMetrics = users.map(u => {
      const userLeads = leads.filter(l => l.owner_user_id === u.id)
      const userOpps = opps.filter(o => o.owner_user_id === u.id)
      return {
        Name: u.full_name || 'Unknown',
        Role: u.role,
        Email: u.email,
        'Doors Knocked': userLeads.length,
        Contacts: userLeads.filter(l => ['go_back', 'hot_lead', 'not_interested', 'renter'].includes(l.canvass_disposition || '')).length,
        'Inspections Set': userLeads.filter(l => l.status === 'inspection').length,
        Opportunities: userOpps.length,
        'Contracts Signed': userOpps.filter(o => o.status === 'won').length,
      }
    })
    const userSheet = XLSX.utils.json_to_sheet(userMetrics)
    XLSX.utils.book_append_sheet(wb, userSheet, 'By User')

    // By Team Sheet
    const teamMetrics = teams.map(t => {
      const teamUserIds = users.filter(u => u.team_id === t.id).map(u => u.id)
      const teamLeads = leads.filter(l => teamUserIds.includes(l.owner_user_id))
      const teamOpps = opps.filter(o => teamUserIds.includes(o.owner_user_id))
      const region = regions.find(r => r.id === t.region_id)
      return {
        Team: t.name,
        Region: region?.name || 'Unassigned',
        Members: teamUserIds.length,
        'Doors Knocked': teamLeads.length,
        Contacts: teamLeads.filter(l => ['go_back', 'hot_lead', 'not_interested', 'renter'].includes(l.canvass_disposition || '')).length,
        'Inspections Set': teamLeads.filter(l => l.status === 'inspection').length,
        Opportunities: teamOpps.length,
        'Contracts Signed': teamOpps.filter(o => o.status === 'won').length,
      }
    })
    const teamSheet = XLSX.utils.json_to_sheet(teamMetrics)
    XLSX.utils.book_append_sheet(wb, teamSheet, 'By Team')

    // By Region Sheet
    const regionMetrics = regions.map(r => {
      const regionTeamIds = teams.filter(t => t.region_id === r.id).map(t => t.id)
      const regionUserIds = users.filter(u => regionTeamIds.includes(u.team_id || '')).map(u => u.id)
      const regionLeads = leads.filter(l => regionUserIds.includes(l.owner_user_id))
      const regionOpps = opps.filter(o => regionUserIds.includes(o.owner_user_id))
      return {
        Region: r.name,
        Teams: regionTeamIds.length,
        Members: regionUserIds.length,
        'Doors Knocked': regionLeads.length,
        Contacts: regionLeads.filter(l => ['go_back', 'hot_lead', 'not_interested', 'renter'].includes(l.canvass_disposition || '')).length,
        'Inspections Set': regionLeads.filter(l => l.status === 'inspection').length,
        Opportunities: regionOpps.length,
        'Contracts Signed': regionOpps.filter(o => o.status === 'won').length,
      }
    })
    const regionSheet = XLSX.utils.json_to_sheet(regionMetrics)
    XLSX.utils.book_append_sheet(wb, regionSheet, 'By Region')

    // Leads Detail Sheet
    const leadsDetail = leads.map(l => ({
      ID: l.id,
      'Homeowner Name': l.homeowner_name,
      Address: l.address_text,
      Phone: l.phone,
      Email: l.email,
      Status: l.status,
      Disposition: l.canvass_disposition,
      Source: l.source,
      'Created At': l.created_at,
      Notes: l.canvass_notes,
    }))
    const leadsSheet = XLSX.utils.json_to_sheet(leadsDetail)
    XLSX.utils.book_append_sheet(wb, leadsSheet, 'Leads')

    // Opportunities Detail Sheet
    const oppsDetail = opps.map(o => ({
      ID: o.id,
      Status: o.status,
      'Project Type': o.project_type,
      Address: o.address_text,
      'Created At': o.created_at,
      Notes: o.notes,
    }))
    const oppsSheet = XLSX.utils.json_to_sheet(oppsDetail)
    XLSX.utils.book_append_sheet(wb, oppsSheet, 'Opportunities')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Return as downloadable file
    const filename = `report_${range}_${new Date().toISOString().split('T')[0]}.xlsx`
    
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
