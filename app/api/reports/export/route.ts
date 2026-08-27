import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServerClient } from '@supabase/ssr'
import * as XLSX from 'xlsx'
import {
  getAttributedInstallationSales,
  getContactDispositionIdSet,
  isCanvassDoorLead,
  isContactDisposition,
  SALE_AGREEMENT_TYPES,
  type CanvassMetricsLeadRow,
  type InstallationSaleContractRow,
} from '@/lib/sales-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { countsAsInspectionSet } from '@/lib/inspection-set-metrics'
import { canExportReportsFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

type DateRange = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'

function getPresetStartIso(range: Exclude<DateRange, 'custom'>): string {
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

function localYmdToStartIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y || 2000, (m || 1) - 1, d || 1, 0, 0, 0, 0).toISOString()
}

function localYmdToEndIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y || 2000, (m || 1) - 1, d || 1, 23, 59, 59, 999).toISOString()
}

function resolveExportBounds(
  range: DateRange,
  startParam: string | null,
  endParam: string | null,
): { startIso: string; endIso: string | null; label: string } {
  if (range === 'custom') {
    if (
      startParam &&
      endParam &&
      /^\d{4}-\d{2}-\d{2}$/.test(startParam) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endParam)
    ) {
      let s = localYmdToStartIso(startParam)
      let e = localYmdToEndIso(endParam)
      let labelStart = startParam
      let labelEnd = endParam
      if (new Date(s) > new Date(e)) {
        s = localYmdToStartIso(endParam)
        e = localYmdToEndIso(startParam)
        labelStart = endParam
        labelEnd = startParam
      }
      return {
        startIso: s,
        endIso: e,
        label: `${labelStart}_to_${labelEnd}`,
      }
    }
    const now = new Date()
    return {
      startIso: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endIso: null,
      label: '30d_fallback',
    }
  }
  return {
    startIso: getPresetStartIso(range),
    endIso: null,
    label: range,
  }
}

function withDateColumn(query: any, column: string, startIso: string, endIso: string | null) {
  let q = query.gte(column, startIso)
  if (endIso) q = q.lte(column, endIso)
  return q
}

type ExportUserRow = {
  id: string
  full_name?: string | null
  role?: string
  email?: string
  team_id?: string | null
}

type ExportOppRow = {
  id: string
  owner_user_id?: string | null
  setter_user_id?: string | null
  status?: string | null
  project_type?: string | null
  address_text?: string | null
  created_at?: string | null
  notes?: string | null
}

type ExportProjectRow = { status?: string | null }

type ExportApptRow = {
  canvasser_user_id?: string | null
  appointment_type?: string | null
  status?: string | null
}

type ExportTeamRow = { id: string; name?: string | null; region_id?: string | null }

type ExportRegionRow = { id: string; name?: string | null }

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
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS-bound client: every report query below is org-scoped by the caller's own
    // policies rather than by an explicit .eq('org_id', ...) on each one.
    const supabase = getSupabaseClient(request)

    const reportPermissions = await resolveEffectivePermissionNames(createServiceClient(), profile.id, profile)
    const canExport = canExportReportsFromPermissionNames(reportPermissions)
    if (!canExport) {
      return NextResponse.json({ error: 'Not authorized to export reports' }, { status: 403 })
    }

    const VALID_RANGES: DateRange[] = ['7d', '30d', '90d', 'ytd', 'all', 'custom']
    const rawRange = request.nextUrl.searchParams.get('range') || '30d'
    const range = (VALID_RANGES.includes(rawRange as DateRange) ? rawRange : '30d') as DateRange
    const startParam = request.nextUrl.searchParams.get('start')
    const endParam = request.nextUrl.searchParams.get('end')
    const { startIso, endIso, label: rangeLabel } = resolveExportBounds(range, startParam, endParam)
    const rangeSummary =
      range === 'custom' && startParam && endParam
        ? `${startParam} – ${endParam}`
        : range

    const [usersRes, leadsRes, oppsRes, signedContractsRes, appointmentsRes, projectsRes, regionsRes, teamsRes, orgRes] = await Promise.all([
      supabase.from('users').select('*').eq('org_id', profile.org_id).eq('active', true).order('full_name'),
      withDateColumn(
        supabase.from('leads').select('*').eq('org_id', profile.org_id),
        'created_at',
        startIso,
        endIso,
      ),
      withDateColumn(
        supabase.from('opportunities').select('*').eq('org_id', profile.org_id),
        'created_at',
        startIso,
        endIso,
      ),
      withDateColumn(
        supabase
          .from('order_form_contracts')
          .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
          .eq('org_id', profile.org_id)
          .in('agreement_type', SALE_AGREEMENT_TYPES)
          .eq('status', 'completed')
          .not('customer_signed_at', 'is', null)
          .order('customer_signed_at', { ascending: false }),
        'customer_signed_at',
        startIso,
        endIso,
      ),
      withDateColumn(
        supabase
          .from('scheduled_appointments')
          .select('id, canvasser_user_id, appointment_type, status')
          .eq('org_id', profile.org_id),
        'created_at',
        startIso,
        endIso,
      ),
      withDateColumn(
        supabase.from('projects').select('*').eq('org_id', profile.org_id),
        'created_at',
        startIso,
        endIso,
      ),
      supabase.from('regions').select('*').eq('org_id', profile.org_id).order('name'),
      supabase.from('teams').select('*').eq('org_id', profile.org_id).order('name'),
      supabase.from('orgs').select('settings').eq('id', profile.org_id).single(),
    ])

    const users = (usersRes.data || []) as ExportUserRow[]
    const leads = (leadsRes.data || []) as CanvassMetricsLeadRow[]
    const opps = (oppsRes.data || []) as ExportOppRow[]
    const appointments = ((appointmentsRes.data || []) as ExportApptRow[]).filter(countsAsInspectionSet)
    const projects = (projectsRes.data || []) as ExportProjectRow[]
    const regions = (regionsRes.data || []) as ExportRegionRow[]
    const teams = (teamsRes.data || []) as ExportTeamRow[]
    const salesOpps = getAttributedInstallationSales(
      signedContractsRes.data as InstallationSaleContractRow[] | null
    )
    const contactDispositionIdSet = getContactDispositionIdSet(
      orgRes.data?.settings?.canvass_dispositions as any[] | undefined
    )

    const wb = XLSX.utils.book_new()

    const summaryData = [
      ['Report Summary'],
      ['Date Range', rangeSummary],
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
      const teamOpps = opps.filter((o) => teamUserIds.includes(o.owner_user_id || ''))
      const teamAppointments = appointments.filter((a) => teamUserIds.includes(a.canvasser_user_id || ''))
      const teamSales = salesOpps.filter(
        (o) => teamUserIds.includes(o.owner_user_id || '') || teamUserIds.includes(o.setter_user_id || '')
      )
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
      const regionOpps = opps.filter((o) => regionUserIds.includes(o.owner_user_id || ''))
      const regionAppointments = appointments.filter((a) => regionUserIds.includes(a.canvasser_user_id || ''))
      const regionSales = salesOpps.filter(
        (o) =>
          regionUserIds.includes(o.owner_user_id || '') || regionUserIds.includes(o.setter_user_id || '')
      )
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

    const filename = `report_${rangeLabel.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`
    
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
