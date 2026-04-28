import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import * as XLSX from 'xlsx'
import {
  getAttributedInstallationSales,
  getContactDispositionIdSet,
  isCanvassDoorLead,
  isContactDisposition,
  type InstallationSaleContractRow,
} from '@/lib/sales-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

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

function getSupabaseClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll() {
          // No-op for GET that returns file
        },
      },
    }
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient(request)
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role, org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const canExport = ['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)
    if (!canExport) {
      return NextResponse.json({ error: 'Not authorized to export reports' }, { status: 403 })
    }

    const range = (request.nextUrl.searchParams.get('range') || '30d') as DateRange
    const dateFilter = getDateFilter(range)

    const [usersRes, leadsRes, oppsRes, signedContractsRes, appointmentsRes, projectsRes, regionsRes, teamsRes, orgRes] = await Promise.all([
      supabase.from('users').select('*').eq('org_id', profile.org_id).eq('active', true).order('full_name'),
      supabase.from('leads').select('*').eq('org_id', profile.org_id).gte('created_at', dateFilter),
      supabase.from('opportunities').select('*').eq('org_id', profile.org_id).gte('created_at', dateFilter),
      supabase
        .from('order_form_contracts')
        .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
        .eq('org_id', profile.org_id)
        .eq('agreement_type', 'installation')
        .eq('status', 'completed')
        .not('customer_signed_at', 'is', null)
        .gte('customer_signed_at', dateFilter)
        .order('customer_signed_at', { ascending: false }),
      supabase.from('scheduled_appointments').select('id, canvasser_user_id').eq('org_id', profile.org_id).gte('created_at', dateFilter),
      supabase.from('projects').select('*').eq('org_id', profile.org_id).gte('created_at', dateFilter),
      supabase.from('regions').select('*').eq('org_id', profile.org_id).order('name'),
      supabase.from('teams').select('*').eq('org_id', profile.org_id).order('name'),
      supabase.from('orgs').select('settings').eq('id', profile.org_id).single(),
    ])

    const users = usersRes.data || []
    const leads = leadsRes.data || []
    const opps = oppsRes.data || []
    const appointments = appointmentsRes.data || []
    const projects = projectsRes.data || []
    const regions = regionsRes.data || []
    const teams = teamsRes.data || []
    const salesOpps = getAttributedInstallationSales(
      signedContractsRes.data as InstallationSaleContractRow[] | null
    )
    const contactDispositionIdSet = getContactDispositionIdSet(
      orgRes.data?.settings?.canvass_dispositions as any[] | undefined
    )

    const wb = XLSX.utils.book_new()

    const summaryData = [
      ['Report Summary'],
      ['Date Range', range],
      ['Generated', new Date().toISOString()],
      [''],
      ['Metric', 'Value'],
      ['Total Doors Knocked', leads.filter(isCanvassDoorLead).length],
      ['Total Contacts', leads.filter(l => isCanvassDoorLead(l) && isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length],
      ['Inspections Set', appointments.length],
      ['Opportunities Created', opps.length],
      ['Contracts Signed', salesOpps.length],
      ['Projects Completed', projects.filter(p => p.status === 'complete').length],
    ]
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

    const userMetrics = users.map(u => {
      const userLeads = leads.filter(l => getAttributedCanvassLeadUserId(l) === u.id && isCanvassDoorLead(l))
      const userOpps = opps.filter(o => o.owner_user_id === u.id)
      const userAppointments = appointments.filter(a => a.canvasser_user_id === u.id)
      const userSales = salesOpps.filter(o =>
        isSetterLikeRole(u.role) ? o.setter_user_id === u.id : o.owner_user_id === u.id
      )
      return {
        Name: u.full_name || 'Unknown',
        Role: u.role,
        Email: u.email,
        'Doors Knocked': userLeads.length,
        Contacts: userLeads.filter(l => isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
        'Inspections Set': userAppointments.length,
        Opportunities: userOpps.length,
        'Contracts Signed': userSales.length,
      }
    })
    const userSheet = XLSX.utils.json_to_sheet(userMetrics)
    XLSX.utils.book_append_sheet(wb, userSheet, 'By User')

    const teamMetrics = teams.map(t => {
      const teamUserIds = users.filter(u => u.team_id === t.id).map(u => u.id)
      const teamLeads = leads.filter(l => teamUserIds.includes(getAttributedCanvassLeadUserId(l) || '') && isCanvassDoorLead(l))
      const teamOpps = opps.filter(o => teamUserIds.includes(o.owner_user_id))
      const teamAppointments = appointments.filter(a => teamUserIds.includes(a.canvasser_user_id))
      const teamSales = salesOpps.filter(o => teamUserIds.includes(o.owner_user_id) || teamUserIds.includes(o.setter_user_id))
      const region = regions.find(r => r.id === t.region_id)
      return {
        Team: t.name,
        Region: region?.name || 'Unassigned',
        Members: teamUserIds.length,
        'Doors Knocked': teamLeads.length,
        Contacts: teamLeads.filter(l => isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
        'Inspections Set': teamAppointments.length,
        Opportunities: teamOpps.length,
        'Contracts Signed': teamSales.length,
      }
    })
    const teamSheet = XLSX.utils.json_to_sheet(teamMetrics)
    XLSX.utils.book_append_sheet(wb, teamSheet, 'By Team')

    const regionMetrics = regions.map(r => {
      const regionTeamIds = teams.filter(t => t.region_id === r.id).map(t => t.id)
      const regionUserIds = users.filter(u => regionTeamIds.includes(u.team_id || '')).map(u => u.id)
      const regionLeads = leads.filter(l => regionUserIds.includes(getAttributedCanvassLeadUserId(l) || '') && isCanvassDoorLead(l))
      const regionOpps = opps.filter(o => regionUserIds.includes(o.owner_user_id))
      const regionAppointments = appointments.filter(a => regionUserIds.includes(a.canvasser_user_id))
      const regionSales = salesOpps.filter(o => regionUserIds.includes(o.owner_user_id) || regionUserIds.includes(o.setter_user_id))
      return {
        Region: r.name,
        Teams: regionTeamIds.length,
        Members: regionUserIds.length,
        'Doors Knocked': regionLeads.length,
        Contacts: regionLeads.filter(l => isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length,
        'Inspections Set': regionAppointments.length,
        Opportunities: regionOpps.length,
        'Contracts Signed': regionSales.length,
      }
    })
    const regionSheet = XLSX.utils.json_to_sheet(regionMetrics)
    XLSX.utils.book_append_sheet(wb, regionSheet, 'By Region')

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

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

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
