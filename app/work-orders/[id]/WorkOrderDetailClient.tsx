'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface WorkOrder {
  id: string
  work_order_number: string
  work_order_type: string
  status: string
  priority: string
  title: string
  description: string | null
  scope_of_work: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  scheduled_date: string | null
  scheduled_time_start: string | null
  estimated_hours: number | null
  materials: any[]
  completed_at: string | null
  completion_notes: string | null
  created_at: string
  projects?: { id: string; address_text: string } | null
  customers?: { id: string; name: string; phone: string } | null
  assigned_user?: { id: string; full_name: string; email: string } | null
  assigned_sub?: { id: string; company_name: string; contact_name: string; phone: string } | null
  created_by_user?: { full_name: string } | null
}

interface Comment {
  id: string
  comment: string
  is_internal: boolean
  created_at: string
  user?: { full_name: string } | null
  sub?: { company_name: string } | null
}

interface StatusHistory {
  id: string
  old_status: string | null
  new_status: string
  created_at: string
  changed_by_user?: { full_name: string } | null
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  scheduled: 'bg-purple-100 text-purple-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  on_hold: 'bg-orange-100 text-orange-800',
}

const priorityLabels: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: 'text-gray-500' },
  normal: { label: 'Normal', color: 'text-blue-500' },
  high: { label: 'High', color: 'text-orange-500' },
  urgent: { label: 'Urgent', color: 'text-red-500' },
}

const typeLabels: Record<string, string> = {
  go_back: 'Go Back',
  repair: 'Repair',
  warranty: 'Warranty',
  punch_list: 'Punch List',
  inspection: 'Inspection',
  install: 'Install',
  service_call: 'Service Call',
}

interface WorkOrderDetailClientProps {
  initialWorkOrder: WorkOrder
  initialComments: Comment[]
  initialStatusHistory: StatusHistory[]
  userId: string
  orgId: string
  userRole: string
}

export default function WorkOrderDetailClient({
  initialWorkOrder,
  initialComments,
  initialStatusHistory,
  userId,
  orgId,
}: WorkOrderDetailClientProps) {
  const router = useRouter()
  const [workOrder, setWorkOrder] = useState<WorkOrder>(initialWorkOrder)
  const [comments, setComments] = useState<Comment[]>(initialComments)
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>(initialStatusHistory)
  const [newComment, setNewComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [saving, setSaving] = useState(false)

  const supabase = createClientBrowser()

  const updateStatus = async (newStatus: string) => {
    setSaving(true)

    const updates: any = { status: newStatus }
    if (newStatus === 'completed') {
      updates.completed_at = new Date().toISOString()
      updates.completed_by = userId
    }

    const { error } = await supabase
      .from('work_orders')
      .update(updates)
      .eq('id', workOrder.id)

    if (!error) {
      await supabase.from('work_order_status_history').insert({
        work_order_id: workOrder.id,
        old_status: workOrder.status,
        new_status: newStatus,
        changed_by: userId,
      })

      setWorkOrder(prev => ({ ...prev, status: newStatus }))
      
      const { data: historyData } = await supabase
        .from('work_order_status_history')
        .select(`*, changed_by_user:users(full_name)`)
        .eq('work_order_id', workOrder.id)
        .order('created_at', { ascending: false })
      
      if (historyData) setStatusHistory(historyData)
    }

    setSaving(false)
  }

  const addComment = async () => {
    if (!newComment.trim()) return

    setSaving(true)

    const { error, data } = await supabase.from('work_order_comments').insert({
      org_id: orgId,
      work_order_id: workOrder.id,
      user_id: userId,
      comment: newComment,
      is_internal: isInternal,
    }).select(`*, user:users(full_name), sub:sub_contractors(company_name)`).single()

    if (!error && data) {
      setComments(prev => [...prev, data])
      setNewComment('')
      setIsInternal(false)
    }

    setSaving(false)
  }

  const priority = priorityLabels[workOrder.priority] || priorityLabels.normal

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/work-orders" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Work Orders
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-mono text-gray-500">{workOrder.work_order_number}</span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[workOrder.status]}`}>
                      {workOrder.status.replace('_', ' ')}
                    </span>
                    <span className={`text-sm font-medium ${priority.color}`}>
                      {priority.label} Priority
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900">{workOrder.title}</h1>
                  <p className="text-gray-500 mt-1">
                    {typeLabels[workOrder.work_order_type] || workOrder.work_order_type}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-4 border-t">
                {workOrder.status === 'pending' && (
                  <button
                    onClick={() => updateStatus('in_progress')}
                    disabled={saving}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                  >
                    Start Work
                  </button>
                )}
                {workOrder.status === 'assigned' && (
                  <button
                    onClick={() => updateStatus('in_progress')}
                    disabled={saving}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                  >
                    Start Work
                  </button>
                )}
                {workOrder.status === 'in_progress' && (
                  <button
                    onClick={() => updateStatus('completed')}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    Mark Complete
                  </button>
                )}
                {workOrder.status !== 'completed' && workOrder.status !== 'cancelled' && (
                  <>
                    <button
                      onClick={() => updateStatus('on_hold')}
                      disabled={saving}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                    >
                      Put On Hold
                    </button>
                    <button
                      onClick={() => updateStatus('cancelled')}
                      disabled={saving}
                      className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {workOrder.description && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Description</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{workOrder.description}</p>
              </div>
            )}

            {workOrder.scope_of_work && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Scope of Work</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{workOrder.scope_of_work}</p>
              </div>
            )}

            {workOrder.materials && workOrder.materials.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Materials Needed</h2>
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Material</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Quantity</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {workOrder.materials.map((m: any, idx: number) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-gray-900">{m.name}</td>
                        <td className="px-4 py-2 text-gray-600">{m.quantity}</td>
                        <td className="px-4 py-2 text-gray-600">{m.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Comments & Activity</h2>
              
              <div className="mb-6">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="Add a comment..."
                />
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                    />
                    Internal note (not visible to sub-contractors)
                  </label>
                  <button
                    onClick={addComment}
                    disabled={saving || !newComment.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm disabled:opacity-50"
                  >
                    Add Comment
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {comments.length === 0 ? (
                  <p className="text-gray-500 text-sm">No comments yet</p>
                ) : (
                  comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`p-4 rounded-lg ${comment.is_internal ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">
                          {comment.user?.full_name || comment.sub?.company_name || 'Unknown'}
                        </span>
                        <div className="flex items-center gap-2">
                          {comment.is_internal && (
                            <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">
                              Internal
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {new Date(comment.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-gray-700">{comment.comment}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Location</h2>
              {workOrder.customers && (
                <div className="mb-3">
                  <div className="text-sm text-gray-500">Customer</div>
                  <Link
                    href={`/customers/${workOrder.customers.id}`}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {workOrder.customers.name}
                  </Link>
                  {workOrder.customers.phone && (
                    <div className="text-sm text-gray-600">{workOrder.customers.phone}</div>
                  )}
                </div>
              )}
              {workOrder.address && (
                <div className="mb-3">
                  <div className="text-sm text-gray-500">Address</div>
                  <div className="text-gray-900">
                    {workOrder.address}<br />
                    {workOrder.city}, {workOrder.state} {workOrder.zip}
                  </div>
                </div>
              )}
              {workOrder.projects && (
                <div>
                  <div className="text-sm text-gray-500">Related Project</div>
                  <Link
                    href={`/projects/${workOrder.projects.id}`}
                    className="text-indigo-600 hover:text-indigo-800 text-sm"
                  >
                    View Project →
                  </Link>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Assignment</h2>
              {workOrder.assigned_user ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                    <span className="text-indigo-600 font-medium">
                      {workOrder.assigned_user.full_name?.charAt(0) || '?'}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{workOrder.assigned_user.full_name}</div>
                    <div className="text-sm text-gray-500">In-House</div>
                  </div>
                </div>
              ) : workOrder.assigned_sub ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                    <span className="text-orange-600 font-medium">S</span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{workOrder.assigned_sub.company_name}</div>
                    <div className="text-sm text-gray-500">Sub-Contractor</div>
                    {workOrder.assigned_sub.phone && (
                      <div className="text-sm text-gray-500">{workOrder.assigned_sub.phone}</div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">Unassigned</p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule</h2>
              {workOrder.scheduled_date ? (
                <div>
                  <div className="text-lg font-medium text-gray-900">
                    {new Date(workOrder.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      timeZone: 'America/New_York',
                    })}
                  </div>
                  {workOrder.estimated_hours && (
                    <div className="text-sm text-gray-500 mt-1">
                      Est. {workOrder.estimated_hours} hours
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-500">Not scheduled</p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Status History</h2>
              <div className="space-y-3">
                {statusHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-gray-400 rounded-full mt-2" />
                    <div>
                      <div className="text-sm text-gray-900">
                        {entry.old_status ? (
                          <>
                            <span className="capitalize">{entry.old_status.replace('_', ' ')}</span>
                            {' → '}
                          </>
                        ) : null}
                        <span className="capitalize font-medium">{entry.new_status.replace('_', ' ')}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2" />
                  <div>
                    <div className="text-sm text-gray-900">Created</div>
                    <div className="text-xs text-gray-500">
                      {new Date(workOrder.created_at).toLocaleString()}
                      {workOrder.created_by_user && ` by ${workOrder.created_by_user.full_name}`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
