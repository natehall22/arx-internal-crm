'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface WorkOrder {
  id: string
  work_order_number: string
  title: string
  work_order_type: string
  status: string
  priority: string
  scheduled_date: string | null
  created_at: string
  assigned_user?: { full_name: string } | { full_name: string }[] | null
  assigned_sub?: { company_name: string } | { company_name: string }[] | null
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

interface JobWorkOrdersCardProps {
  jobId: string
  projectId?: string
}

function getAssigneeName(wo: WorkOrder): string | null {
  if (wo.assigned_user) {
    if (Array.isArray(wo.assigned_user)) {
      return wo.assigned_user[0]?.full_name || null
    }
    return wo.assigned_user.full_name
  }
  if (wo.assigned_sub) {
    if (Array.isArray(wo.assigned_sub)) {
      return wo.assigned_sub[0]?.company_name || null
    }
    return wo.assigned_sub.company_name
  }
  return null
}

export default function JobWorkOrdersCard({ jobId, projectId }: JobWorkOrdersCardProps) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadWorkOrders()
  }, [jobId, projectId])

  const loadWorkOrders = async () => {
    try {
      const supabase = createClientBrowser()
      
      let query = supabase
        .from('work_orders')
        .select(`
          id,
          work_order_number,
          title,
          work_order_type,
          status,
          priority,
          scheduled_date,
          created_at,
          assigned_user:users!work_orders_assigned_user_id_fkey(full_name),
          assigned_sub:sub_contractors!work_orders_assigned_sub_id_fkey(company_name)
        `)
        .order('created_at', { ascending: false })

      // Prefer job_id, fallback to project_id for backwards compatibility
      if (jobId) {
        query = query.or(`job_id.eq.${jobId}${projectId ? `,project_id.eq.${projectId}` : ''}`)
      } else if (projectId) {
        query = query.eq('project_id', projectId)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error loading work orders:', error)
        return
      }

      setWorkOrders(data || [])
    } catch (err) {
      console.error('Error loading work orders:', err)
    } finally {
      setLoading(false)
    }
  }

  const openWorkOrders = workOrders.filter(wo => !['completed', 'cancelled'].includes(wo.status))
  const completedCount = workOrders.filter(wo => wo.status === 'completed').length

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Work Orders</h2>
        <Link
          href={`/work-orders/new?job_id=${jobId}${projectId ? `&project_id=${projectId}` : ''}`}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
        >
          + New Work Order
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : workOrders.length === 0 ? (
        <p className="text-sm text-gray-500">No work orders for this job</p>
      ) : (
        <div className="space-y-3">
          {openWorkOrders.map(wo => (
            <Link
              key={wo.id}
              href={`/work-orders/${wo.id}`}
              className="block p-3 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">{wo.work_order_number}</span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[wo.status] || 'bg-gray-100 text-gray-600'}`}>
                      {wo.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 mt-1 truncate">{wo.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <span>{typeLabels[wo.work_order_type] || wo.work_order_type}</span>
                    {wo.scheduled_date && (
                      <>
                        <span>•</span>
                        <span>{new Date(wo.scheduled_date + 'T12:00:00').toLocaleDateString()}</span>
                      </>
                    )}
                    {getAssigneeName(wo) && (
                      <>
                        <span>•</span>
                        <span>{getAssigneeName(wo)}</span>
                      </>
                    )}
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
          
          {completedCount > 0 && (
            <p className="text-xs text-gray-500 pt-2 border-t">
              + {completedCount} completed work order{completedCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
