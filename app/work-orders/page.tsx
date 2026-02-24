'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface WorkOrder {
  id: string
  work_order_number: string
  title: string
  work_order_type: string
  status: string
  priority: string
  address: string
  city: string
  state: string
  scheduled_date: string | null
  created_at: string
  projects?: { id: string; address_text: string } | null
  customers?: { id: string; name: string } | null
  assigned_user?: { id: string; full_name: string } | null
  assigned_sub?: { id: string; company_name: string } | null
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

const priorityColors: Record<string, string> = {
  low: 'text-gray-500',
  normal: 'text-blue-500',
  high: 'text-orange-500',
  urgent: 'text-red-500',
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

export default function WorkOrdersPage() {
  const router = useRouter()
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const supabase = createClientBrowser()

  useEffect(() => {
    loadWorkOrders()
  }, [statusFilter, typeFilter])

  const loadWorkOrders = async () => {
    // First try to get session - this handles cookie restoration
    const { data: { session } } = await supabase.auth.getSession()
    let userId = session?.user?.id
    
    if (!userId) {
      // Double-check with getUser as fallback
      const { data: { user: fallbackUser } } = await supabase.auth.getUser()
      userId = fallbackUser?.id
    }
    
    if (!userId) {
      router.push('/login?next=/work-orders')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', userId)
      .single()

    if (!profile) return

    let query = supabase
      .from('work_orders')
      .select(`
        *,
        projects(id, address_text),
        customers(id, name),
        assigned_user:users!work_orders_assigned_user_id_fkey(id, full_name),
        assigned_sub:sub_contractors(id, company_name)
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (typeFilter !== 'all') {
      query = query.eq('work_order_type', typeFilter)
    }

    const { data } = await query

    setWorkOrders(data || [])
    setLoading(false)
  }

  const filteredWorkOrders = workOrders.filter(wo => {
    if (!searchQuery) return true
    const search = searchQuery.toLowerCase()
    return (
      wo.work_order_number.toLowerCase().includes(search) ||
      wo.title.toLowerCase().includes(search) ||
      wo.address?.toLowerCase().includes(search) ||
      wo.customers?.name?.toLowerCase().includes(search)
    )
  })

  const stats = {
    total: workOrders.length,
    pending: workOrders.filter(wo => wo.status === 'pending').length,
    inProgress: workOrders.filter(wo => wo.status === 'in_progress').length,
    completed: workOrders.filter(wo => wo.status === 'completed').length,
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Work Orders</h1>
            <p className="text-gray-500 mt-1">Manage go-backs, repairs, and service calls</p>
          </div>
          <Link
            href="/work-orders/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Work Order
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">Total</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-sm text-gray-500">Pending</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-indigo-600">{stats.inProgress}</div>
            <div className="text-sm text-gray-500">In Progress</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <div className="text-sm text-gray-500">Completed</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search work orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="flex gap-4">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="assigned">Assigned</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">All Types</option>
                <option value="go_back">Go Back</option>
                <option value="repair">Repair</option>
                <option value="warranty">Warranty</option>
                <option value="punch_list">Punch List</option>
                <option value="inspection">Inspection</option>
                <option value="install">Install</option>
                <option value="service_call">Service Call</option>
              </select>
            </div>
          </div>
        </div>

        {/* Work Orders List */}
        {filteredWorkOrders.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No work orders yet</h3>
            <p className="text-gray-500 mb-4">Create your first work order to get started</p>
            <Link
              href="/work-orders/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Create Work Order
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Work Order</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer/Location</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned To</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredWorkOrders.map((wo) => (
                  <tr key={wo.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`${priorityColors[wo.priority]}`}>
                          {wo.priority === 'urgent' && '🔴'}
                          {wo.priority === 'high' && '🟠'}
                          {wo.priority === 'normal' && '🔵'}
                          {wo.priority === 'low' && '⚪'}
                        </span>
                        <div>
                          <div className="font-medium text-gray-900">{wo.work_order_number}</div>
                          <div className="text-sm text-gray-500 max-w-xs truncate">{wo.title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600">
                        {typeLabels[wo.work_order_type] || wo.work_order_type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        {wo.customers?.name && (
                          <div className="font-medium text-gray-900">{wo.customers.name}</div>
                        )}
                        <div className="text-gray-500">
                          {wo.address && `${wo.address}, `}{wo.city} {wo.state}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {wo.assigned_user ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center">
                            <span className="text-xs text-indigo-600">
                              {wo.assigned_user.full_name?.charAt(0) || '?'}
                            </span>
                          </div>
                          <span className="text-sm text-gray-900">{wo.assigned_user.full_name}</span>
                        </div>
                      ) : wo.assigned_sub ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-xs text-orange-600">S</span>
                          </div>
                          <span className="text-sm text-gray-900">{wo.assigned_sub.company_name}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {wo.scheduled_date 
                        ? new Date(wo.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/New_York' })
                        : <span className="text-gray-400">Not scheduled</span>
                      }
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[wo.status]}`}>
                        {wo.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/work-orders/${wo.id}`}
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
