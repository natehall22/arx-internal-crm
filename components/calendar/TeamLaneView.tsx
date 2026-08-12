'use client'

import { useEffect, useMemo, useState } from 'react'
import { hourInBusinessTz, minutesInBusinessTz } from '@/lib/calendar-business-tz'
import { fetchSalesCalendarSlice } from '@/lib/calendar-sales'
import { filterAppointmentsByCalendarScope } from '@/lib/calendar-scope-filters'
import { nyDayRangeUtc } from '@/lib/calendar-business-tz'
import { createClientBrowser } from '@/lib/supabase/client'
import type { DbUserRole } from '@/lib/types/database'

// Typed as DbUserRole: an unknown label makes Postgres reject the entire query
// (22P02) and the lane view renders empty.
const LANE_CLOSER_ROLES: DbUserRole[] = ['sales_rep', 'closer', 'sales_manager', 'setter_manager', 'admin']

type CloserRow = {
  id: string
  full_name: string | null
  team_id?: string | null
  region_id?: string | null
}

type LeadRow = {
  id: string
  homeowner_name: string | null
  phone: string | null
}

type AppointmentRow = {
  id: string
  closer_user_id: string | null
  canvasser_user_id: string | null
  scheduled_for: string
  duration_minutes: number | null
  status: string
  address_text: string | null
  lead_id: string | null
  appointment_type: string | null
  _calendarSource?: 'scheduled' | 'close_only'
}

type CloserMeta = {
  full_name: string | null
  region_id: string | null
  team_id: string | null
}

type DisplayAppointment = AppointmentRow & {
  lead: LeadRow | null
  closer_name: string | null
  canvasser_name: string | null
}

interface TeamLaneViewProps {
  calendarAccess: 'none' | 'team' | 'regional' | 'admin'
  /** Same profile object as the calendar page (role + custom_role) for visibility rules */
  viewerProfile: unknown
  viewerRegionId: string
  viewerTeamId: string
  regionId: string
  teamId: string
  memberId: string
  date: Date
  orgId: string
  /** Matches PATCH /api/appointments/[id] (managers only). */
  canReassign?: boolean
}

const START_HOUR = 7
const END_HOUR = 21
const ROW_HEIGHT = 60
const TIME_COL_WIDTH = 64

function formatHour(hour24: number): string {
  if (hour24 === 0) return '12am'
  if (hour24 < 12) return `${hour24}am`
  if (hour24 === 12) return '12pm'
  return `${hour24 - 12}pm`
}

function getTopOffset(isoString: string): number {
  const h = hourInBusinessTz(isoString)
  const m = minutesInBusinessTz(isoString)
  return Math.max(0, (h + m / 60 - START_HOUR) * ROW_HEIGHT)
}

function getCardHeight(durationMinutes: number | null): number {
  const safeDuration = durationMinutes && durationMinutes > 0 ? durationMinutes : 60
  return Math.max(28, (safeDuration / 60) * ROW_HEIGHT)
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800'
    case 'no_show':
      return 'bg-red-100 text-red-800'
    case 'confirmed':
      return 'bg-blue-100 text-blue-800'
    default:
      return 'bg-yellow-100 text-yellow-800'
  }
}

export default function TeamLaneView({
  calendarAccess,
  viewerProfile,
  viewerRegionId,
  viewerTeamId,
  regionId,
  teamId,
  memberId,
  date,
  orgId,
  canReassign = false,
}: TeamLaneViewProps) {
  const supabase = createClientBrowser()
  const [loading, setLoading] = useState(true)
  const [closers, setClosers] = useState<CloserRow[]>([])
  const [appointments, setAppointments] = useState<DisplayAppointment[]>([])
  const [selectedAppointment, setSelectedAppointment] = useState<DisplayAppointment | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [reassignCloserId, setReassignCloserId] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [reassignError, setReassignError] = useState<string | null>(null)

  const isCalendarAdmin = calendarAccess === 'admin'
  const isCalendarRegional = calendarAccess === 'regional'
  const isCalendarTeamManager = calendarAccess === 'team'
  const canAccessTeamCalendar = isCalendarAdmin || isCalendarRegional || isCalendarTeamManager

  useEffect(() => {
    const loadTeamLanes = async () => {
      if (!orgId || !canAccessTeamCalendar) {
        setLoading(false)
        setClosers([])
        setAppointments([])
        return
      }

      setLoading(true)

      let closersQuery = supabase
        .from('users')
        .select('id, full_name, team_id, region_id')
        .eq('org_id', orgId)
        .in('role', LANE_CLOSER_ROLES)
        .order('full_name')

      if (isCalendarTeamManager && viewerTeamId) {
        closersQuery = closersQuery.eq('team_id', viewerTeamId)
      } else if (isCalendarRegional) {
        if (viewerRegionId) {
          closersQuery = closersQuery.eq('region_id', viewerRegionId)
        }
        if (teamId) {
          closersQuery = closersQuery.eq('team_id', teamId)
        }
      } else if (isCalendarAdmin) {
        if (regionId) {
          closersQuery = closersQuery.eq('region_id', regionId)
        }
        if (teamId) {
          closersQuery = closersQuery.eq('team_id', teamId)
        }
      }

      if (memberId) {
        closersQuery = closersQuery.eq('id', memberId)
      }

      const { data: closersData } = await closersQuery
      const scopedClosers = (closersData || []) as CloserRow[]
      setClosers(scopedClosers)

      const { start: rangeStart, end: rangeEnd } = nyDayRangeUtc(date)

      const { data: authUser } = await supabase.auth.getUser()
      if (!authUser.user) {
        setAppointments([])
        setLoading(false)
        return
      }

      const { rows: calendarRows, error: calErr } = await fetchSalesCalendarSlice(supabase, {
        orgId,
        authUserId: authUser.user.id,
        profile: viewerProfile,
        start: rangeStart,
        end: rangeEnd,
        canAccessTeamCalendar: true,
        selectedMemberId: memberId,
        selectedUserId: 'all',
        teamLaneFullOrg: true,
      })

      if (calErr) {
        console.warn('Team lane calendar load:', calErr)
      }

      // Full day in org: include unassigned + every assigned inspection (closers outside the lane list too)
      let appts = (calendarRows || []).filter((a) => a.status !== 'cancelled') as AppointmentRow[]

      const allCloserIds = Array.from(
        new Set(appts.map((a) => a.closer_user_id).filter(Boolean))
      ) as string[]

      const closerMetaById: Record<string, CloserMeta> = {}
      if (allCloserIds.length > 0) {
        const { data: closerUsers } = await supabase
          .from('users')
          .select('id, full_name, region_id, team_id')
          .eq('org_id', orgId)
          .in('id', allCloserIds)

        for (const u of closerUsers || []) {
          closerMetaById[u.id] = {
            full_name: u.full_name,
            region_id: u.region_id,
            team_id: u.team_id,
          }
        }
      }

      const userById = new Map(
        Object.entries(closerMetaById).map(([id, m]) => [
          id,
          { team_id: m.team_id, region_id: m.region_id },
        ])
      )
      appts = filterAppointmentsByCalendarScope(appts, {
        calendarAccess,
        viewerRegionId,
        viewerTeamId,
        regionId,
        teamId,
        memberId,
        userById,
      })
      const leadIds = Array.from(new Set(appts.map((a) => a.lead_id).filter(Boolean))) as string[]
      const setterIds = Array.from(new Set(appts.map((a) => a.canvasser_user_id).filter(Boolean))) as string[]

      let leadsMap: Record<string, LeadRow> = {}
      if (leadIds.length > 0) {
        const { data: leadsData } = await supabase
          .from('leads')
          .select('id, homeowner_name, phone')
          .in('id', leadIds)

        leadsMap = Object.fromEntries(((leadsData || []) as LeadRow[]).map((lead) => [lead.id, lead]))
      }

      let setterMap: Record<string, string> = {}
      if (setterIds.length > 0) {
        const { data: settersData } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', setterIds)
          .eq('org_id', orgId)

        setterMap = Object.fromEntries(
          ((settersData || []) as CloserRow[]).map((setter) => [setter.id, setter.full_name || 'Unknown'])
        )
      }

      const displayRows: DisplayAppointment[] = appts.map((appt) => ({
        ...appt,
        lead: appt.lead_id ? leadsMap[appt.lead_id] || null : null,
        closer_name: appt.closer_user_id
          ? closerMetaById[appt.closer_user_id]?.full_name || null
          : null,
        canvasser_name: appt.canvasser_user_id ? setterMap[appt.canvasser_user_id] || null : null,
      }))

      setAppointments(displayRows)
      setLoading(false)
    }

    loadTeamLanes()
  }, [
    canAccessTeamCalendar,
    date,
    isCalendarAdmin,
    isCalendarRegional,
    isCalendarTeamManager,
    memberId,
    orgId,
    regionId,
    reloadKey,
    supabase,
    viewerProfile,
    teamId,
    viewerRegionId,
    viewerTeamId,
  ])

  async function handleReassign() {
    if (!selectedAppointment || !reassignCloserId) return
    if (selectedAppointment._calendarSource === 'close_only') {
      setReassignError('Use the opportunity / schedule-close flow for this row.')
      return
    }
    setReassigning(true)
    setReassignError(null)
    try {
      const token = (viewerProfile as { access_token?: string })?.access_token
      const res = await fetch(`/api/appointments/${selectedAppointment.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ new_closer_id: reassignCloserId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setReassignError(data.error || 'Reassignment failed')
      } else {
        setSelectedAppointment(null)
        setReassignCloserId('')
        setReloadKey((k) => k + 1)
      }
    } catch {
      setReassignError('Network error')
    } finally {
      setReassigning(false)
    }
  }

  const totalGridHeight = (END_HOUR - START_HOUR) * ROW_HEIGHT
  const timeRows = useMemo(() => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i), [])

  const scopedCloserIdSet = useMemo(() => new Set(closers.map((c) => c.id)), [closers])
  const otherAssigneeAppointments = useMemo(
    () =>
      appointments.filter((a) => a.closer_user_id && !scopedCloserIdSet.has(a.closer_user_id)),
    [appointments, scopedCloserIdSet]
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-96 text-gray-500">Loading team calendar...</div>
        ) : (
          <div className="flex min-w-full">
            <div className="flex-shrink-0 border-r bg-white" style={{ width: TIME_COL_WIDTH }}>
              <div className="h-12 border-b bg-gray-50" />
              {timeRows.map((hour) => (
                <div
                  key={hour}
                  style={{ height: ROW_HEIGHT }}
                  className="border-b px-1 pt-1 text-[11px] text-right text-gray-500"
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>

            {otherAssigneeAppointments.length > 0 && (
              <div className="flex-shrink-0 border-r border-slate-200" style={{ minWidth: 220, width: 280 }}>
                <div className="h-12 border-b px-3 py-1.5 bg-slate-50">
                  <p className="text-sm font-semibold text-slate-900 truncate">Other assignees</p>
                  <p className="text-xs text-slate-600">
                    {otherAssigneeAppointments.length} not in this rep list (other roles / teams)
                  </p>
                </div>
                <div className="relative bg-slate-50/40" style={{ height: totalGridHeight }}>
                  {timeRows.map((hour, idx) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 border-b border-slate-100"
                      style={{ top: idx * ROW_HEIGHT }}
                    />
                  ))}
                  {otherAssigneeAppointments.map((appt) => (
                    <button
                      type="button"
                      key={appt.id}
                      onClick={() => setSelectedAppointment(appt)}
                      className="absolute left-1 right-1 rounded-md px-2 py-1 text-left bg-slate-50 border border-slate-200 hover:bg-slate-100 overflow-hidden"
                      style={{ top: getTopOffset(appt.scheduled_for), height: getCardHeight(appt.duration_minutes) }}
                    >
                      <p className="text-[10px] font-medium text-slate-600 truncate">
                        {appt.closer_name || 'Assigned rep'}
                      </p>
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {appt.lead?.homeowner_name || 'Appointment'}
                      </p>
                      <p className="text-[11px] text-slate-700 truncate">
                        {new Date(appt.scheduled_for).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </p>
                      <p className="text-[10px] text-slate-600 truncate">
                        {(appt.appointment_type || 'inspection') === 'close' ? 'Close' : 'Inspection'}
                      </p>
                      <p className="text-[10px] text-gray-700 truncate">{appt.address_text || 'No address'}</p>
                      <span
                        className={`inline-flex mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusColor(appt.status)}`}
                      >
                        {appt.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {appointments.some((a) => !a.closer_user_id) && (
              <div className="flex-shrink-0 border-r border-amber-200" style={{ minWidth: 220, width: 260 }}>
                <div className="h-12 border-b px-3 py-1.5 bg-amber-50">
                  <p className="text-sm font-semibold text-amber-900 truncate">Unassigned</p>
                  <p className="text-xs text-amber-800">
                    {(() => {
                      const n = appointments.filter((a) => !a.closer_user_id).length
                      return `${n} ${n === 1 ? 'needs' : 'need'} a rep`
                    })()}
                  </p>
                </div>
                <div className="relative bg-amber-50/30" style={{ height: totalGridHeight }}>
                  {timeRows.map((hour, idx) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 border-b border-amber-100"
                      style={{ top: idx * ROW_HEIGHT }}
                    />
                  ))}
                  {appointments
                    .filter((appt) => !appt.closer_user_id)
                    .map((appt) => (
                      <button
                        type="button"
                        key={appt.id}
                        onClick={() => setSelectedAppointment(appt)}
                        className="absolute left-1 right-1 rounded-md px-2 py-1 text-left bg-amber-50 border-2 border-amber-300 hover:bg-amber-100 overflow-hidden"
                        style={{ top: getTopOffset(appt.scheduled_for), height: getCardHeight(appt.duration_minutes) }}
                      >
                        <p className="text-xs font-semibold text-amber-950 truncate">
                          {appt.lead?.homeowner_name || 'Appointment'}
                        </p>
                        <p className="text-[11px] text-amber-900 truncate">
                          {new Date(appt.scheduled_for).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </p>
                        <p className="text-[10px] text-amber-900/90 truncate">
                          {(appt.appointment_type || 'inspection') === 'close' ? 'Close' : 'Inspection'}
                        </p>
                        <p className="text-[10px] text-gray-700 truncate">{appt.address_text || 'No address'}</p>
                        <span
                          className={`inline-flex mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusColor(appt.status)}`}
                        >
                          {appt.status}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {closers.map((closer) => {
              const closerAppointments = appointments.filter((appt) => appt.closer_user_id === closer.id)
              return (
                <div key={closer.id} className="flex-shrink-0 border-r" style={{ minWidth: 220, width: 260 }}>
                  <div className="h-12 border-b px-3 py-1.5 bg-gray-50">
                    <p className="text-sm font-semibold text-gray-900 truncate">{closer.full_name || 'Unknown'}</p>
                    <p className="text-xs text-gray-500">
                      {closerAppointments.length} appt{closerAppointments.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  <div className="relative bg-white" style={{ height: totalGridHeight }}>
                    {timeRows.map((hour, idx) => (
                      <div
                        key={hour}
                        className="absolute left-0 right-0 border-b border-gray-100"
                        style={{ top: idx * ROW_HEIGHT }}
                      />
                    ))}

                    {closerAppointments.map((appt) => (
                      <button
                        type="button"
                        key={appt.id}
                        onClick={() => setSelectedAppointment(appt)}
                        className="absolute left-1 right-1 rounded-md px-2 py-1 text-left bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 overflow-hidden"
                        style={{ top: getTopOffset(appt.scheduled_for), height: getCardHeight(appt.duration_minutes) }}
                      >
                        <p className="text-xs font-semibold text-indigo-900 truncate">
                          {appt.lead?.homeowner_name || 'Appointment'}
                        </p>
                        <p className="text-[11px] text-indigo-700 truncate">
                          {new Date(appt.scheduled_for).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </p>
                        <p className="text-[10px] text-gray-600 truncate">
                          {(appt.appointment_type || 'inspection') === 'close' ? 'Close' : 'Inspection'}
                        </p>
                        <p className="text-[10px] text-gray-700 truncate">{appt.address_text || 'No address'}</p>
                        <span
                          className={`inline-flex mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusColor(appt.status)}`}
                        >
                          {appt.status}
                        </span>
                      </button>
                    ))}

                    {closerAppointments.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                        No appointments
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {!loading && closers.length === 0 && appointments.length === 0 && (
              <div className="flex items-center justify-center flex-1 min-h-[320px] text-sm text-gray-500">
                No members found for this scope.
              </div>
            )}
          </div>
        )}
      </div>

      {selectedAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setSelectedAppointment(null); setReassignCloserId(''); setReassignError(null) }}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-3">
              {selectedAppointment.lead?.homeowner_name || 'Appointment Details'}
            </h3>
            <div className="space-y-1.5 text-sm">
              <p>
                <span className="text-gray-500">Time:</span>{' '}
                <span className="text-gray-900">
                  {new Date(selectedAppointment.scheduled_for).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </p>
              <p>
                <span className="text-gray-500">Duration:</span>{' '}
                <span className="text-gray-900">{selectedAppointment.duration_minutes || 60} min</span>
              </p>
              <p>
                <span className="text-gray-500">Address:</span>{' '}
                <span className="text-gray-900">{selectedAppointment.address_text || 'No address'}</span>
              </p>
              <p>
                <span className="text-gray-500">Phone:</span>{' '}
                <span className="text-gray-900">{selectedAppointment.lead?.phone || 'No phone'}</span>
              </p>
              <p>
                <span className="text-gray-500">Closer:</span>{' '}
                <span className={selectedAppointment.closer_user_id ? 'text-gray-900' : 'text-amber-800 font-medium'}>
                  {selectedAppointment.closer_name || (selectedAppointment.closer_user_id ? 'Unknown' : 'Unassigned')}
                </span>
              </p>
              <p>
                <span className="text-gray-500">Setter:</span>{' '}
                <span className="text-gray-900">{selectedAppointment.canvasser_name || 'Unknown'}</span>
              </p>
              <p>
                <span className="text-gray-500">Status:</span>{' '}
                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium ${statusColor(selectedAppointment.status)}`}>
                  {selectedAppointment.status}
                </span>
              </p>
            </div>
            {canReassign && selectedAppointment._calendarSource !== 'close_only' && (
              <>
                <div className="border-t my-3" />
                <p className="text-sm font-medium text-gray-700 mb-1.5">Reassign to</p>
                <div className="flex gap-2">
                  <select
                    value={reassignCloserId}
                    onChange={(e) => { setReassignCloserId(e.target.value); setReassignError(null) }}
                    className="flex-1 text-sm border rounded-md px-2 py-1.5"
                    disabled={reassigning}
                  >
                    <option value="">Select closer...</option>
                    {closers
                      .filter((c) => c.id !== (selectedAppointment.closer_user_id || ''))
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name || 'Unknown'}</option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleReassign}
                    disabled={!reassignCloserId || reassigning}
                    className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {reassigning ? 'Reassigning...' : 'Reassign'}
                  </button>
                </div>
                {reassignError && (
                  <p className="text-xs text-red-600 mt-1">{reassignError}</p>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => { setSelectedAppointment(null); setReassignCloserId(''); setReassignError(null) }}
              className="mt-4 px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
