'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClientBrowser } from '@/lib/supabase/client'

interface WorkOrderPhoto {
  id: string
  photo_type: string
  storage_path: string
}

interface WorkOrder {
  id: string
  work_order_number: string
  title: string
  work_order_type: string
  status: string
  priority: string
  scheduled_date: string | null
  created_at: string
  sub_completion_notes: string | null
  completed_at: string | null
  assigned_user?: { full_name: string } | { full_name: string }[] | null
  assigned_sub?: { company_name: string } | { company_name: string }[] | null
  completed_by_sub?: { company_name: string } | { company_name: string }[] | null
  photos?: WorkOrderPhoto[]
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

  const loadWorkOrders = useCallback(async () => {
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
          sub_completion_notes,
          completed_at,
          assigned_user:users!work_orders_assigned_user_id_fkey(full_name),
          assigned_sub:sub_contractors!work_orders_assigned_sub_id_fkey(company_name),
          completed_by_sub:sub_contractors!work_orders_completed_by_sub_id_fkey(company_name)
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

      // Load photos for completed work orders
      const completedIds = (data || []).filter(wo => wo.status === 'completed').map(wo => wo.id)
      let photosMap: Record<string, WorkOrderPhoto[]> = {}
      
      if (completedIds.length > 0) {
        const { data: photos } = await supabase
          .from('work_order_photos')
          .select('id, work_order_id, photo_type, storage_path')
          .in('work_order_id', completedIds)
        
        if (photos) {
          photos.forEach(photo => {
            if (!photosMap[photo.work_order_id]) {
              photosMap[photo.work_order_id] = []
            }
            photosMap[photo.work_order_id].push(photo)
          })
        }
      }

      // Attach photos to work orders
      const workOrdersWithPhotos = (data || []).map(wo => ({
        ...wo,
        photos: photosMap[wo.id] || []
      }))

      setWorkOrders(workOrdersWithPhotos)
    } catch (err) {
      console.error('Error loading work orders:', err)
    } finally {
      setLoading(false)
    }
  }, [jobId, projectId])

  useEffect(() => {
    loadWorkOrders()
  }, [loadWorkOrders])

  const openWorkOrders = workOrders.filter(wo => !['completed', 'cancelled'].includes(wo.status))
  const completedWorkOrders = workOrders.filter(wo => wo.status === 'completed')
  const [showCompleted, setShowCompleted] = useState(false)
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  const getCompletedByName = (wo: WorkOrder): string | null => {
    if (wo.completed_by_sub) {
      if (Array.isArray(wo.completed_by_sub)) {
        return wo.completed_by_sub[0]?.company_name || null
      }
      return wo.completed_by_sub.company_name
    }
    return null
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">Work Orders</h2>
        <Link
          href={`/work-orders/new?job_id=${jobId}${projectId ? `&project_id=${projectId}` : ''}`}
          className="min-h-[44px] flex items-center text-sm text-indigo-600 hover:text-indigo-800 font-medium"
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
              className="block p-3 border rounded-lg hover:bg-gray-50 active:bg-gray-100 transition-colors min-h-[60px]"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">{wo.work_order_number}</span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[wo.status] || 'bg-gray-100 text-gray-600'}`}>
                      {wo.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 mt-1 break-words">{wo.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-gray-500">
                    <span>{typeLabels[wo.work_order_type] || wo.work_order_type}</span>
                    {wo.scheduled_date && (
                      <>
                        <span className="hidden sm:inline">•</span>
                        <span>{new Date(wo.scheduled_date + 'T12:00:00').toLocaleDateString()}</span>
                      </>
                    )}
                    {getAssigneeName(wo) && (
                      <>
                        <span className="hidden sm:inline">•</span>
                        <span className="truncate max-w-[120px]">{getAssigneeName(wo)}</span>
                      </>
                    )}
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
          
          {/* Completed Work Orders Section */}
          {completedWorkOrders.length > 0 && (
            <div className="pt-2 border-t">
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 min-h-[44px]"
              >
                <svg 
                  className={`w-4 h-4 transition-transform ${showCompleted ? 'rotate-90' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {completedWorkOrders.length} completed work order{completedWorkOrders.length !== 1 ? 's' : ''}
              </button>
              
              {showCompleted && (
                <div className="mt-3 space-y-4">
                  {completedWorkOrders.map(wo => {
                    const workDonePhotos = wo.photos?.filter(p => p.photo_type === 'work_done') || []
                    const cleanupPhotos = wo.photos?.filter(p => p.photo_type === 'cleanup') || []
                    const completedByName = getCompletedByName(wo)
                    
                    return (
                      <div key={wo.id} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-gray-500">{wo.work_order_number}</span>
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">
                                Completed
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 mt-1">{wo.title}</p>
                          </div>
                          <Link
                            href={`/work-orders/${wo.id}`}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            View →
                          </Link>
                        </div>
                        
                        {completedByName && (
                          <p className="text-xs text-gray-600 mb-2">
                            Completed by: <span className="font-medium">{completedByName}</span>
                            {wo.completed_at && (
                              <span className="text-gray-400 ml-2">
                                {new Date(wo.completed_at).toLocaleDateString()}
                              </span>
                            )}
                          </p>
                        )}
                        
                        {/* Sub Completion Note */}
                        {wo.sub_completion_notes && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-gray-500 mb-1">Completion Note:</p>
                            <p className="text-sm text-gray-700 bg-white p-2 rounded border">
                              {wo.sub_completion_notes}
                            </p>
                          </div>
                        )}
                        
                        {/* Sub Completion Photos */}
                        {(workDonePhotos.length > 0 || cleanupPhotos.length > 0) && (
                          <div className="space-y-2">
                            {workDonePhotos.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  Work Done Photos ({workDonePhotos.length})
                                </p>
                                <div className="grid grid-cols-4 gap-1">
                                  {workDonePhotos.slice(0, 4).map(photo => (
                                    <a
                                      key={photo.id}
                                      href={`${supabaseUrl}/storage/v1/object/public/${photo.storage_path}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="aspect-square bg-gray-100 rounded overflow-hidden"
                                    >
                                      <Image
                                        src={`${supabaseUrl}/storage/v1/object/public/${photo.storage_path}`}
                                        alt="Work done"
                                        width={96}
                                        height={96}
                                        unoptimized
                                        className="w-full h-full object-cover"
                                      />
                                    </a>
                                  ))}
                                  {workDonePhotos.length > 4 && (
                                    <div className="aspect-square bg-gray-200 rounded flex items-center justify-center text-xs text-gray-600">
                                      +{workDonePhotos.length - 4}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {cleanupPhotos.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  Cleanup Photos ({cleanupPhotos.length})
                                </p>
                                <div className="grid grid-cols-4 gap-1">
                                  {cleanupPhotos.slice(0, 4).map(photo => (
                                    <a
                                      key={photo.id}
                                      href={`${supabaseUrl}/storage/v1/object/public/${photo.storage_path}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="aspect-square bg-gray-100 rounded overflow-hidden"
                                    >
                                      <Image
                                        src={`${supabaseUrl}/storage/v1/object/public/${photo.storage_path}`}
                                        alt="Cleanup"
                                        width={96}
                                        height={96}
                                        unoptimized
                                        className="w-full h-full object-cover"
                                      />
                                    </a>
                                  ))}
                                  {cleanupPhotos.length > 4 && (
                                    <div className="aspect-square bg-gray-200 rounded flex items-center justify-center text-xs text-gray-600">
                                      +{cleanupPhotos.length - 4}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
