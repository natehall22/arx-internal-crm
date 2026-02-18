'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface VolumeTier {
  min_volume: number
  max_volume: number | null
  bonus_type: 'percentage' | 'flat'  // percentage adds to base rate, flat is dollar amount
  bonus_value: number
}

interface OverrideTier {
  min_team_volume: number
  max_team_volume: number | null
  override_type: 'percentage' | 'flat'  // percentage of team sales or flat amount
  override_value: number
}

interface CompPlan {
  id: string
  name: string
  description: string | null
  plan_type: 'flat_rate' | 'percentage' | 'tiered' | 'hybrid'
  is_active: boolean
  is_default: boolean
  flat_amount: number | null
  base_percentage: number | null
  tiers: { min: number; max: number | null; rate: number }[] | null
  bonuses: { type: string; target: number; bonus: number }[] | null
  volume_bonuses: VolumeTier[] | null  // Sliding scale volume bonuses
  // Manager-specific fields
  is_manager_plan: boolean
  personal_sales_enabled: boolean  // Manager can earn from their own sales
  team_override_enabled: boolean   // Manager earns override from team sales
  team_overrides: OverrideTier[] | null  // Sliding scale team overrides
  applicable_roles: string[]
  created_at: string
}

interface UserCompPlan {
  id: string
  user_id: string
  comp_plan_id: string
  effective_from: string
  effective_to: string | null
  override_percentage: number | null
  users?: { full_name: string; role: string }
  comp_plans?: { name: string }
}

const planTypeLabels = {
  flat_rate: 'Flat Rate',
  percentage: 'Percentage',
  tiered: 'Tiered',
  hybrid: 'Hybrid',
}

export default function CompPlansPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [compPlans, setCompPlans] = useState<CompPlan[]>([])
  const [userAssignments, setUserAssignments] = useState<UserCompPlan[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'plans' | 'assignments'>('plans')
  
  // Modal states
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState<CompPlan | null>(null)
  
  // Form state
  const [planForm, setPlanForm] = useState({
    name: '',
    description: '',
    plan_type: 'percentage' as CompPlan['plan_type'],
    flat_amount: '',
    base_percentage: '',
    tiers: [{ min: 0, max: 10000 as number | null, rate: 5 }],
    volume_bonuses: [] as VolumeTier[],
    // Manager-specific fields
    is_manager_plan: false,
    personal_sales_enabled: true,
    team_override_enabled: false,
    team_overrides: [] as OverrideTier[],
    applicable_roles: ['sales_rep', 'canvasser'],
    is_active: true,
    is_default: false,
    readme: '', // Custom readme/explanation for the plan
  })
  
  const [assignForm, setAssignForm] = useState({
    user_id: '',
    comp_plan_id: '',
    effective_from: new Date().toISOString().split('T')[0],
    override_percentage: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const response = await fetch('/api/admin/data?resource=comp_plans')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        console.error('Failed to load comp plans')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setCompPlans(data.compPlans || [])
      setUserAssignments(data.userAssignments || [])
      setUsers(data.users || [])
    } catch (error) {
      console.error('Error loading comp plans:', error)
    }
    setLoading(false)
  }
  
  const savePlan = async () => {
    const planData = {
      resource: editingPlan ? 'comp_plan' : 'comp_plan',
      id: editingPlan?.id,
      name: planForm.name,
      description: planForm.description || null,
      plan_type: planForm.plan_type,
      flat_amount: planForm.plan_type === 'flat_rate' ? parseFloat(planForm.flat_amount) || null : null,
      base_percentage: ['percentage', 'tiered', 'hybrid'].includes(planForm.plan_type) 
        ? parseFloat(planForm.base_percentage) || null 
        : null,
      tiers: planForm.plan_type === 'tiered' ? planForm.tiers : null,
      volume_bonuses: planForm.volume_bonuses.length > 0 ? planForm.volume_bonuses : null,
      is_manager_plan: planForm.is_manager_plan,
      personal_sales_enabled: planForm.is_manager_plan ? planForm.personal_sales_enabled : null,
      team_override_enabled: planForm.is_manager_plan ? planForm.team_override_enabled : null,
      team_overrides: planForm.is_manager_plan && planForm.team_override_enabled && planForm.team_overrides.length > 0 
        ? planForm.team_overrides 
        : null,
      applicable_roles: planForm.applicable_roles,
      is_active: planForm.is_active,
      is_default: planForm.is_default,
      readme: planForm.readme || null,
    }

    try {
      const response = await fetch('/api/admin/data', {
        method: editingPlan ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planData),
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to save comp plan')
        return
      }

      setShowPlanModal(false)
      setEditingPlan(null)
      resetPlanForm()
      loadData()
    } catch (error) {
      console.error('Error saving comp plan:', error)
      alert('Failed to save comp plan')
    }
  }

  const saveAssignment = async () => {
    try {
      const response = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'user_comp_plan',
          user_id: assignForm.user_id,
          comp_plan_id: assignForm.comp_plan_id,
          effective_from: assignForm.effective_from,
          override_percentage: assignForm.override_percentage ? parseFloat(assignForm.override_percentage) : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to assign comp plan')
        return
      }

      setShowAssignModal(false)
      setAssignForm({
        user_id: '',
        comp_plan_id: '',
        effective_from: new Date().toISOString().split('T')[0],
        override_percentage: '',
      })
      loadData()
    } catch (error) {
      console.error('Error assigning comp plan:', error)
      alert('Failed to assign comp plan')
    }
  }

  const deletePlan = async (id: string) => {
    if (!confirm('Delete this comp plan?')) return
    try {
      const response = await fetch(`/api/admin/data?resource=comp_plan&id=${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to delete comp plan')
        return
      }
      loadData()
    } catch (error) {
      console.error('Error deleting comp plan:', error)
    }
  }

  const deleteAssignment = async (id: string) => {
    if (!confirm('Remove this assignment?')) return
    try {
      const response = await fetch(`/api/admin/data?resource=user_comp_plan&id=${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to remove assignment')
        return
      }
      loadData()
    } catch (error) {
      console.error('Error removing assignment:', error)
    }
  }

  const resetPlanForm = () => {
    setPlanForm({
      name: '',
      description: '',
      plan_type: 'percentage',
      flat_amount: '',
      base_percentage: '',
      tiers: [{ min: 0, max: 10000 as number | null, rate: 5 }],
      volume_bonuses: [],
      is_manager_plan: false,
      personal_sales_enabled: true,
      team_override_enabled: false,
      team_overrides: [],
      applicable_roles: ['sales_rep', 'canvasser'],
      is_active: true,
      is_default: false,
      readme: '',
    })
  }

  const openEditPlan = (plan: CompPlan) => {
    setEditingPlan(plan)
    setPlanForm({
      name: plan.name,
      description: plan.description || '',
      plan_type: plan.plan_type,
      flat_amount: plan.flat_amount?.toString() || '',
      base_percentage: plan.base_percentage?.toString() || '',
      tiers: plan.tiers || [{ min: 0, max: 10000, rate: 5 }],
      volume_bonuses: plan.volume_bonuses || [],
      is_manager_plan: plan.is_manager_plan || false,
      personal_sales_enabled: plan.personal_sales_enabled ?? true,
      team_override_enabled: plan.team_override_enabled || false,
      team_overrides: plan.team_overrides || [],
      applicable_roles: plan.applicable_roles || ['sales_rep', 'canvasser'],
      is_active: plan.is_active,
      is_default: plan.is_default,
      readme: (plan as any).readme || '',
    })
    setShowPlanModal(true)
  }

  const addTier = () => {
    const lastTier = planForm.tiers[planForm.tiers.length - 1]
    setPlanForm(prev => ({
      ...prev,
      tiers: [...prev.tiers, { min: (lastTier.max || 0) + 1, max: (lastTier.max || 0) + 10000, rate: lastTier.rate + 1 }]
    }))
  }

  const removeTier = (index: number) => {
    if (planForm.tiers.length <= 1) return
    setPlanForm(prev => ({
      ...prev,
      tiers: prev.tiers.filter((_, i) => i !== index)
    }))
  }

  const updateTier = (index: number, field: string, value: string) => {
    setPlanForm(prev => ({
      ...prev,
      tiers: prev.tiers.map((tier, i) => 
        i === index ? { ...tier, [field]: field === 'max' && value === '' ? null : parseFloat(value) || 0 } : tier
      )
    }))
  }

  // Volume bonus functions
  const addVolumeBonus = () => {
    const lastBonus = planForm.volume_bonuses[planForm.volume_bonuses.length - 1]
    const newMin = lastBonus ? (lastBonus.max_volume || 0) + 1 : 0
    setPlanForm(prev => ({
      ...prev,
      volume_bonuses: [...prev.volume_bonuses, { 
        min_volume: newMin, 
        max_volume: newMin + 50000, 
        bonus_type: 'percentage',
        bonus_value: 1 
      }]
    }))
  }

  const removeVolumeBonus = (index: number) => {
    setPlanForm(prev => ({
      ...prev,
      volume_bonuses: prev.volume_bonuses.filter((_, i) => i !== index)
    }))
  }

  const updateVolumeBonus = (index: number, field: string, value: string | number) => {
    setPlanForm(prev => ({
      ...prev,
      volume_bonuses: prev.volume_bonuses.map((bonus, i) => {
        if (i !== index) return bonus
        if (field === 'max_volume' && value === '') {
          return { ...bonus, [field]: null }
        }
        if (field === 'bonus_type') {
          return { ...bonus, [field]: value as 'percentage' | 'flat' }
        }
        return { ...bonus, [field]: parseFloat(value as string) || 0 }
      })
    }))
  }

  // Team override functions (for manager plans)
  const addTeamOverride = () => {
    const lastOverride = planForm.team_overrides[planForm.team_overrides.length - 1]
    const newMin = lastOverride ? (lastOverride.max_team_volume || 0) + 1 : 0
    setPlanForm(prev => ({
      ...prev,
      team_overrides: [...prev.team_overrides, { 
        min_team_volume: newMin, 
        max_team_volume: newMin + 100000, 
        override_type: 'percentage',
        override_value: 1 
      }]
    }))
  }

  const removeTeamOverride = (index: number) => {
    setPlanForm(prev => ({
      ...prev,
      team_overrides: prev.team_overrides.filter((_, i) => i !== index)
    }))
  }

  const updateTeamOverride = (index: number, field: string, value: string | number) => {
    setPlanForm(prev => ({
      ...prev,
      team_overrides: prev.team_overrides.map((override, i) => {
        if (i !== index) return override
        if (field === 'max_team_volume' && value === '') {
          return { ...override, [field]: null }
        }
        if (field === 'override_type') {
          return { ...override, [field]: value as 'percentage' | 'flat' }
        }
        return { ...override, [field]: parseFloat(value as string) || 0 }
      })
    }))
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
        <div className="mb-6">
          <Link href="/admin" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Admin
          </Link>
        </div>

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Compensation Plans</h1>
            <p className="text-gray-500 mt-1">Manage commission structures and assignments</p>
          </div>
          <button
            onClick={() => {
              resetPlanForm()
              setEditingPlan(null)
              setShowPlanModal(true)
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            + New Comp Plan
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b">
          <button
            onClick={() => setActiveTab('plans')}
            className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px ${
              activeTab === 'plans'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Comp Plans ({compPlans.length})
          </button>
          <button
            onClick={() => setActiveTab('assignments')}
            className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px ${
              activeTab === 'assignments'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            User Assignments ({userAssignments.length})
          </button>
        </div>

        {/* Plans Tab */}
        {activeTab === 'plans' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {compPlans.map((plan) => (
              <div key={plan.id} className={`bg-white rounded-xl shadow-sm border p-6 ${!plan.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                      {plan.is_default && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Default</span>
                      )}
                      {plan.is_manager_plan && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">Manager</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${plan.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Type</span>
                    <span className="font-medium">{planTypeLabels[plan.plan_type]}</span>
                  </div>
                  
                  {plan.plan_type === 'flat_rate' && plan.flat_amount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Amount</span>
                      <span className="font-medium text-green-600">${plan.flat_amount}</span>
                    </div>
                  )}
                  
                  {plan.plan_type === 'percentage' && plan.base_percentage && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Rate</span>
                      <span className="font-medium text-green-600">{plan.base_percentage}%</span>
                    </div>
                  )}
                  
                  {plan.plan_type === 'tiered' && plan.tiers && (
                    <div className="text-sm">
                      <span className="text-gray-500">Tiers:</span>
                      <div className="mt-1 space-y-1">
                        {plan.tiers.map((tier, i) => (
                          <div key={i} className="text-xs bg-gray-50 px-2 py-1 rounded">
                            ${tier.min.toLocaleString()} - {tier.max ? `$${tier.max.toLocaleString()}` : '∞'}: <span className="font-medium text-green-600">{tier.rate}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.volume_bonuses && plan.volume_bonuses.length > 0 && (
                    <div className="text-sm">
                      <span className="text-gray-500">Volume Bonuses:</span>
                      <div className="mt-1 space-y-1">
                        {plan.volume_bonuses.map((vb, i) => (
                          <div key={i} className="text-xs bg-blue-50 px-2 py-1 rounded">
                            {vb.min_volume.toLocaleString()} - {vb.max_volume ? vb.max_volume.toLocaleString() : '∞'} accounts: 
                            <span className="font-medium text-blue-600 ml-1">
                              {vb.bonus_type === 'percentage' ? `+${vb.bonus_value}%` : `+$${vb.bonus_value}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Manager-specific info */}
                  {plan.is_manager_plan && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Personal Sales</span>
                        <span className={`font-medium ${plan.personal_sales_enabled ? 'text-green-600' : 'text-gray-400'}`}>
                          {plan.personal_sales_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Team Overrides</span>
                        <span className={`font-medium ${plan.team_override_enabled ? 'text-green-600' : 'text-gray-400'}`}>
                          {plan.team_override_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      {plan.team_override_enabled && plan.team_overrides && plan.team_overrides.length > 0 && (
                        <div className="text-sm">
                          <span className="text-gray-500">Override Tiers:</span>
                          <div className="mt-1 space-y-1">
                            {plan.team_overrides.map((to, i) => (
                              <div key={i} className="text-xs bg-purple-50 px-2 py-1 rounded">
                                Team {to.min_team_volume.toLocaleString()} - {to.max_team_volume ? to.max_team_volume.toLocaleString() : '∞'} accounts: 
                                <span className="font-medium text-purple-600 ml-1">
                                  {to.override_type === 'percentage' ? `${to.override_value}%` : `$${to.override_value}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Applies to</span>
                    <span className="font-medium">{plan.applicable_roles?.join(', ')}</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t">
                  <button
                    onClick={() => openEditPlan(plan)}
                    className="flex-1 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deletePlan(plan.id)}
                    className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {compPlans.length === 0 && (
              <div className="col-span-full text-center py-12 bg-white rounded-xl border">
                <p className="text-gray-500">No comp plans created yet</p>
                <button
                  onClick={() => setShowPlanModal(true)}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Create First Plan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Assignments Tab */}
        {activeTab === 'assignments' && (
          <div>
            <div className="mb-4 flex justify-end">
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm"
              >
                + Assign Plan to User
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Comp Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Effective From</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Override</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {userAssignments.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {assignment.users?.full_name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-sm capitalize">
                        {assignment.users?.role?.replace('_', ' ')}
                      </td>
                      <td className="px-6 py-4 text-gray-900">
                        {assignment.comp_plans?.name}
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-sm">
                        {new Date(assignment.effective_from).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-sm">
                        {assignment.override_percentage ? `${assignment.override_percentage}%` : '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteAssignment(assignment.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {userAssignments.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No user assignments yet
                </div>
              )}
            </div>
          </div>
        )}

        {/* Plan Modal */}
        {showPlanModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingPlan ? 'Edit Comp Plan' : 'Create Comp Plan'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plan Name</label>
                  <input
                    type="text"
                    value={planForm.name}
                    onChange={(e) => setPlanForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="e.g., Standard Sales Commission"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={planForm.description}
                    onChange={(e) => setPlanForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    rows={2}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plan Type</label>
                  <select
                    value={planForm.plan_type}
                    onChange={(e) => setPlanForm(prev => ({ ...prev, plan_type: e.target.value as any }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="percentage">Percentage of Sale</option>
                    <option value="flat_rate">Flat Rate per Sale</option>
                    <option value="tiered">Tiered Percentage</option>
                  </select>
                </div>

                {planForm.plan_type === 'flat_rate' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Flat Amount ($)</label>
                    <input
                      type="number"
                      value={planForm.flat_amount}
                      onChange={(e) => setPlanForm(prev => ({ ...prev, flat_amount: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="500"
                    />
                  </div>
                )}

                {planForm.plan_type === 'percentage' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Commission Rate (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={planForm.base_percentage}
                      onChange={(e) => setPlanForm(prev => ({ ...prev, base_percentage: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="5"
                    />
                  </div>
                )}

                {planForm.plan_type === 'tiered' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Commission Tiers</label>
                    <div className="space-y-2">
                      {planForm.tiers.map((tier, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                          <div className="flex-1">
                            <label className="text-xs text-gray-500">Min ($)</label>
                            <input
                              type="number"
                              value={tier.min}
                              onChange={(e) => updateTier(index, 'min', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-gray-500">Max ($)</label>
                            <input
                              type="number"
                              value={tier.max || ''}
                              onChange={(e) => updateTier(index, 'max', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              placeholder="∞"
                            />
                          </div>
                          <div className="w-20">
                            <label className="text-xs text-gray-500">Rate (%)</label>
                            <input
                              type="number"
                              step="0.1"
                              value={tier.rate}
                              onChange={(e) => updateTier(index, 'rate', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <button
                            onClick={() => removeTier(index)}
                            className="p-1 text-red-500 hover:text-red-700 mt-4"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={addTier}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-indigo-300 hover:text-indigo-600"
                      >
                        + Add Tier
                      </button>
                    </div>
                  </div>
                )}

                {/* Manager Plan Toggle */}
                <div className="border-t pt-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={planForm.is_manager_plan}
                      onChange={(e) => {
                        const isManager = e.target.checked
                        setPlanForm(prev => ({ 
                          ...prev, 
                          is_manager_plan: isManager,
                          applicable_roles: isManager 
                            ? ['sales_manager', 'regional_manager', 'manager'] 
                            : ['sales_rep', 'canvasser']
                        }))
                      }}
                      className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">Manager Compensation Plan</span>
                      <p className="text-xs text-gray-500">Enable personal sales commissions and team overrides</p>
                    </div>
                  </label>
                </div>

                {/* Manager-specific options */}
                {planForm.is_manager_plan && (
                  <div className="bg-purple-50 rounded-lg p-4 space-y-4">
                    <h4 className="text-sm font-semibold text-purple-900">Manager Compensation Options</h4>
                    
                    {/* Personal Sales Toggle */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={planForm.personal_sales_enabled}
                        onChange={(e) => setPlanForm(prev => ({ ...prev, personal_sales_enabled: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">Personal Sales Commission</span>
                        <p className="text-xs text-gray-500">Manager earns commission on their own sales (uses rates above)</p>
                      </div>
                    </label>

                    {/* Team Override Toggle */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={planForm.team_override_enabled}
                        onChange={(e) => setPlanForm(prev => ({ ...prev, team_override_enabled: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">Team Override Commission</span>
                        <p className="text-xs text-gray-500">Manager earns override on their team&apos;s sales</p>
                      </div>
                    </label>

                    {/* Team Override Tiers */}
                    {planForm.team_override_enabled && (
                      <div className="mt-4 pt-4 border-t border-purple-200">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <label className="block text-sm font-medium text-purple-900">Team Override Tiers</label>
                            <p className="text-xs text-purple-700">Set override rates based on team&apos;s total volume</p>
                          </div>
                          <button
                            type="button"
                            onClick={addTeamOverride}
                            className="text-sm text-purple-600 hover:text-purple-800 font-medium"
                          >
                            + Add Tier
                          </button>
                        </div>
                        
                        {planForm.team_overrides.length > 0 ? (
                          <div className="space-y-2">
                            {planForm.team_overrides.map((to, index) => (
                              <div key={index} className="flex items-end gap-2 p-3 bg-white rounded-lg border border-purple-200">
                                <div className="flex-1">
                                  <label className="text-xs text-gray-600">Min Team Volume (accounts)</label>
                                  <input
                                    type="number"
                                    value={to.min_team_volume}
                                    onChange={(e) => updateTeamOverride(index, 'min_team_volume', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  />
                                </div>
                                <div className="flex-1">
                                  <label className="text-xs text-gray-600">Max Team Volume (accounts)</label>
                                  <input
                                    type="number"
                                    value={to.max_team_volume || ''}
                                    onChange={(e) => updateTeamOverride(index, 'max_team_volume', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                    placeholder="∞ (no limit)"
                                  />
                                </div>
                                <div className="w-28">
                                  <label className="text-xs text-gray-600">Override Type</label>
                                  <select
                                    value={to.override_type}
                                    onChange={(e) => updateTeamOverride(index, 'override_type', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  >
                                    <option value="percentage">% of Sale</option>
                                    <option value="flat">$ Flat</option>
                                  </select>
                                </div>
                                <div className="w-24">
                                  <label className="text-xs text-gray-600">
                                    {to.override_type === 'percentage' ? 'Rate %' : 'Amount $'}
                                  </label>
                                  <input
                                    type="number"
                                    step={to.override_type === 'percentage' ? '0.1' : '1'}
                                    value={to.override_value}
                                    onChange={(e) => updateTeamOverride(index, 'override_value', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeTeamOverride(index)}
                                  className="p-1.5 text-red-500 hover:text-red-700"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-4 border-2 border-dashed border-purple-200 rounded-lg bg-white">
                            <p className="text-sm text-gray-500">No override tiers configured</p>
                            <button
                              type="button"
                              onClick={addTeamOverride}
                              className="mt-2 text-sm text-purple-600 hover:text-purple-800"
                            >
                              + Add first override tier
                            </button>
                          </div>
                        )}

                        {planForm.team_overrides.length > 0 && (
                          <div className="mt-3 p-3 bg-white rounded-lg border border-purple-200">
                            <p className="text-xs font-medium text-gray-700 mb-1">Example:</p>
                            <p className="text-xs text-gray-600">
                              If team sells ${planForm.team_overrides[0]?.min_team_volume?.toLocaleString() || '0'}+ in a period,
                              manager earns{' '}
                              <span className="font-medium text-purple-600">
                                {planForm.team_overrides[0]?.override_type === 'percentage' 
                                  ? `${planForm.team_overrides[0]?.override_value}% of each team sale`
                                  : `$${planForm.team_overrides[0]?.override_value} per team sale`}
                              </span>
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Volume Bonuses - Sliding Scale */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Volume Bonuses (Sliding Scale)</label>
                      <p className="text-xs text-gray-500 mt-0.5">Add bonus % or $ based on total monthly/period volume</p>
                    </div>
                    <button
                      type="button"
                      onClick={addVolumeBonus}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      + Add Tier
                    </button>
                  </div>
                  
                  {planForm.volume_bonuses.length > 0 ? (
                    <div className="space-y-2">
                      {planForm.volume_bonuses.map((vb, index) => (
                        <div key={index} className="flex items-end gap-2 p-3 bg-blue-50 rounded-lg">
                          <div className="flex-1">
                            <label className="text-xs text-gray-600">Min Volume (accounts)</label>
                            <input
                              type="number"
                              value={vb.min_volume}
                              onChange={(e) => updateVolumeBonus(index, 'min_volume', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-gray-600">Max Volume (accounts)</label>
                            <input
                              type="number"
                              value={vb.max_volume || ''}
                              onChange={(e) => updateVolumeBonus(index, 'max_volume', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                              placeholder="∞ (no limit)"
                            />
                          </div>
                          <div className="w-28">
                            <label className="text-xs text-gray-600">Bonus Type</label>
                            <select
                              value={vb.bonus_type}
                              onChange={(e) => updateVolumeBonus(index, 'bonus_type', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            >
                              <option value="percentage">% Add</option>
                              <option value="flat">$ Flat</option>
                            </select>
                          </div>
                          <div className="w-24">
                            <label className="text-xs text-gray-600">
                              {vb.bonus_type === 'percentage' ? 'Add %' : 'Bonus $'}
                            </label>
                            <input
                              type="number"
                              step={vb.bonus_type === 'percentage' ? '0.1' : '1'}
                              value={vb.bonus_value}
                              onChange={(e) => updateVolumeBonus(index, 'bonus_value', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeVolumeBonus(index)}
                            className="p-1.5 text-red-500 hover:text-red-700"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 border-2 border-dashed border-gray-200 rounded-lg">
                      <p className="text-sm text-gray-500">No volume bonuses configured</p>
                      <button
                        type="button"
                        onClick={addVolumeBonus}
                        className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
                      >
                        + Add first volume tier
                      </button>
                    </div>
                  )}
                  
                  {planForm.volume_bonuses.length > 0 && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-700 mb-1">Example Calculation:</p>
                      <p className="text-xs text-gray-600">
                        {planForm.plan_type === 'percentage' && planForm.base_percentage ? (
                          <>
                            Base: {planForm.base_percentage}% + Volume Bonus = Total Rate
                            <br />
                            If rep closes {planForm.volume_bonuses[0]?.min_volume?.toLocaleString() || '0'}+ accounts in a period:
                            <br />
                            {planForm.base_percentage}% + {planForm.volume_bonuses[0]?.bonus_type === 'percentage' 
                              ? `${planForm.volume_bonuses[0]?.bonus_value}%` 
                              : `$${planForm.volume_bonuses[0]?.bonus_value} flat bonus`} 
                            = <span className="font-medium text-green-600">
                              {planForm.volume_bonuses[0]?.bonus_type === 'percentage' 
                                ? `${(parseFloat(planForm.base_percentage) + (planForm.volume_bonuses[0]?.bonus_value || 0)).toFixed(1)}%`
                                : `${planForm.base_percentage}% + $${planForm.volume_bonuses[0]?.bonus_value}`}
                            </span>
                          </>
                        ) : (
                          <>Volume bonuses add to your base commission rate or provide flat dollar bonuses based on accounts closed.</>
                        )}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={planForm.is_active}
                      onChange={(e) => setPlanForm(prev => ({ ...prev, is_active: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Active</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={planForm.is_default}
                      onChange={(e) => setPlanForm(prev => ({ ...prev, is_default: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Default Plan</span>
                  </label>
                </div>
                
                {/* Plan Readme */}
                <div className="mt-4 pt-4 border-t">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Plan Readme / Additional Details
                  </label>
                  <textarea
                    value={planForm.readme}
                    onChange={(e) => setPlanForm(prev => ({ ...prev, readme: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                    placeholder="Add any additional details, special conditions, or notes that team members should know about this comp plan..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    This will be shown to team members when they view their comp plan details.
                  </p>
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowPlanModal(false)
                    setEditingPlan(null)
                    resetPlanForm()
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={savePlan}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  {editingPlan ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Assignment Modal */}
        {showAssignModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">Assign Comp Plan</h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
                  <select
                    value={assignForm.user_id}
                    onChange={(e) => setAssignForm(prev => ({ ...prev, user_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select user...</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name} ({user.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Comp Plan</label>
                  <select
                    value={assignForm.comp_plan_id}
                    onChange={(e) => setAssignForm(prev => ({ ...prev, comp_plan_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select plan...</option>
                    {compPlans.filter(p => p.is_active).map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
                  <input
                    type="date"
                    value={assignForm.effective_from}
                    onChange={(e) => setAssignForm(prev => ({ ...prev, effective_from: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Override Rate (%) <span className="text-gray-400 font-normal">- Optional</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={assignForm.override_percentage}
                    onChange={(e) => setAssignForm(prev => ({ ...prev, override_percentage: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Leave blank to use plan default"
                  />
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAssignment}
                  disabled={!assignForm.user_id || !assignForm.comp_plan_id}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
