'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'

interface SubContractor {
  id: string
  company_name: string
  org_id: string
}

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
  estimated_hours: number | null
  materials: any[]
  customers?: any
  projects?: any
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

const typeLabels: Record<string, string> = {
  go_back: 'Go Back',
  repair: 'Repair',
  warranty: 'Warranty',
  punch_list: 'Punch List',
  inspection: 'Inspection',
  install: 'Install',
  service_call: 'Service Call',
}

export default function SubPortalPage() {
  const params = useParams()
  const [sub, setSub] = useState<SubContractor | null>(null)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)

  const supabase = createClientBrowser()

  useEffect(() => {
    loadPortalData()
  }, [params.token])

  const loadPortalData = async () => {
    try {
      // Find sub by token
      const { data: subData, error: subError } = await supabase
        .from('sub_contractors')
        .select('id, company_name, org_id, portal_access_enabled')
        .eq('portal_access_token', params.token)
        .single()

      if (subError || !subData) {
        setError('Invalid or expired portal link')
        setLoading(false)
        return
      }

      if (!subData.portal_access_enabled) {
        setError('Portal access has been disabled')
        setLoading(false)
        return
      }

      setSub(subData)

      // Update last access time
      await supabase
        .from('sub_contractors')
        .update({ last_portal_access: new Date().toISOString() })
        .eq('id', subData.id)

      // Load assigned work orders
      const { data: woData } = await supabase
        .from('work_orders')
        .select(`
          id, work_order_number, work_order_type, status, priority,
          title, description, scope_of_work,
          address, city, state, zip,
          scheduled_date, estimated_hours, materials,
          customers(name, phone),
          projects(address_text)
        `)
        .eq('assigned_sub_id', subData.id)
        .neq('status', 'cancelled')
        .order('scheduled_date', { ascending: true, nullsFirst: false })

      setWorkOrders(woData || [])
      setLoading(false)
    } catch (err) {
      setError('Failed to load portal data')
      setLoading(false)
    }
  }

  const updateStatus = async (woId: string, newStatus: string) => {
    if (!sub) return

    setSaving(true)

    const { error } = await supabase
      .from('work_orders')
      .update({ 
        status: newStatus,
        ...(newStatus === 'completed' ? { completed_at: new Date().toISOString() } : {})
      })
      .eq('id', woId)
      .eq('assigned_sub_id', sub.id)

    if (!error) {
      await loadPortalData()
      if (selectedWO?.id === woId) {
        setSelectedWO(prev => prev ? { ...prev, status: newStatus } : null)
      }
    }

    setSaving(false)
  }

  const addComment = async () => {
    if (!newComment.trim() || !selectedWO || !sub) return

    setSaving(true)

    const { error } = await supabase.from('work_order_comments').insert({
      org_id: sub.org_id,
      work_order_id: selectedWO.id,
      sub_id: sub.id,
      comment: newComment,
      is_internal: false,
    })

    if (!error) {
      setNewComment('')
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading portal...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Sub-Contractor Portal</h1>
              <p className="text-sm text-gray-500">{sub?.company_name}</p>
            </div>
            <div className="text-sm text-gray-500">
              {workOrders.filter(wo => wo.status !== 'completed').length} active work orders
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {workOrders.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-gray-900 mb-2">No Work Orders</h2>
            <p className="text-gray-500">You don't have any assigned work orders at this time.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Work Orders List */}
            <div className="lg:col-span-1 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Your Work Orders</h2>
              {workOrders.map((wo) => (
                <div
                  key={wo.id}
                  onClick={() => setSelectedWO(wo)}
                  className={`bg-white rounded-xl shadow-sm p-4 cursor-pointer transition ${
                    selectedWO?.id === wo.id ? 'ring-2 ring-indigo-500' : 'hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-mono text-gray-500">{wo.work_order_number}</span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[wo.status]}`}>
                      {wo.status.replace('_', ' ')}
                    </span>
                  </div>
                  <h3 className="font-medium text-gray-900 mb-1">{wo.title}</h3>
                  <p className="text-sm text-gray-500">
                    {typeLabels[wo.work_order_type] || wo.work_order_type}
                  </p>
                  {wo.scheduled_date && (
                    <p className="text-sm text-indigo-600 mt-2">
                      📅 {new Date(wo.scheduled_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Work Order Detail */}
            <div className="lg:col-span-2">
              {selectedWO ? (
                <div className="bg-white rounded-xl shadow-sm">
                  <div className="p-6 border-b">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-sm font-mono text-gray-500">{selectedWO.work_order_number}</span>
                        <h2 className="text-xl font-bold text-gray-900 mt-1">{selectedWO.title}</h2>
                        <p className="text-gray-500">{typeLabels[selectedWO.work_order_type]}</p>
                      </div>
                      <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[selectedWO.status]}`}>
                        {selectedWO.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="p-6 space-y-6">
                    {/* Location */}
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-2">LOCATION</h3>
                      <div className="bg-gray-50 rounded-lg p-4">
                        {selectedWO.customers?.name && (
                          <p className="font-medium text-gray-900">{selectedWO.customers.name}</p>
                        )}
                        {selectedWO.address && (
                          <p className="text-gray-700">
                            {selectedWO.address}<br />
                            {selectedWO.city}, {selectedWO.state} {selectedWO.zip}
                          </p>
                        )}
                        {selectedWO.customers?.phone && (
                          <p className="text-indigo-600 mt-2">
                            <a href={`tel:${selectedWO.customers.phone}`}>{selectedWO.customers.phone}</a>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Schedule */}
                    {selectedWO.scheduled_date && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 mb-2">SCHEDULED</h3>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-lg font-medium text-gray-900">
                            {new Date(selectedWO.scheduled_date).toLocaleDateString('en-US', {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </p>
                          {selectedWO.estimated_hours && (
                            <p className="text-gray-500">Est. {selectedWO.estimated_hours} hours</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Scope of Work */}
                    {selectedWO.scope_of_work && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 mb-2">SCOPE OF WORK</h3>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-gray-700 whitespace-pre-wrap">{selectedWO.scope_of_work}</p>
                        </div>
                      </div>
                    )}

                    {/* Materials */}
                    {selectedWO.materials && selectedWO.materials.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 mb-2">MATERIALS</h3>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500">
                                <th className="pb-2">Item</th>
                                <th className="pb-2">Qty</th>
                                <th className="pb-2">Unit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedWO.materials.map((m: any, idx: number) => (
                                <tr key={idx}>
                                  <td className="py-1 text-gray-900">{m.name}</td>
                                  <td className="py-1 text-gray-700">{m.quantity}</td>
                                  <td className="py-1 text-gray-700">{m.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    {selectedWO.description && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 mb-2">ADDITIONAL DETAILS</h3>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-gray-700 whitespace-pre-wrap">{selectedWO.description}</p>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="pt-4 border-t">
                      <h3 className="text-sm font-medium text-gray-500 mb-3">UPDATE STATUS</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedWO.status === 'assigned' && (
                          <button
                            onClick={() => updateStatus(selectedWO.id, 'in_progress')}
                            disabled={saving}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Start Work
                          </button>
                        )}
                        {selectedWO.status === 'in_progress' && (
                          <button
                            onClick={() => updateStatus(selectedWO.id, 'completed')}
                            disabled={saving}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                          >
                            Mark Complete
                          </button>
                        )}
                        {selectedWO.status !== 'completed' && selectedWO.status !== 'on_hold' && (
                          <button
                            onClick={() => updateStatus(selectedWO.id, 'on_hold')}
                            disabled={saving}
                            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                          >
                            Put On Hold
                          </button>
                        )}
                        {selectedWO.status === 'on_hold' && (
                          <button
                            onClick={() => updateStatus(selectedWO.id, 'in_progress')}
                            disabled={saving}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Resume Work
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Add Comment */}
                    <div className="pt-4 border-t">
                      <h3 className="text-sm font-medium text-gray-500 mb-3">ADD NOTE</h3>
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        rows={3}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-2"
                        placeholder="Add a note or update..."
                      />
                      <button
                        onClick={addComment}
                        disabled={saving || !newComment.trim()}
                        className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50"
                      >
                        Add Note
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                    </svg>
                  </div>
                  <p className="text-gray-500">Select a work order to view details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
