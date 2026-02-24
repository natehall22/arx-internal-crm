'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface Customer {
  id: string
  name: string
  address_text: string
}

interface Project {
  id: string
  address_text: string
  customer_id: string
  customers?: any
}

interface User {
  id: string
  full_name: string
  role: string
}

interface SubContractor {
  id: string
  company_name: string
  contact_name: string
  services: string[]
}

export default function NewWorkOrderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [subs, setSubs] = useState<SubContractor[]>([])
  const [orgId, setOrgId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')

  const [formData, setFormData] = useState({
    work_order_type: 'go_back',
    priority: 'normal',
    title: '',
    description: '',
    scope_of_work: '',
    customer_id: '',
    project_id: '',
    assignee_type: 'none', // 'none', 'user', 'sub'
    assigned_user_id: '',
    assigned_sub_id: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    scheduled_date: '',
    estimated_hours: '',
    materials: [] as { name: string; quantity: string; unit: string }[],
  })

  const supabase = createClientBrowser()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    // First try to get session - this handles cookie restoration
    const { data: { session } } = await supabase.auth.getSession()
    let currentUserId = session?.user?.id
    
    if (!currentUserId) {
      // Double-check with getUser as fallback
      const { data: { user: fallbackUser } } = await supabase.auth.getUser()
      currentUserId = fallbackUser?.id
    }
    
    if (!currentUserId) {
      router.push('/login?next=/work-orders/new')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', currentUserId)
      .single()

    if (!profile) return

    setOrgId(profile.org_id)
    setUserId(currentUserId)

    // Load customers, projects, users, and subs in parallel
    const [customersRes, projectsRes, usersRes, subsRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, name, address_text')
        .eq('org_id', profile.org_id)
        .order('name'),
      supabase
        .from('projects')
        .select('id, address_text, customer_id, customers(name)')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .in('role', ['operations', 'admin', 'regional_manager', 'sales_manager'])
        .order('full_name'),
      supabase
        .from('sub_contractors')
        .select('id, company_name, contact_name, services')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('company_name'),
    ])

    setCustomers(customersRes.data || [])
    setProjects(projectsRes.data || [])
    setUsers(usersRes.data || [])
    setSubs(subsRes.data || [])

    // Pre-fill from query params
    const customerId = searchParams.get('customer') || searchParams.get('customer_id')
    const projectId = searchParams.get('project') || searchParams.get('project_id')
    const addressParam = searchParams.get('address')

    if (projectId) {
      const project = projectsRes.data?.find(p => p.id === projectId)
      if (project) {
        const addressText = project.address_text || addressParam || ''
        const parts = addressText.split(',')
        setFormData(prev => ({
          ...prev,
          project_id: projectId,
          customer_id: project.customer_id || customerId || '',
          address: parts[0]?.trim() || '',
          city: parts[1]?.trim() || '',
          state: parts[2]?.trim().split(' ')[0] || '',
          zip: parts[2]?.trim().split(' ')[1] || '',
        }))
      }
    } else if (customerId) {
      const customer = customersRes.data?.find(c => c.id === customerId)
      if (customer) {
        const addressText = customer.address_text || addressParam || ''
        const parts = addressText.split(',')
        setFormData(prev => ({
          ...prev,
          customer_id: customerId,
          address: parts[0]?.trim() || '',
          city: parts[1]?.trim() || '',
          state: parts[2]?.trim().split(' ')[0] || '',
          zip: parts[2]?.trim().split(' ')[1] || '',
        }))
      }
    } else if (addressParam) {
      const parts = addressParam.split(',')
      setFormData(prev => ({
        ...prev,
        address: parts[0]?.trim() || '',
        city: parts[1]?.trim() || '',
        state: parts[2]?.trim().split(' ')[0] || '',
        zip: parts[2]?.trim().split(' ')[1] || '',
      }))
    }

    setLoading(false)
  }

  const handleCustomerChange = (customerId: string) => {
    setFormData(prev => ({ ...prev, customer_id: customerId, project_id: '' }))
    
    const customer = customers.find(c => c.id === customerId)
    if (customer?.address_text) {
      const parts = customer.address_text.split(',')
      setFormData(prev => ({
        ...prev,
        customer_id: customerId,
        address: parts[0]?.trim() || '',
        city: parts[1]?.trim() || '',
        state: parts[2]?.trim().split(' ')[0] || '',
        zip: parts[2]?.trim().split(' ')[1] || '',
      }))
    }
  }

  const handleProjectChange = (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      setFormData(prev => ({
        ...prev,
        project_id: projectId,
        customer_id: project.customer_id || prev.customer_id,
      }))
      
      if (project.address_text) {
        const parts = project.address_text.split(',')
        setFormData(prev => ({
          ...prev,
          address: parts[0]?.trim() || '',
          city: parts[1]?.trim() || '',
          state: parts[2]?.trim().split(' ')[0] || '',
          zip: parts[2]?.trim().split(' ')[1] || '',
        }))
      }
    }
  }

  const addMaterial = () => {
    setFormData(prev => ({
      ...prev,
      materials: [...prev.materials, { name: '', quantity: '', unit: 'each' }],
    }))
  }

  const updateMaterial = (index: number, field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      materials: prev.materials.map((m, i) => 
        i === index ? { ...m, [field]: value } : m
      ),
    }))
  }

  const removeMaterial = (index: number) => {
    setFormData(prev => ({
      ...prev,
      materials: prev.materials.filter((_, i) => i !== index),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title) {
      alert('Please enter a title')
      return
    }

    setSaving(true)

    try {
      const workOrderData: any = {
        org_id: orgId,
        created_by: userId,
        work_order_type: formData.work_order_type,
        priority: formData.priority,
        title: formData.title,
        description: formData.description || null,
        scope_of_work: formData.scope_of_work || null,
        customer_id: formData.customer_id || null,
        project_id: formData.project_id || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        scheduled_date: formData.scheduled_date || null,
        estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
        materials: formData.materials.filter(m => m.name),
        status: 'pending',
      }

      // Set assignee
      if (formData.assignee_type === 'user' && formData.assigned_user_id) {
        workOrderData.assigned_user_id = formData.assigned_user_id
        workOrderData.status = 'assigned'
      } else if (formData.assignee_type === 'sub' && formData.assigned_sub_id) {
        workOrderData.assigned_sub_id = formData.assigned_sub_id
        workOrderData.status = 'assigned'
      }

      const { data: workOrder, error } = await supabase
        .from('work_orders')
        .insert(workOrderData)
        .select()
        .single()

      if (error) throw error

      // Create notification for operations users if assigned
      if (workOrderData.assigned_user_id) {
        await supabase.from('notifications').insert({
          org_id: orgId,
          user_id: workOrderData.assigned_user_id,
          type: 'work_order_assigned',
          title: 'New Work Order Assigned',
          body: `You have been assigned work order ${workOrder.work_order_number}: ${formData.title}`,
          data: { work_order_id: workOrder.id },
        })
      }

      // Notify all operations users about new go-back
      if (formData.work_order_type === 'go_back') {
        const { data: opsUsers } = await supabase
          .from('users')
          .select('id')
          .eq('org_id', orgId)
          .eq('role', 'operations')
          .eq('active', true)

        if (opsUsers && opsUsers.length > 0) {
          const notifications = opsUsers
            .filter(u => u.id !== workOrderData.assigned_user_id) // Don't double-notify
            .map(u => ({
              org_id: orgId,
              user_id: u.id,
              type: 'go_back_created',
              title: 'New Go-Back Created',
              body: `A new go-back work order has been created: ${formData.title}`,
              data: { work_order_id: workOrder.id },
            }))

          if (notifications.length > 0) {
            await supabase.from('notifications').insert(notifications)
          }
        }
      }

      router.push(`/work-orders/${workOrder.id}`)
    } catch (error) {
      console.error('Error creating work order:', error)
      alert('Failed to create work order')
    } finally {
      setSaving(false)
    }
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
      
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/work-orders" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Work Orders
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-6 border-b">
            <h1 className="text-2xl font-bold text-gray-900">New Work Order</h1>
            <p className="text-gray-500 mt-1">Create a go-back, repair, or service work order</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Type and Priority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Type *</label>
                <select
                  value={formData.work_order_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, work_order_type: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="go_back">Go Back</option>
                  <option value="repair">Repair</option>
                  <option value="warranty">Warranty</option>
                  <option value="punch_list">Punch List</option>
                  <option value="inspection">Inspection</option>
                  <option value="install">Install</option>
                  <option value="service_call">Service Call</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="Brief description of the work needed"
                required
              />
            </div>

            {/* Customer and Project */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer</label>
                <select
                  value={formData.customer_id}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select customer...</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Related Project</label>
                <select
                  value={formData.project_id}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select project...</option>
                  {projects
                    .filter(p => !formData.customer_id || p.customer_id === formData.customer_id)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.customers?.name ? `${p.customers.name} - ` : ''}{p.address_text}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Address */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="Street address"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Zip</label>
                  <input
                    type="text"
                    value={formData.zip}
                    onChange={(e) => setFormData(prev => ({ ...prev, zip: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Assignment */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Assignment</h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="assignee_type"
                      value="none"
                      checked={formData.assignee_type === 'none'}
                      onChange={(e) => setFormData(prev => ({ ...prev, assignee_type: e.target.value }))}
                    />
                    <span className="text-sm text-gray-700">Unassigned</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="assignee_type"
                      value="user"
                      checked={formData.assignee_type === 'user'}
                      onChange={(e) => setFormData(prev => ({ ...prev, assignee_type: e.target.value }))}
                    />
                    <span className="text-sm text-gray-700">In-House Employee</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="assignee_type"
                      value="sub"
                      checked={formData.assignee_type === 'sub'}
                      onChange={(e) => setFormData(prev => ({ ...prev, assignee_type: e.target.value }))}
                    />
                    <span className="text-sm text-gray-700">Sub-Contractor</span>
                  </label>
                </div>

                {formData.assignee_type === 'user' && (
                  <select
                    value={formData.assigned_user_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, assigned_user_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select employee...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} ({u.role})
                      </option>
                    ))}
                  </select>
                )}

                {formData.assignee_type === 'sub' && (
                  <select
                    value={formData.assigned_sub_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, assigned_sub_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select sub-contractor...</option>
                    {subs.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.company_name} {s.contact_name ? `(${s.contact_name})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Description and Scope */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Detailed description of the issue or work needed..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Scope of Work</label>
                  <textarea
                    value={formData.scope_of_work}
                    onChange={(e) => setFormData(prev => ({ ...prev, scope_of_work: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Specific tasks to be completed..."
                  />
                </div>
              </div>
            </div>

            {/* Scheduling */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Scheduling</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Scheduled Date</label>
                  <input
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.estimated_hours}
                    onChange={(e) => setFormData(prev => ({ ...prev, estimated_hours: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="e.g., 2.5"
                  />
                </div>
              </div>
            </div>

            {/* Materials */}
            <div className="border-t pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Materials Needed</h3>
                <button
                  type="button"
                  onClick={addMaterial}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  + Add Material
                </button>
              </div>
              {formData.materials.length === 0 ? (
                <p className="text-sm text-gray-500">No materials added</p>
              ) : (
                <div className="space-y-2">
                  {formData.materials.map((material, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={material.name}
                        onChange={(e) => updateMaterial(index, 'name', e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="Material name"
                      />
                      <input
                        type="number"
                        value={material.quantity}
                        onChange={(e) => updateMaterial(index, 'quantity', e.target.value)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="Qty"
                      />
                      <select
                        value={material.unit}
                        onChange={(e) => updateMaterial(index, 'unit', e.target.value)}
                        className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="each">Each</option>
                        <option value="sqft">Sq Ft</option>
                        <option value="lf">Linear Ft</option>
                        <option value="bundle">Bundle</option>
                        <option value="box">Box</option>
                        <option value="roll">Roll</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeMaterial(index)}
                        className="p-2 text-red-500 hover:text-red-700"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="border-t pt-6 flex justify-end gap-4">
              <Link
                href="/work-orders"
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Work Order'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
