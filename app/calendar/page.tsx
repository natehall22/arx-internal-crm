'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Nav from '@/components/Nav'
import {
  formatEasternHourLabel,
  formatNyDayOfMonth,
  formatNyLongDate,
  formatNyMonthYearTitle,
  formatNyWeekdayShort,
  hourInBusinessTz,
  nyAgendaRangeUtc,
  nyDayRangeUtc,
  nyMonthCalendarDays,
  nyMonthGridRangeUtc,
  nyMonthKey,
  nyWeekDayDates,
  nyWeekRangeUtc,
  ymdInBusinessTz,
} from '@/lib/calendar-business-tz'
import { fetchSalesCalendarSlice } from '@/lib/calendar-sales'
import { filterAppointmentsByCalendarScope } from '@/lib/calendar-scope-filters'
import {
  canAccessJobBoard,
  canReassignAppointmentsFromProfile,
  deriveCalendarAccess,
} from '@/lib/permissions'
import { createClientBrowser } from '@/lib/supabase/client'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import TeamLaneView from '@/components/calendar/TeamLaneView'

type ViewMode = 'day' | 'week' | 'month' | 'agenda' | 'team'

interface Appointment {
  id: string
  lead_id?: string | null
  opportunity_id?: string | null
  scheduled_for: string
  duration_minutes: number
  status: string
  address_text: string | null
  notes: string | null
  appointment_type?: string | null
  closer_user_id?: string | null
  canvasser_user_id?: string | null
  /** close_only = synthetic row from close_appointments when no linked scheduled row */
  _calendarSource?: 'scheduled' | 'close_only'
  close_appointment_id?: string | null
  lead?: { homeowner_name: string | null; address_text: string | null } | null
  opportunity?: { id: string; name: string | null } | null
  closer?: { full_name: string | null } | null
  canvasser?: { full_name: string | null } | null
}

interface ScheduledJob {
  id: string
  job_number: string
  scheduled_date: string
  scheduled_time_start: string | null
  address_text: string
  job_type: string
  status: string
  customer_name: string | null
  crew_name: string | null
  crew_color: string | null
}

interface User {
  id: string
  full_name: string | null
  role: string
  team_id?: string | null
  region_id?: string | null
}

interface Team {
  id: string
  name: string
  region_id?: string | null
}

interface Region {
  id: string
  name: string
}

const TEAM_MEMBER_ROLE_ALLOWLIST = ['sales_rep', 'rep', 'sales_manager', 'setter_manager', 'admin']

function appointmentKindLabel(appointmentType: string | null | undefined): string {
  const t = appointmentType || 'inspection'
  if (t === 'close') return 'Close'
  if (t === 'insurance_follow_up') return 'Follow-up'
  if (t === 'insurance_call') return 'Inside Sales Call'
  // Physical, on-site meeting with the insurance adjuster — a field visit the
  // assigned rep attends, not a phone call.
  if (t === 'adjuster_meeting') return 'Adjuster Meeting'
  return 'Inspection'
}

function appointmentNeedsCloser(apt: Appointment): boolean {
  if (apt._calendarSource === 'close_only') return false
  // Inside-sales calls are phone calls worked from the queue, not field visits needing a rep.
  if (apt.appointment_type === 'insurance_call') return false
  return !apt.closer_user_id && apt.status !== 'cancelled'
}

export default function CalendarPage() {
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('all')
  const [selectedRegionId, setSelectedRegionId] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null)
  const [calendarLoadError, setCalendarLoadError] = useState<string | null>(null)
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null)
  const [reassignCloserId, setReassignCloserId] = useState<string>('')
  const [reassigning, setReassigning] = useState(false)
  const [reassignError, setReassignError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const dayScrollRef = useRef<HTMLDivElement>(null)
  const supabase = createClientBrowser()

  const calendarAccess = deriveCalendarAccess(currentUser)
  const isCalendarAdmin = calendarAccess === 'admin'
  const isCalendarRegional = calendarAccess === 'regional'
  const isCalendarTeamManager = calendarAccess === 'team'
  const canAccessTeamCalendar = isCalendarAdmin || isCalendarRegional || isCalendarTeamManager
  const canReassignAppointments = canReassignAppointmentsFromProfile(currentUser)
  const viewerRegionId = currentUser?.region_id || ''
  const viewerTeamId = currentUser?.team_id || ''

  /** Region/team/member drill-down (same rules as Team view) applied to month/week/day/agenda. */
  const filteredAppointments = useMemo(() => {
    const active = appointments.filter((apt) => apt.status !== 'cancelled')
    if (!canAccessTeamCalendar) return active
    const userById = new Map(users.map((u) => [u.id, { team_id: u.team_id, region_id: u.region_id }]))
    const effectiveRegionId = isCalendarAdmin ? selectedRegionId : isCalendarRegional ? viewerRegionId : ''
    return filterAppointmentsByCalendarScope(active, {
      calendarAccess,
      viewerRegionId,
      viewerTeamId: viewerTeamId || '',
      regionId: effectiveRegionId,
      teamId: selectedTeamId,
      memberId: selectedMemberId,
      userById,
    })
  }, [
    appointments,
    canAccessTeamCalendar,
    calendarAccess,
    users,
    isCalendarAdmin,
    isCalendarRegional,
    viewerRegionId,
    viewerTeamId,
    selectedRegionId,
    selectedTeamId,
    selectedMemberId,
  ])

  const appointmentsForSelectedDay = useMemo(() => {
    const dayKey = ymdInBusinessTz(currentDate)
    return filteredAppointments.filter(
      (apt) => ymdInBusinessTz(new Date(apt.scheduled_for)) === dayKey
    )
  }, [filteredAppointments, currentDate])

  const firstEasternHourThisDay = useMemo(() => {
    if (appointmentsForSelectedDay.length === 0) return null
    let min = 24
    for (const apt of appointmentsForSelectedDay) {
      const h = hourInBusinessTz(apt.scheduled_for)
      if (h < min) min = h
    }
    return min
  }, [appointmentsForSelectedDay])

  useEffect(() => {
    if (viewMode !== 'day' || loading) return
    const el = dayScrollRef.current
    if (!el) return
    const targetHour =
      firstEasternHourThisDay !== null ? Math.max(0, firstEasternHourThisDay - 1) : 6
    requestAnimationFrame(() => {
      const row = el.querySelector(`[data-hour-slot="${targetHour}"]`)
      row?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [viewMode, loading, currentDate, firstEasternHourThisDay])

  const summaryAppointmentCount =
    viewMode === 'day' ? appointmentsForSelectedDay.length : filteredAppointments.length

  const loadData = async () => {
    setLoading(true)
    setProfileLoadError(null)

    // The browser Supabase client cannot resolve the auth session in this app's
    // cookie-based setup. Use the server-side API route instead (same pattern as
    // all other working API routes — reads the auth cookie server-side).
    let profile: any = null
    try {
      const res = await fetch('/api/calendar/profile')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setProfileLoadError(body.error || `Profile load failed (${res.status})`)
        setLoading(false)
        return
      }
      profile = await res.json()
    } catch (err: any) {
      setProfileLoadError(`Could not reach profile API: ${err?.message || String(err)}`)
      setLoading(false)
      return
    }

    if (!profile?.org_id) {
      setProfileLoadError('Profile loaded but org_id is missing — contact an admin.')
      setLoading(false)
      return
    }

    // auth_user_id is returned by the API for use in appointment filtering
    const userId: string = profile.auth_user_id || profile.id

    // Build an authenticated Supabase client using the access_token from the
    // profile API. The default browser singleton can't read the auth cookie so
    // all data queries (users, regions, teams, appointments) would return empty.
    const authSupabase = profile.access_token
      ? createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${profile.access_token}` } },
          }
        )
      : supabase

    setCurrentUser(profile)
    setProfileLoadError(null)
    const desktopView: 'sales' | 'ops' = profile?.dashboard_view === 'ops' ? 'ops' : 'sales'
    const role = profile?.role || ''
    const calendarAccess = deriveCalendarAccess(profile)
    const canAccessTeamCalendar = calendarAccess !== 'none'
    const isCalendarAdmin = calendarAccess === 'admin'
    const isCalendarRegional = calendarAccess === 'regional'
    const isCalendarTeamManager = calendarAccess === 'team'

    // Get users for filter
    const { data: usersData } = await authSupabase
      .from('users')
      .select('id, full_name, role, team_id, region_id')
      .eq('org_id', profile?.org_id)
      .order('full_name')

    setUsers(usersData || [])

    if (canAccessTeamCalendar) {
      if (isCalendarAdmin || isCalendarRegional) {
        const regionsQuery = authSupabase
          .from('regions')
          .select('id, name')
          .eq('org_id', profile?.org_id)
          .order('name')
        const { data: regionsData } = await regionsQuery
        setRegions(regionsData || [])
      } else {
        setRegions([])
      }

      let teamsQuery = authSupabase
        .from('teams')
        .select('id, name, region_id')
        .eq('org_id', profile?.org_id)
        .order('name')

      if (isCalendarRegional && profile?.region_id) {
        teamsQuery = teamsQuery.eq('region_id', profile.region_id)
      }

      if (isCalendarTeamManager && profile?.team_id) {
        teamsQuery = teamsQuery.eq('id', profile.team_id)
      }

      const { data: teamsData } = await teamsQuery
      setTeams(teamsData || [])

      if (isCalendarRegional) {
        setSelectedRegionId(profile?.region_id || '')
      } else if (isCalendarTeamManager) {
        setSelectedRegionId('')
        setSelectedTeamId(profile?.team_id || '')
      }
    } else {
      setRegions([])
      setTeams([])
      setSelectedRegionId('')
      setSelectedTeamId('')
      setSelectedMemberId('')
    }

    // Date range for queries: America/New_York business calendar (matches formatTime + DB timestamptz)
    let startDate: Date
    let endDate: Date
    if (viewMode === 'day') {
      const r = nyDayRangeUtc(currentDate)
      startDate = r.start
      endDate = r.end
    } else if (viewMode === 'week') {
      const r = nyWeekRangeUtc(currentDate)
      startDate = r.start
      endDate = r.end
    } else if (viewMode === 'month') {
      // Full 6-week grid includes adjacent month days; query must match or edge weeks stay empty
      const r = nyMonthGridRangeUtc(currentDate)
      startDate = r.start
      endDate = r.end
    } else {
      const r = nyAgendaRangeUtc(currentDate, 30)
      startDate = r.start
      endDate = r.end
    }

    setCalendarLoadError(null)

    const { rows: calendarRows, error: calendarErr } = await fetchSalesCalendarSlice(authSupabase, {
      orgId: profile.org_id,
      authUserId: userId,
      profile,
      start: startDate,
      end: endDate,
      canAccessTeamCalendar,
      selectedMemberId,
      selectedUserId,
    })

    if (calendarErr) {
      setCalendarLoadError(calendarErr)
    }

    const appointmentsData = (calendarRows || []) as Appointment[]

    // Get lead IDs to fetch lead info
    const leadIds = (appointmentsData || [])
      .map(apt => apt.lead_id)
      .filter(Boolean)
    
    let leadsMap: Record<string, any> = {}
    if (leadIds.length > 0) {
      const { data: leadsData } = await authSupabase
        .from('leads')
        .select('id, homeowner_name, address_text')
        .in('id', leadIds)
      
      leadsMap = (leadsData || []).reduce((acc, lead) => {
        acc[lead.id] = lead
        return acc
      }, {} as Record<string, any>)
    }

    const opportunityIds = Array.from(
      new Set(
        (appointmentsData || [])
          .map((a) => a.opportunity_id)
          .filter(Boolean) as string[]
      )
    )
    let opportunityNameById: Record<string, string> = {}
    if (opportunityIds.length > 0) {
      const { data: opps } = await authSupabase.from('opportunities').select('id, name').in('id', opportunityIds)
      for (const o of opps || []) {
        if (o?.id) opportunityNameById[o.id] = o.name || ''
      }
    }
    
    // Enrich appointments with closer/canvasser names and lead / opportunity labels
    const enrichedAppointments = (appointmentsData || []).map(apt => {
      const closer = usersData?.find(u => u.id === apt.closer_user_id)
      const canvasser = usersData?.find(u => u.id === apt.canvasser_user_id)
      let lead = apt.lead_id ? leadsMap[apt.lead_id] : null
      if (!lead && apt._calendarSource === 'close_only') {
        const label = apt.notes?.replace(/^Close — /, '') || 'Scheduled close'
        lead = { homeowner_name: label, address_text: null }
      }
      const oid = apt.opportunity_id
      const opportunity = oid
        ? { id: oid, name: opportunityNameById[oid] ?? null }
        : null
      return {
        ...apt,
        closer: closer ? { full_name: closer.full_name } : null,
        canvasser: canvasser ? { full_name: canvasser.full_name } : null,
        lead: lead ? { homeowner_name: lead.homeowner_name, address_text: lead.address_text } : null,
        opportunity: opportunity ?? undefined,
      }
    })
    
    setAppointments(enrichedAppointments)

    // Ops calendar: production jobs. Sales view: inspections + closes only (scheduling plumbing unchanged elsewhere).
    const canSeeJobs = desktopView === 'ops'
    
    if (canSeeJobs) {
      const { data: jobsData } = await authSupabase
        .from('production_jobs')
        .select(`
          id, job_number, scheduled_date, scheduled_time_start, address_text, job_type, status,
          customer:customers(name),
          assigned_crew:crews(name, color)
        `)
        .eq('org_id', profile?.org_id)
        .not('scheduled_date', 'is', null)
        .in('status', ['scheduled', 'in_progress'])
        .gte('scheduled_date', startDate.toISOString().split('T')[0])
        .lte('scheduled_date', endDate.toISOString().split('T')[0])
        .order('scheduled_date')

      const transformedJobs: ScheduledJob[] = (jobsData || []).map((job: any) => ({
        id: job.id,
        job_number: job.job_number,
        scheduled_date: job.scheduled_date,
        scheduled_time_start: job.scheduled_time_start,
        address_text: job.address_text,
        job_type: job.job_type,
        status: job.status,
        customer_name: Array.isArray(job.customer) ? job.customer[0]?.name : job.customer?.name,
        crew_name: Array.isArray(job.assigned_crew) ? job.assigned_crew[0]?.name : job.assigned_crew?.name,
        crew_color: Array.isArray(job.assigned_crew) ? job.assigned_crew[0]?.color : job.assigned_crew?.color,
      }))

      setScheduledJobs(transformedJobs)
    } else {
      setScheduledJobs([])
      setSelectedJob(null)
    }
    setLoading(false)
  }

  // Wrap the real loadData in a catch so any unexpected throw surfaces in the UI
  const loadDataSafe = async () => {
    try {
      await loadData()
    } catch (err: any) {
      console.error('Calendar loadData unexpected error:', err)
      setProfileLoadError(`Unexpected error: ${err?.message || String(err)}`)
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDataSafe()
  }, [currentDate, selectedUserId, selectedMemberId, viewMode])

  const navigatePrev = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'day') newDate.setDate(newDate.getDate() - 1)
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() - 7)
    else if (viewMode === 'month') newDate.setMonth(newDate.getMonth() - 1)
    setCurrentDate(newDate)
  }

  const navigateNext = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'day') newDate.setDate(newDate.getDate() + 1)
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() + 7)
    else if (viewMode === 'month') newDate.setMonth(newDate.getMonth() + 1)
    setCurrentDate(newDate)
  }

  const goToToday = () => setCurrentDate(new Date())

  const handleReassign = async (appointmentId: string, newCloserId: string) => {
    setReassigning(true)
    setReassignError(null)
    try {
      // Refresh session token — stale Bearer from initial page load causes silent 401s.
      let token = (currentUser as { access_token?: string })?.access_token
      try {
        const profileRes = await fetch('/api/calendar/profile')
        if (profileRes.ok) {
          const freshProfile = await profileRes.json()
          if (freshProfile?.access_token) {
            token = freshProfile.access_token
            setCurrentUser(freshProfile)
          }
        }
      } catch {
        // Proceed with existing token / cookie fallback on the server.
      }

      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ new_closer_id: newCloserId }),
      })
      let data: { error?: string } = {}
      try {
        data = await res.json()
      } catch {
        if (!res.ok) {
          setReassignError('Could not read server response')
          return
        }
      }
      if (!res.ok) {
        setReassignError(data.error || 'Failed to reassign')
        return
      }
      setSelectedAppointment(null)
      setReassignCloserId('')
      loadDataSafe()
    } catch {
      setReassignError('Network error — try again')
    } finally {
      setReassigning(false)
    }
  }

  const handleCancel = async (appointmentId: string) => {
    setCancelling(true)
    setCancelError(null)
    try {
      // Refresh session token — stale Bearer from initial page load causes silent 401s.
      let token = (currentUser as { access_token?: string })?.access_token
      try {
        const profileRes = await fetch('/api/calendar/profile')
        if (profileRes.ok) {
          const freshProfile = await profileRes.json()
          if (freshProfile?.access_token) {
            token = freshProfile.access_token
            setCurrentUser(freshProfile)
          }
        }
      } catch {
        // Proceed with existing token / cookie fallback on the server.
      }

      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      let data: { error?: string } = {}
      try {
        data = await res.json()
      } catch {
        if (!res.ok) {
          setCancelError('Could not read server response')
          return
        }
      }
      if (!res.ok) {
        setCancelError(data.error || 'Failed to cancel appointment')
        return
      }
      setSelectedAppointment(null)
      loadDataSafe()
    } catch {
      setCancelError('Network error — try again')
    } finally {
      setCancelling(false)
    }
  }

  // Month grid: Sun–Sat weeks in America/New_York (matches API range + appointment placement)
  const calendarDays = useMemo(() => nyMonthCalendarDays(currentDate), [currentDate])

  const getAppointmentsForDay = (date: Date) => {
    const key = ymdInBusinessTz(date)
    return filteredAppointments.filter((apt) => ymdInBusinessTz(new Date(apt.scheduled_for)) === key)
  }

  const getJobsForDay = (date: Date) => {
    const key = ymdInBusinessTz(date)
    return scheduledJobs.filter((job) => {
      const raw = job.scheduled_date?.split('T')[0] || ''
      return raw === key
    })
  }

  const weekDays = useMemo(() => nyWeekDayDates(currentDate), [currentDate])

  // Eastern hour rows (0–23) so events align with formatTime / stored timestamptz
  const timeSlots = Array.from({ length: 24 }, (_, i) => i)

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
  }

  /** Color-codes by appointment TYPE when scheduled; falls back to status color for terminal states. */
  const getTypeColor = (type: string | null | undefined, status: string) => {
    if (status === 'cancelled') return 'bg-red-500'
    if (status === 'completed') return 'bg-green-600'
    if (status === 'no_show') return 'bg-amber-500'
    const t = type || 'inspection'
    if (t === 'close') return 'bg-emerald-500'
    if (t === 'insurance_follow_up') return 'bg-orange-400'
    if (t === 'insurance_call') return 'bg-purple-500'
    if (t === 'adjuster_meeting') return 'bg-sky-600'
    return 'bg-indigo-500'
  }

  const isToday = (date: Date) => ymdInBusinessTz(date) === ymdInBusinessTz(new Date())
  const isCurrentMonth = (date: Date) => nyMonthKey(date) === nyMonthKey(currentDate)

  const scopedTeams = useMemo(() => {
    if (isCalendarTeamManager && viewerTeamId) {
      return teams.filter((team) => team.id === viewerTeamId)
    }
    if (isCalendarRegional && viewerRegionId) {
      return teams.filter((team) => team.region_id === viewerRegionId)
    }
    if (isCalendarAdmin && selectedRegionId) {
      return teams.filter((team) => team.region_id === selectedRegionId)
    }
    return teams
  }, [isCalendarAdmin, isCalendarRegional, isCalendarTeamManager, selectedRegionId, teams, viewerRegionId, viewerTeamId])

  const scopedMembers = useMemo(() => {
    let pool = users.filter((user) => TEAM_MEMBER_ROLE_ALLOWLIST.includes(user.role))

    if (isCalendarTeamManager && viewerTeamId) {
      pool = pool.filter((user) => user.team_id === viewerTeamId)
    } else if (isCalendarRegional && viewerRegionId) {
      pool = pool.filter((user) => user.region_id === viewerRegionId)
      if (selectedTeamId) {
        pool = pool.filter((user) => user.team_id === selectedTeamId)
      }
    } else if (isCalendarAdmin) {
      if (selectedRegionId) {
        pool = pool.filter((user) => user.region_id === selectedRegionId)
      }
      if (selectedTeamId) {
        pool = pool.filter((user) => user.team_id === selectedTeamId)
      }
    }

    return pool
  }, [
    isCalendarAdmin,
    isCalendarRegional,
    isCalendarTeamManager,
    selectedRegionId,
    selectedTeamId,
    users,
    viewerRegionId,
    viewerTeamId,
  ])

  const headerTitle = useMemo(() => {
    if (viewMode === 'day') {
      return formatNyLongDate(currentDate)
    }
    if (viewMode === 'team') {
      return currentDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    } else if (viewMode === 'week') {
      const start = weekDays[0]
      const end = weekDays[6]
      if (start.getMonth() === end.getMonth()) {
        return `${start.toLocaleDateString([], { month: 'long' })} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`
      }
      return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    return formatNyMonthYearTitle(currentDate)
  }, [currentDate, viewMode, weekDays])

  useEffect(() => {
    setReassignCloserId('')
    setReassignError(null)
    setCancelError(null)
  }, [selectedAppointment?.id])

  useEffect(() => {
    if (isCalendarTeamManager) {
      setSelectedRegionId('')
      setSelectedTeamId(viewerTeamId || '')
    } else if (isCalendarRegional) {
      setSelectedRegionId(viewerRegionId || '')
    }
  }, [isCalendarRegional, isCalendarTeamManager, viewerRegionId, viewerTeamId])

  useEffect(() => {
    if (selectedTeamId && !scopedTeams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId('')
    }
  }, [scopedTeams, selectedTeamId])

  useEffect(() => {
    if (selectedMemberId && !scopedMembers.some((member) => member.id === selectedMemberId)) {
      setSelectedMemberId('')
    }
  }, [scopedMembers, selectedMemberId])

  useEffect(() => {
    if (viewMode === 'team' && !canAccessTeamCalendar) {
      setViewMode('month')
    }
  }, [canAccessTeamCalendar, viewMode])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Nav />
      
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={navigatePrev}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 min-w-[200px] text-center">
              {headerTitle}
            </h1>
            <button
              onClick={navigateNext}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={goToToday}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50"
            >
              Today
            </button>
            
            {/* View mode buttons */}
            <div className="flex bg-white border rounded-lg overflow-hidden">
              {(['day', 'week', 'month', 'agenda'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-2 text-sm font-medium capitalize ${
                    viewMode === mode
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {mode}
                </button>
              ))}
              {canAccessTeamCalendar && (
                <button
                  onClick={() => setViewMode('team')}
                  className={`px-3 py-2 text-sm font-medium capitalize ${
                    viewMode === 'team'
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Team
                </button>
              )}
            </div>
          </div>
        </div>

        {/* User filter */}
        <div className="mb-4">
          {canAccessTeamCalendar ? (
            <div className="flex flex-wrap gap-2">
              {isCalendarAdmin && (
                <select
                  value={selectedRegionId}
                  onChange={(e) => {
                    setSelectedRegionId(e.target.value)
                    setSelectedTeamId('')
                    setSelectedMemberId('')
                  }}
                  className="px-4 py-2 border rounded-lg bg-white text-sm"
                >
                  <option value="">All Regions</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
              )}

              {(isCalendarAdmin || isCalendarRegional) && (
                <select
                  value={selectedTeamId}
                  onChange={(e) => {
                    setSelectedTeamId(e.target.value)
                    setSelectedMemberId('')
                  }}
                  className="px-4 py-2 border rounded-lg bg-white text-sm"
                >
                  <option value="">All Teams</option>
                  {scopedTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="px-4 py-2 border rounded-lg bg-white text-sm"
              >
                <option value="">All Members</option>
                {scopedMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name || 'Unknown'} ({member.role})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="px-4 py-2 border rounded-lg bg-white text-sm text-gray-600 inline-block">
              My Schedule
            </span>
          )}
        </div>

        {profileLoadError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {profileLoadError}
          </div>
        )}

        {calendarLoadError && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Calendar could not load events: {calendarLoadError}
          </div>
        )}

        {!loading && currentUser && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{summaryAppointmentCount}</span>{' '}
              appointment{summaryAppointmentCount === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500" /> Inspection
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> Close
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" /> Follow-up
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-600" /> Completed
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> Cancelled
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> No-show
            </span>
          </div>
        )}
        {!loading && currentUser && (
          <p className="mb-2 text-sm text-gray-500">
            {viewMode === 'day'
              ? 'Eastern time · scrolls to first event or 6 AM.'
              : viewMode === 'month'
                ? 'Eastern time · 6-week grid includes adjacent month days.'
                : 'Eastern time.'}
          </p>
        )}

        {/* Calendar content */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-gray-500">Loading calendar...</div>
            </div>
          ) : viewMode === 'team' && canAccessTeamCalendar ? (
            <TeamLaneView
              calendarAccess={calendarAccess}
              viewerProfile={currentUser}
              viewerRegionId={viewerRegionId}
              viewerTeamId={viewerTeamId}
              regionId={isCalendarAdmin ? selectedRegionId : isCalendarRegional ? viewerRegionId : ''}
              teamId={selectedTeamId}
              memberId={selectedMemberId}
              date={currentDate}
              orgId={currentUser?.org_id || ''}
              canReassign={canReassignAppointments}
            />
          ) : viewMode === 'month' ? (
            /* Month View */
            <div className="h-full flex flex-col">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b bg-gray-50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="px-2 py-3 text-center text-sm font-medium text-gray-500">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar grid */}
              <div className="flex-1 grid grid-cols-7 grid-rows-6">
                {calendarDays.map((day, idx) => {
                  const dayAppointments = getAppointmentsForDay(day)
                  const dayJobs = getJobsForDay(day)
                  const totalItems = dayAppointments.length + dayJobs.length
                  return (
                    <div
                      key={idx}
                      className={`min-h-[100px] border-b border-r p-1 ${
                        !isCurrentMonth(day) ? 'bg-gray-50' : ''
                      } ${isToday(day) ? 'bg-indigo-50' : ''}`}
                    >
                      <div className={`text-sm font-medium mb-1 ${
                        isToday(day) ? 'text-indigo-600' : isCurrentMonth(day) ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {formatNyDayOfMonth(day)}
                      </div>
                      <div className="space-y-1">
                        {/* Scheduled Jobs */}
                        {dayJobs.slice(0, 2).map(job => (
                          <button
                            key={`job-${job.id}`}
                            onClick={() => setSelectedJob(job)}
                            className="w-full text-left px-1.5 py-0.5 rounded text-xs truncate"
                            style={{
                              backgroundColor: `${job.crew_color || '#8B5CF6'}20`,
                              color: job.crew_color || '#8B5CF6',
                              borderLeft: `2px solid ${job.crew_color || '#8B5CF6'}`,
                            }}
                          >
                            🔨 {job.customer_name || job.address_text?.split(',')[0]}
                          </button>
                        ))}
                        {/* Appointments */}
                        {dayAppointments.slice(0, Math.max(0, 3 - dayJobs.length)).map(apt => (
                          <button
                            key={apt.id}
                            onClick={() => setSelectedAppointment(apt)}
                            title={`${appointmentKindLabel(apt.appointment_type)}${appointmentNeedsCloser(apt) ? ' — needs rep' : ''}`}
                            className={`w-full text-left px-1.5 py-0.5 rounded text-xs text-white truncate ${getTypeColor(apt.appointment_type, apt.status)} ${
                              appointmentNeedsCloser(apt) ? 'ring-2 ring-amber-300 ring-inset' : ''
                            } ${apt.status === 'cancelled' ? 'opacity-60' : ''}`}
                          >
                            <span className={`block truncate ${apt.status === 'cancelled' ? 'line-through' : ''}`}>
                              {formatTime(apt.scheduled_for)} {apt.lead?.homeowner_name || 'Appointment'}
                            </span>
                            {appointmentNeedsCloser(apt) && (
                              <span className="block text-[10px] opacity-95 truncate">Needs rep</span>
                            )}
                          </button>
                        ))}
                        {totalItems > 3 && (
                          <div className="text-xs text-gray-500 px-1">
                            +{totalItems - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : viewMode === 'week' ? (
            /* Week View */
            <div className="h-full flex flex-col overflow-auto">
              {/* Day headers */}
              <div className="grid grid-cols-8 border-b bg-gray-50 sticky top-0 z-10">
                <div className="w-16" />
                {weekDays.map((day, idx) => (
                  <div
                    key={idx}
                    className={`px-2 py-3 text-center border-l ${isToday(day) ? 'bg-indigo-50' : ''}`}
                  >
                    <div className="text-xs text-gray-500">{formatNyWeekdayShort(day)}</div>
                    <div className={`text-lg font-semibold ${isToday(day) ? 'text-indigo-600' : 'text-gray-900'}`}>
                      {formatNyDayOfMonth(day)}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Time grid */}
              <div className="flex-1">
                {timeSlots.map(hour => (
                  <div key={hour} className="grid grid-cols-8 border-b min-h-[60px]">
                    <div className="w-16 px-2 py-1 text-xs text-gray-500 text-right">
                      {formatEasternHourLabel(hour)}
                    </div>
                    {weekDays.map((day, idx) => {
                      const dayAppointments = getAppointmentsForDay(day).filter((apt) => {
                        return hourInBusinessTz(apt.scheduled_for) === hour
                      })
                      return (
                        <div key={idx} className="border-l p-1 relative">
                          {dayAppointments.map(apt => (
                            <button
                              key={apt.id}
                              onClick={() => setSelectedAppointment(apt)}
                              className={`w-full text-left px-2 py-1 rounded text-xs text-white mb-1 ${getTypeColor(apt.appointment_type, apt.status)} ${
                                appointmentNeedsCloser(apt) ? 'ring-2 ring-amber-300' : ''
                              } ${apt.status === 'cancelled' ? 'opacity-60' : ''}`}
                            >
                              <div className={`font-medium truncate ${apt.status === 'cancelled' ? 'line-through' : ''}`}>{apt.lead?.homeowner_name || 'Appointment'}</div>
                              <div className="opacity-80">{formatTime(apt.scheduled_for)}</div>
                              <div className="opacity-90 text-[10px] leading-tight mt-0.5">
                                {apt.status === 'cancelled' ? 'Cancelled' : appointmentKindLabel(apt.appointment_type)}
                                {apt.status !== 'cancelled' && (appointmentNeedsCloser(apt) ? ' · Needs rep' : apt.closer ? ` · ${apt.closer.full_name}` : '')}
                              </div>
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === 'day' ? (
            /* Day View */
            <div ref={dayScrollRef} className="h-full max-h-[min(80vh,900px)] overflow-auto">
              {!loading && appointmentsForSelectedDay.length === 0 && (
                <div className="sticky top-0 z-10 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  No appointments on this date (Eastern). Try another day, Week, Month, or Agenda — or confirm
                  filters (e.g. a single rep) are not hiding events.
                </div>
              )}
              {timeSlots.map(hour => {
                const dayKey = ymdInBusinessTz(currentDate)
                const hourAppointments = filteredAppointments.filter((apt) => {
                  return (
                    ymdInBusinessTz(new Date(apt.scheduled_for)) === dayKey &&
                    hourInBusinessTz(apt.scheduled_for) === hour
                  )
                })
                return (
                  <div key={hour} data-hour-slot={hour} className="flex border-b min-h-[80px]">
                    <div className="w-20 px-3 py-2 text-sm text-gray-500 text-right border-r bg-gray-50">
                      {formatEasternHourLabel(hour)}
                    </div>
                    <div className="flex-1 p-2">
                      {hourAppointments.map(apt => (
                        <button
                          key={apt.id}
                          onClick={() => setSelectedAppointment(apt)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-white mb-2 ${getTypeColor(apt.appointment_type, apt.status)} ${
                            appointmentNeedsCloser(apt) ? 'ring-2 ring-amber-300' : ''
                          } ${apt.status === 'cancelled' ? 'opacity-60' : ''}`}
                        >
                          <div className={`font-semibold ${apt.status === 'cancelled' ? 'line-through' : ''}`}>{apt.lead?.homeowner_name || 'Appointment'}</div>
                          <div className="text-sm opacity-90">{formatTime(apt.scheduled_for)} - {apt.lead?.address_text || apt.address_text}</div>
                          <div className="text-xs opacity-85 mt-0.5">
                            {apt.status === 'cancelled' ? 'Cancelled' : appointmentKindLabel(apt.appointment_type)}
                            {apt.status !== 'cancelled' && (appointmentNeedsCloser(apt) ? ' · Needs rep' : apt.closer ? ` · ${apt.closer.full_name}` : '')}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Agenda View */
            <div className="divide-y">
              {filteredAppointments.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No appointments scheduled
                </div>
              ) : (
                filteredAppointments.map(apt => (
                  <button
                    key={apt.id}
                    onClick={() => setSelectedAppointment(apt)}
                    className={`w-full p-4 text-left hover:bg-gray-50 flex items-start gap-4 ${apt.status === 'cancelled' ? 'opacity-60' : ''}`}
                  >
                    <div className="text-center min-w-[60px]">
                      <div className="text-xs text-gray-500">
                        {new Date(apt.scheduled_for).toLocaleDateString([], { weekday: 'short' })}
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {new Date(apt.scheduled_for).getDate()}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(apt.scheduled_for).toLocaleDateString([], { month: 'short' })}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`w-2 h-2 rounded-full ${getTypeColor(apt.appointment_type, apt.status)}`} />
                        <span className={`font-semibold text-gray-900 ${apt.status === 'cancelled' ? 'line-through' : ''}`}>
                          {apt.lead?.homeowner_name || 'Appointment'}
                        </span>
                        <span className="text-sm text-gray-500">
                          {formatTime(apt.scheduled_for)}
                        </span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded text-white ${getTypeColor(apt.appointment_type, apt.status)}`}>
                          {appointmentKindLabel(apt.appointment_type)}
                        </span>
                        {appointmentNeedsCloser(apt) && (
                          <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            Needs rep
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600">
                        {apt.lead?.address_text || apt.address_text}
                      </div>
                      {apt.closer && (
                        <div className="text-xs text-gray-500 mt-1">
                          Rep: {apt.closer.full_name}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Appointment Detail Modal */}
      {selectedAppointment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full flex flex-col max-h-[90vh] overflow-hidden">
            {/* Sticky header */}
            <div className={`px-6 py-4 shrink-0 ${getTypeColor(selectedAppointment.appointment_type, selectedAppointment.status)} text-white`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">
                  {appointmentKindLabel(selectedAppointment.appointment_type)} Details
                </h3>
                <button
                  onClick={() => setSelectedAppointment(null)}
                  className="p-1 hover:bg-white/20 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Scrollable body */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <p className="text-sm text-gray-500">Customer</p>
                <p className="font-semibold text-gray-900">
                  {selectedAppointment.lead?.homeowner_name || 'Unknown'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Date & Time</p>
                <p className="font-semibold text-gray-900">
                  {new Date(selectedAppointment.scheduled_for).toLocaleDateString([], {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  {' at '}
                  {formatTime(selectedAppointment.scheduled_for)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Address</p>
                <p className="font-semibold text-gray-900">
                  {selectedAppointment.lead?.address_text || selectedAppointment.address_text || 'No address'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Type</p>
                <p className="font-semibold text-gray-900">{appointmentKindLabel(selectedAppointment.appointment_type)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Sales Rep</p>
                {appointmentNeedsCloser(selectedAppointment) ? (
                  <p className="font-semibold text-amber-800">Unassigned — use scheduling tools to assign or reassign</p>
                ) : selectedAppointment.closer ? (
                  <p className="font-semibold text-gray-900">{selectedAppointment.closer.full_name}</p>
                ) : (
                  <p className="font-semibold text-gray-500">—</p>
                )}
              </div>
              {selectedAppointment.canvasser && (
                <div>
                  <p className="text-sm text-gray-500">Set By</p>
                  <p className="font-semibold text-gray-900">{selectedAppointment.canvasser.full_name}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="font-semibold text-gray-900 capitalize">{selectedAppointment.status.replace('_', ' ')}</p>
              </div>
              {selectedAppointment.notes && (
                <div>
                  <p className="text-sm text-gray-500">Notes</p>
                  <p className="text-gray-900">{selectedAppointment.notes}</p>
                </div>
              )}

              {/* Reassignment — managers/admins only, not available for synthetic close-only rows */}
              {canReassignAppointments && selectedAppointment._calendarSource !== 'close_only' && (
                <div className="pt-3 border-t">
                  <p className="text-sm font-medium text-gray-700 mb-2">Reassign Rep</p>
                  <div className="flex gap-2">
                    <select
                      value={reassignCloserId}
                      onChange={(e) => setReassignCloserId(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white"
                    >
                      <option value="">Select rep…</option>
                      {scopedMembers
                        .filter((m) => m.id !== selectedAppointment.closer_user_id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name || 'Unknown'}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() =>
                        reassignCloserId &&
                        handleReassign(selectedAppointment.id, reassignCloserId)
                      }
                      disabled={!reassignCloserId || reassigning}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-indigo-700"
                    >
                      {reassigning ? '…' : 'Reassign'}
                    </button>
                  </div>
                  {reassignError && (
                    <p className="mt-1 text-xs text-red-600">{reassignError}</p>
                  )}
                </div>
              )}

              {/* Cancel appointment — managers/admins only, not already cancelled, not synthetic close-only */}
              {canReassignAppointments &&
                selectedAppointment.status !== 'cancelled' &&
                selectedAppointment._calendarSource !== 'close_only' && (
                <div className="pt-3 border-t">
                  <button
                    onClick={() => handleCancel(selectedAppointment.id)}
                    disabled={cancelling}
                    className="w-full py-2 bg-red-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-red-700"
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel Appointment'}
                  </button>
                  {cancelError && (
                    <p className="mt-1 text-xs text-red-600">{cancelError}</p>
                  )}
                </div>
              )}

              <div className="pt-4 flex gap-3">
                {(selectedAppointment.opportunity?.id || selectedAppointment.opportunity_id) && (
                  <a
                    href={`/opportunities/${selectedAppointment.opportunity?.id || selectedAppointment.opportunity_id}`}
                    className="flex-1 py-2 bg-indigo-600 text-white text-center font-medium rounded-lg hover:bg-indigo-700"
                  >
                    View Opportunity
                  </a>
                )}
                <button
                  onClick={() => setSelectedAppointment(null)}
                  className="flex-1 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scheduled Job Detail Modal */}
      {selectedJob && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div 
              className="px-6 py-4 text-white"
              style={{ backgroundColor: selectedJob.crew_color || '#8B5CF6' }}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">🔨 Scheduled Job</h3>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="p-1 hover:bg-white/20 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-500">Job Number</p>
                <p className="font-semibold text-gray-900">{selectedJob.job_number}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Customer</p>
                <p className="font-semibold text-gray-900">
                  {selectedJob.customer_name || 'Unknown'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Install Date</p>
                <p className="font-semibold text-gray-900">
                  {new Date(selectedJob.scheduled_date + 'T12:00:00').toLocaleDateString([], {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  {selectedJob.scheduled_time_start && ` at ${selectedJob.scheduled_time_start}`}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Address</p>
                <p className="font-semibold text-gray-900">{selectedJob.address_text}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Job Type</p>
                <p className="font-semibold text-gray-900 capitalize">{selectedJob.job_type}</p>
              </div>
              {selectedJob.crew_name && (
                <div>
                  <p className="text-sm text-gray-500">Assigned Crew</p>
                  <p className="font-semibold text-gray-900">{selectedJob.crew_name}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="font-semibold text-gray-900 capitalize">{selectedJob.status.replace('_', ' ')}</p>
              </div>
              <div className="pt-4 flex gap-3">
                {canAccessJobBoard(currentUser?.role) ? (
                  <a
                    href={`/ops/jobs/${selectedJob.id}`}
                    className="flex-1 py-2 bg-indigo-600 text-white text-center font-medium rounded-lg hover:bg-indigo-700"
                  >
                    View Job Details
                  </a>
                ) : null}
                <button
                  onClick={() => setSelectedJob(null)}
                  className={`py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 ${canAccessJobBoard(currentUser?.role) ? 'flex-1' : 'w-full'}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
