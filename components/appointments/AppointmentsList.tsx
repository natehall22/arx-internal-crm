'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type TableFilter, type TableView } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/format'
import { ADJUSTER_MEETING_APPOINTMENT_TYPE } from '@/lib/adjuster-meeting'

interface Appointment {
  id: string
  lead_id?: string | null
  opportunity_id?: string | null
  scheduled_for: string
  duration_minutes: number
  address_text: string | null
  notes: string | null
  status: string
  appointment_type?: string | null
  closer_user_id: string
  canvasser_user_id: string | null
  leads?: { homeowner_name: string | null; phone: string | null }
  closer?: { id: string; full_name: string | null }
  setter?: { id: string; full_name: string | null }
  feedback?: { outcome: string; notes: string | null; setter_feedback: string | null; completed_at: string } | null
}
interface User { id: string; full_name: string | null; role: string }

const OUTCOME_LABEL: Record<string, string> = { sale: 'Moving forward', not_home: 'No show', said_no: 'Said no', rescheduled: 'Rescheduled' }

/** upcoming | needs_feedback | past — one value per row, the basis of the built-in views. */
/** Insurance calls and adjuster meetings never take the inspection feedback form (it would write an inspection outcome). */
const NO_FEEDBACK_TYPES = new Set(['insurance_call', ADJUSTER_MEETING_APPOINTMENT_TYPE])

function stageOf(a: Appointment, now = Date.now()): 'upcoming' | 'needs_feedback' | 'past' {
  const past = new Date(a.scheduled_for).getTime() < now
  if (a.status === 'scheduled') return past ? (NO_FEEDBACK_TYPES.has(String(a.appointment_type)) ? 'past' : 'needs_feedback') : 'upcoming'
  return 'past'
}

const SOON_FIRST = [{ id: 'when', desc: false }]
const LATEST_FIRST = [{ id: 'when', desc: true }]
const FILTERS: TableFilter<Appointment>[] = [
  { key: 'stage', label: 'When', options: [{ value: 'upcoming', label: 'Upcoming' }, { value: 'needs_feedback', label: 'Needs feedback' }, { value: 'past', label: 'Past' }], accessor: (a) => stageOf(a) },
  { key: 'status', label: 'Status', options: ['scheduled', 'completed', 'cancelled', 'no_show'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })), accessor: (a) => a.status },
]
const SYSTEM_VIEWS: TableView[] = [
  { id: 'sys:upcoming', name: 'Upcoming', state: { sorting: SOON_FIRST, search: '', filters: { stage: 'upcoming' } } },
  { id: 'sys:needs_feedback', name: 'Needs feedback', state: { sorting: SOON_FIRST, search: '', filters: { stage: 'needs_feedback' } } },
  { id: 'sys:past', name: 'Past', state: { sorting: LATEST_FIRST, search: '', filters: { stage: 'past' } } },
  { id: 'sys:all', name: 'All', state: { sorting: LATEST_FIRST, search: '', filters: {} } },
]

/** The appointments list on the shared DataTable (built-in views replace the old Upcoming / Past / Needs feedback tabs). */
export default function AppointmentsList() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [canReassign, setCanReassign] = useState(false)
  const [sessionAccessToken, setSessionAccessToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reassignModal, setReassignModal] = useState<Appointment | null>(null)
  const [newCloserId, setNewCloserId] = useState('')
  const [reassigning, setReassigning] = useState(false)

  const load = useCallback(async () => {
    try {
      // The API caps each filter at 100 rows, and "all" is newest-first, so ask for each view's own slice and merge:
      // otherwise far-future rows push past (needs-feedback) and near-term rows off the end.
      const responses = await Promise.all(['upcoming', 'needs_feedback', 'past'].map((f) => fetch(`/api/appointments?filter=${f}`)))
      if (responses.some((r) => r.status === 401)) {
        router.push('/login')
        return
      }
      if (responses.some((r) => !r.ok)) throw new Error('Failed to load appointments')
      const parts = await Promise.all(responses.map((r) => r.json()))
      const byId = new Map<string, Appointment>()
      for (const part of parts) for (const a of (part.appointments || []) as Appointment[]) byId.set(a.id, a)
      setAppointments(Array.from(byId.values()))
      setUsers(parts[0].users || [])
      setCanReassign(!!parts[0].canReassign)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }, [router])
  useEffect(() => { void load() }, [load])

  const handleReassign = async () => {
    if (!reassignModal || !newCloserId) return
    setReassigning(true)
    try {
      // Refresh the session token first: a stale cookie on a long-idle page causes silent 401s.
      let token = sessionAccessToken
      try {
        const profileRes = await fetch('/api/calendar/profile')
        if (profileRes.ok) {
          const fresh = await profileRes.json()
          if (fresh?.access_token) {
            token = fresh.access_token
            setSessionAccessToken(fresh.access_token)
          }
        }
      } catch {
        // proceed with the cookie fallback on the server
      }
      const response = await fetch(`/api/appointments/${reassignModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ new_closer_id: newCloserId }),
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reassign')
      }
      setReassignModal(null)
      setNewCloserId('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reassign')
    } finally {
      setReassigning(false)
    }
  }

  const columns = useMemo<ColumnDef<Appointment, any>[]>(
    () => [
      {
        id: 'customer',
        header: 'Customer',
        accessorFn: (a) => `${a.leads?.homeowner_name ?? ''} ${a.address_text ?? ''}`,
        cell: (c) => {
          const a = c.row.original
          return (
            <span>
              <span className="font-semibold">{a.leads?.homeowner_name || 'Unknown customer'}</span>
              {a.address_text ? <span className="block max-w-xs truncate text-ui-sm text-ink-muted">{a.address_text}</span> : null}
              {a.feedback ? (
                <span className="block text-ui-sm text-ink-muted">
                  {OUTCOME_LABEL[a.feedback.outcome] ?? a.feedback.outcome}
                  {a.feedback.setter_feedback || a.feedback.notes ? ` — ${a.feedback.setter_feedback || a.feedback.notes}` : ''}
                </span>
              ) : null}
            </span>
          )
        },
        meta: { mobile: 'title' },
      },
      { id: 'when', header: 'When', accessorFn: (a) => a.scheduled_for, cell: (c) => formatDateTime(c.getValue()) },
      {
        id: 'state',
        header: 'Status',
        accessorFn: (a) => (stageOf(a) === 'needs_feedback' ? 'Needs feedback' : a.status.replace(/_/g, ' ')),
        cell: (c) => <Badge tone={c.getValue() === 'Needs feedback' ? 'warning' : c.getValue() === 'completed' ? 'success' : c.getValue() === 'no show' ? 'danger' : 'info'} className="capitalize">{c.getValue()}</Badge>,
      },
      { id: 'closer', header: 'Closer', accessorFn: (a) => a.closer?.full_name ?? 'Unassigned' },
      { id: 'setter', header: 'Set by', accessorFn: (a) => a.setter?.full_name ?? 'N/A', meta: { mobile: 'hide' } },
      { id: 'duration', header: 'Length', accessorFn: (a) => a.duration_minutes, cell: (c) => `${c.getValue()} min`, meta: { mobile: 'hide' } },
    ],
    []
  )

  const hrefFor = (a: Appointment) => (a.opportunity_id ? `/opportunities/${a.opportunity_id}` : a.lead_id ? `/leads/${a.lead_id}` : undefined)

  return (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-ui-base text-danger">{error}</p> : null}
      <DataTable
        columns={columns}
        data={appointments}
        loading={loading}
        tableKey="appointments"
        getRowId={(a) => a.id}
        getRowHref={(a) => hrefFor(a) ?? '#'}
        searchPlaceholder="Search customer, address or closer"
        filters={FILTERS}
        systemViews={SYSTEM_VIEWS}
        defaultViewId="sys:upcoming"
        initialSorting={SOON_FIRST}
        rowActions={(a) => (
          <div className="flex flex-wrap justify-end gap-1">
            {stageOf(a) === 'needs_feedback' && !NO_FEEDBACK_TYPES.has(String(a.appointment_type)) ? <Button asChild size="sm"><Link href={`/appointments/feedback?id=${a.id}`}>Give feedback</Link></Button> : null}
            {canReassign && a.status === 'scheduled' ? (
              <Button variant="ghost" size="sm" onClick={() => { setReassignModal(a); setNewCloserId(a.closer_user_id) }}>Reassign</Button>
            ) : null}
            {a.status === 'scheduled' ? <Button asChild variant="ghost" size="sm"><Link href={`/appointments?reschedule=${a.id}`}>Reschedule</Link></Button> : null}
          </div>
        )}
        empty={{ title: 'No appointments here', body: 'Try another view.' }}
      />

      <Dialog open={!!reassignModal} onOpenChange={(o) => { if (!o) { setReassignModal(null); setNewCloserId('') } }}>
        <DialogContent title="Reassign appointment" description={`Move the appointment with ${reassignModal?.leads?.homeowner_name || 'this customer'} to a different rep.`}>
          <Select value={newCloserId} onChange={(e) => setNewCloserId(e.target.value)} aria-label="Assign to">
            <option value="">Select a rep…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || 'Unknown'} ({u.role})</option>)}
          </Select>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setReassignModal(null); setNewCloserId('') }}>Cancel</Button>
            <Button onClick={handleReassign} disabled={!newCloserId || newCloserId === reassignModal?.closer_user_id || reassigning}>{reassigning ? 'Reassigning…' : 'Reassign'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
