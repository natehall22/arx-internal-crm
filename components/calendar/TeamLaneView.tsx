'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

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
}

type DisplayAppointment = AppointmentRow & {
  lead: LeadRow | null
  closer_name: string | null
  canvasser_name: string | null
}

interface TeamLaneViewProps {
  calendarAccess: 'none' | 'team' | 'regional' | 'admin'
  viewerRegionId: string
  viewerTeamId: string
  regionId: string
  teamId: string
  memberId: string
  date: Date
  orgId: string
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
  const d = new Date(isoString)
  const hours = d.getHours() + d.getMinutes() / 60
  return Math.max(0, (hours - START_HOUR) * ROW_HEIGHT)
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
  viewerRegionId,
  viewerTeamId,
  regionId,
  teamId,
  memberId,
  date,
  orgId,
}: TeamLaneViewProps) {
  const supabase = createClientBrowser()
  const [loading, setLoading] = useState(true)
  const [closers, setClosers] = useState<CloserRow[]>([])
  const [appointments, setAppointments] = useState<DisplayAppointment[]>([])
  const [selectedAppointment, setSelectedAppointment] = useState<DisplayAppointment | null>(null)

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
        .in('role', ['sales_rep', 'rep', 'sales_manager', 'setter_manager', 'admin'])
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

      const closerIds = scopedClosers.map((c) => c.id)
      if (closerIds.length === 0) {
        setAppointments([])
        setLoading(false)
        return
      }

      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      const { data: appointmentsData } = await supabase
        .from('scheduled_appointments')
        .select('id, closer_user_id, canvasser_user_id, scheduled_for, duration_minutes, status, address_text, lead_id')
        .in('closer_user_id', closerIds)
        .gte('scheduled_for', startOfDay.toISOString())
        .lt('scheduled_for', endOfDay.toISOString())
        .neq('status', 'cancelled')
        .order('scheduled_for')

      const appts = (appointmentsData || []) as AppointmentRow[]
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

      const closerNameMap = Object.fromEntries(
        scopedClosers.map((closer) => [closer.id, closer.full_name || 'Unknown'])
      )

      const displayRows: DisplayAppointment[] = appts.map((appt) => ({
        ...appt,
        lead: appt.lead_id ? leadsMap[appt.lead_id] || null : null,
        closer_name: appt.closer_user_id ? closerNameMap[appt.closer_user_id] || null : null,
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
    supabase,
    teamId,
    viewerRegionId,
    viewerTeamId,
  ])

  const totalGridHeight = (END_HOUR - START_HOUR) * ROW_HEIGHT
  const timeRows = useMemo(() => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i), [])

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

            {!loading && closers.length === 0 && (
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
          onClick={() => setSelectedAppointment(null)}
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
                <span className="text-gray-900">{selectedAppointment.closer_name || 'Unknown'}</span>
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
            <button
              type="button"
              onClick={() => setSelectedAppointment(null)}
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
