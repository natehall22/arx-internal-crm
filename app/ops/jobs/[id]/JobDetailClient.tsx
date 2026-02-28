'use client'

import { useState } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
import ScheduleJobModal from '@/components/ops/ScheduleJobModal'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected' | 'on_hold'

interface Job {
  id: string
  project_id: string
  job_number: string
  status: JobStatus
  job_type: string
  address_text: string
  sale_amount: number | null
  sale_date: string | null
  materials_status: string
  materials_ordered_at: string | null
  materials_eta: string | null
  materials_notes: string | null
  scheduled_date: string | null
  scheduled_time_start: string | null
  estimated_duration_hours: number | null
  permit_required: boolean
  permit_status: string
  permit_number: string | null
  started_at: string | null
  completed_at: string | null
  completion_notes: string | null
  priority: string
  internal_notes: string | null
  labor_cost: number | null
  material_cost: number | null
  before_photos: string[]
  progress_photos: string[]
  after_photos: string[]
  created_at: string
  assigned_crew?: { id: string; name: string; color: string; phone: string } | null
  assigned_sub?: { id: string; company_name: string; contact_name: string; phone: string } | null
  customer?: { id: string; name: string; phone: string; email: string } | null
  salesperson?: { id: string; full_name: string } | null
  project?: { id: string; scope_of_work: string; product_summary: string; ops_notes: string } | null
}

interface Crew {
  id: string
  name: string
  crew_type: string
  color: string
  daily_capacity: number
}

interface SubContractor {
  id: string
  company_name: string
  services: string[]
}

const statusConfig: Record<JobStatus, { label: string; color: string; bgColor: string }> = {
  sold: { label: 'Sold', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  materials: { label: 'Materials', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  scheduled: { label: 'Scheduled', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  in_progress: { label: 'In Progress', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  complete: { label: 'Complete', color: 'text-green-700', bgColor: 'bg-green-100' },
  collected: { label: 'Collected', color: 'text-gray-700', bgColor: 'bg-gray-100' },
  on_hold: { label: 'On Hold', color: 'text-orange-700', bgColor: 'bg-orange-100' },
}

const materialsConfig: Record<string, { label: string; color: string }> = {
  not_ordered: { label: 'Not Ordered', color: 'text-gray-500' },
  ordered: { label: 'Ordered', color: 'text-blue-600' },
  partial: { label: 'Partial', color: 'text-amber-600' },
  received: { label: 'Received', color: 'text-green-600' },
}

interface JobDetailClientProps {
  initialJob: Job
  crews: Crew[]
  subs: SubContractor[]
}

export default function JobDetailClient({ initialJob, crews, subs }: JobDetailClientProps) {
  const [job, setJob] = useState<Job>(initialJob)
  const [saving, setSaving] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(initialJob.internal_notes || '')

  const supabase = createClientBrowser()

  const reloadJob = async () => {
    const { data } = await supabase
      .from('production_jobs')
      .select(`
        *,
        assigned_crew:crews(id, name, color, phone),
        assigned_sub:sub_contractors(id, company_name, contact_name, phone),
        customer:customers(id, name, phone, email),
        salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
        project:projects(id, scope_of_work, product_summary, ops_notes, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
      `)
      .eq('id', job.id)
      .single()

    if (data) {
      const rawProject = Array.isArray(data.project) ? data.project[0] : data.project
      const rawCustomer = Array.isArray(data.customer) ? data.customer[0] : data.customer
      
      // Try to get customer from: 1) direct customer link, 2) project's customer, 3) project's lead
      let customer = rawCustomer
      if (!customer && rawProject) {
        const projectCustomer = Array.isArray(rawProject.customers) ? rawProject.customers[0] : rawProject.customers
        const projectLead = Array.isArray(rawProject.leads) ? rawProject.leads[0] : rawProject.leads
        
        if (projectCustomer) {
          customer = projectCustomer
        } else if (projectLead) {
          customer = {
            id: projectLead.id,
            name: projectLead.homeowner_name,
            phone: projectLead.phone,
            email: projectLead.email,
          }
        }
      }

      const transformedJob = {
        ...data,
        assigned_crew: Array.isArray(data.assigned_crew) ? data.assigned_crew[0] : data.assigned_crew,
        assigned_sub: Array.isArray(data.assigned_sub) ? data.assigned_sub[0] : data.assigned_sub,
        customer: customer,
        salesperson: Array.isArray(data.salesperson) ? data.salesperson[0] : data.salesperson,
        project: rawProject,
      }
      setJob(transformedJob)
      setNotesValue(data.internal_notes || '')
    }
  }

  const updateStatus = async (newStatus: JobStatus) => {
    setSaving(true)

    const updates: any = { status: newStatus }
    if (newStatus === 'in_progress' && !job.started_at) {
      updates.started_at = new Date().toISOString()
    } else if (newStatus === 'complete' && !job.completed_at) {
      updates.completed_at = new Date().toISOString()
    }

    await supabase
      .from('production_jobs')
      .update(updates)
      .eq('id', job.id)

    await reloadJob()
    setSaving(false)
  }

  const updateMaterialsStatus = async (newStatus: string) => {
    setSaving(true)

    const updates: any = { materials_status: newStatus }
    if (newStatus === 'ordered' && !job.materials_ordered_at) {
      updates.materials_ordered_at = new Date().toISOString()
    }

    await supabase
      .from('production_jobs')
      .update(updates)
      .eq('id', job.id)

    await reloadJob()
    setSaving(false)
  }

  const saveNotes = async () => {
    setSaving(true)

    await supabase
      .from('production_jobs')
      .update({ internal_notes: notesValue })
      .eq('id', job.id)

    setEditingNotes(false)
    await reloadJob()
    setSaving(false)
  }

  const status = statusConfig[job.status] || statusConfig.sold
  const materials = materialsConfig[job.materials_status] || materialsConfig.not_ordered

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Link href="/ops" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Production Board
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-mono text-gray-500">{job.job_number}</span>
                    <span className={`px-3 py-1 text-sm font-medium rounded-full ${status.bgColor} ${status.color}`}>
                      {status.label}
                    </span>
                    {job.priority !== 'normal' && (
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        job.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {job.priority}
                      </span>
                    )}
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {job.customer?.name || 'Customer'}
                  </h1>
                  <p className="text-gray-500 mt-1">{job.address_text}</p>
                </div>
                <span className={`text-sm px-3 py-1 rounded-full ${
                  job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
                  job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
                  job.job_type === 'windows' ? 'bg-purple-100 text-purple-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {job.job_type}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 pt-4 border-t">
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                >
                  {job.scheduled_date ? 'Reschedule' : 'Schedule Job'}
                </button>
                {job.status === 'sold' && (
                  <button
                    onClick={() => updateStatus('materials')}
                    disabled={saving}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                  >
                    Move to Materials
                  </button>
                )}
                {job.status === 'materials' && job.materials_status === 'received' && (
                  <button
                    onClick={() => updateStatus('scheduled')}
                    disabled={saving}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                  >
                    Ready to Schedule
                  </button>
                )}
                {job.status === 'scheduled' && (
                  <button
                    onClick={() => updateStatus('in_progress')}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    Start Job
                  </button>
                )}
                {job.status === 'in_progress' && (
                  <button
                    onClick={() => updateStatus('complete')}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    Mark Complete
                  </button>
                )}
                {job.status === 'complete' && (
                  <button
                    onClick={() => updateStatus('collected')}
                    disabled={saving}
                    className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 text-sm"
                  >
                    Mark Collected
                  </button>
                )}
                {job.status !== 'on_hold' && job.status !== 'complete' && job.status !== 'collected' && (
                  <button
                    onClick={() => updateStatus('on_hold')}
                    disabled={saving}
                    className="px-4 py-2 border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50 text-sm"
                  >
                    Put On Hold
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Materials</h2>
                <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                  job.materials_status === 'received' ? 'bg-green-100 text-green-700' :
                  job.materials_status === 'ordered' ? 'bg-blue-100 text-blue-700' :
                  job.materials_status === 'partial' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {materials.label}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {['not_ordered', 'ordered', 'partial', 'received'].map(s => (
                  <button
                    key={s}
                    onClick={() => updateMaterialsStatus(s)}
                    disabled={saving || job.materials_status === s}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                      job.materials_status === s 
                        ? 'bg-indigo-600 text-white border-indigo-600' 
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {materialsConfig[s]?.label || s}
                  </button>
                ))}
              </div>

              {job.materials_ordered_at && (
                <p className="text-sm text-gray-500">
                  Ordered: {new Date(job.materials_ordered_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                </p>
              )}
              {job.materials_eta && (
                <p className="text-sm text-gray-500">
                  ETA: {new Date(job.materials_eta).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                </p>
              )}
              {job.materials_notes && (
                <p className="text-sm text-gray-700 mt-2 p-3 bg-gray-50 rounded-lg">
                  {job.materials_notes}
                </p>
              )}
            </div>

            {(job.project?.scope_of_work || job.project?.product_summary) && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Details</h2>
                {job.project?.product_summary && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Product</h3>
                    <p className="text-gray-900">{job.project.product_summary}</p>
                  </div>
                )}
                {job.project?.scope_of_work && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Scope of Work</h3>
                    <p className="text-gray-900 whitespace-pre-wrap">{job.project.scope_of_work}</p>
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Internal Notes</h2>
                {!editingNotes && (
                  <button
                    onClick={() => setEditingNotes(true)}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div>
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-3"
                    placeholder="Add internal notes..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveNotes}
                      disabled={saving}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingNotes(false); setNotesValue(job.internal_notes || ''); }}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className={`text-gray-${job.internal_notes ? '700' : '400'} whitespace-pre-wrap`}>
                  {job.internal_notes || 'No notes yet'}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule</h2>
              {job.scheduled_date ? (
                <div>
                  <div className="text-xl font-bold text-gray-900">
                    {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      timeZone: 'America/New_York',
                    })}
                  </div>
                  {job.scheduled_time_start && (
                    <p className="text-gray-500 mt-1">Start: {job.scheduled_time_start}</p>
                  )}
                  {job.estimated_duration_hours && (
                    <p className="text-gray-500">Duration: {job.estimated_duration_hours} hours</p>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500 mb-3">Not scheduled yet</p>
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                  >
                    Schedule Now
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Assignment</h2>
              {job.assigned_crew ? (
                <div className="flex items-center gap-3">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: job.assigned_crew.color }}
                  >
                    {job.assigned_crew.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{job.assigned_crew.name}</div>
                    <div className="text-sm text-gray-500">In-House Crew</div>
                    {job.assigned_crew.phone && (
                      <a href={`tel:${job.assigned_crew.phone}`} className="text-sm text-indigo-600">
                        {job.assigned_crew.phone}
                      </a>
                    )}
                  </div>
                </div>
              ) : job.assigned_sub ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                    <span className="text-orange-600 font-bold">S</span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{job.assigned_sub.company_name}</div>
                    <div className="text-sm text-gray-500">Sub-Contractor</div>
                    {job.assigned_sub.phone && (
                      <a href={`tel:${job.assigned_sub.phone}`} className="text-sm text-indigo-600">
                        {job.assigned_sub.phone}
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500 mb-3">Not assigned</p>
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Assign crew or sub →
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Customer</h2>
              {job.customer ? (
                <div>
                  <div className="font-medium text-gray-900 mb-2">{job.customer.name}</div>
                  {job.customer.phone && (
                    <a href={`tel:${job.customer.phone}`} className="block text-sm text-indigo-600 mb-1">
                      📞 {job.customer.phone}
                    </a>
                  )}
                  {job.customer.email && (
                    <a href={`mailto:${job.customer.email}`} className="block text-sm text-indigo-600">
                      ✉️ {job.customer.email}
                    </a>
                  )}
                  <Link
                    href={`/customers/${job.customer.id}`}
                    className="block text-sm text-gray-500 hover:text-gray-700 mt-3"
                  >
                    View customer →
                  </Link>
                </div>
              ) : (
                <p className="text-gray-500">No customer linked</p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Financials</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Sale Amount</span>
                  <span className="font-medium text-gray-900">
                    {job.sale_amount ? `$${job.sale_amount.toLocaleString()}` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Labor Cost</span>
                  <span className="font-medium text-gray-900">
                    {job.labor_cost ? `$${job.labor_cost.toLocaleString()}` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Material Cost</span>
                  <span className="font-medium text-gray-900">
                    {job.material_cost ? `$${job.material_cost.toLocaleString()}` : '-'}
                  </span>
                </div>
                {job.sale_amount && (job.labor_cost || job.material_cost) && (
                  <div className="border-t pt-3 flex justify-between">
                    <span className="text-gray-500">Gross Profit</span>
                    <span className="font-bold text-green-600">
                      ${(job.sale_amount - (job.labor_cost || 0) - (job.material_cost || 0)).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {job.permit_required && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Permit</h2>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    job.permit_status === 'approved' ? 'bg-green-100 text-green-700' :
                    job.permit_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                    job.permit_status === 'denied' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {job.permit_status === 'not_needed' ? 'Not Needed' : job.permit_status}
                  </span>
                </div>
                {job.permit_number && (
                  <p className="text-sm text-gray-600">Permit #: {job.permit_number}</p>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Related</h2>
              <div className="space-y-2">
                {job.project_id && (
                  <Link
                    href={`/projects/${job.project_id}`}
                    className="block text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    View Project →
                  </Link>
                )}
                {job.salesperson && (
                  <p className="text-sm text-gray-500">
                    Sold by: {job.salesperson.full_name}
                  </p>
                )}
                {job.sale_date && (
                  <p className="text-sm text-gray-500">
                    Sale date: {new Date(job.sale_date + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showScheduleModal && job && (
        <ScheduleJobModal
          job={{
            id: job.id,
            job_number: job.job_number,
            address_text: job.address_text,
            job_type: job.job_type,
            scheduled_date: job.scheduled_date,
            assigned_crew_id: job.assigned_crew?.id || null,
            assigned_sub_id: job.assigned_sub?.id || null,
            customer: job.customer,
          }}
          crews={crews}
          subs={subs}
          onClose={() => setShowScheduleModal(false)}
          onSave={() => { setShowScheduleModal(false); reloadJob(); }}
        />
      )}
    </div>
  )
}
