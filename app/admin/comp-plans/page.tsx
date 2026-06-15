'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { formatVolumeBonusTierRange, normalizeVolumeBonusTierMetric } from '@/lib/volume-bonus-display'
import {
  COMP_PLAN_UNIT_RATE_LABELS,
  isKnownCompPlanUnitType,
} from '@/lib/comp-plan-unit-types'
import { formatNumericDraft, parseDraftFloat } from '@/lib/numeric-input-draft'

interface VolumeTier {
  min_volume: number
  max_volume: number | null
  bonus_type: 'percentage' | 'flat'  // percentage adds to base rate, flat is dollar amount
  bonus_value: number
  /** Bound basis: commission $ volume (default), closer close rate %, or setter sit count. */
  tier_metric?: 'volume' | 'closing_rate' | 'sits'
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
  plan_type: 'flat_rate' | 'percentage' | 'tiered' | 'hybrid' | 'hourly' | 'unit_based'
  is_active: boolean
  is_default: boolean
  flat_amount: number | null
  base_percentage: number | null
  hourly_rate: number | null
  unit_rate: number | null
  unit_type: string | null  // 'square', 'kw', 'linear_foot', etc.
  tiers: { min: number; max: number | null; rate: number }[] | null
  bonuses: { type: string; target: number; bonus: number }[] | null
  volume_bonuses: VolumeTier[] | null
  // Hybrid plan components
  hybrid_components: HybridComponent[] | null
  // Manager-specific fields
  is_manager_plan: boolean
  personal_sales_enabled: boolean
  team_override_enabled: boolean
  team_overrides: OverrideTier[] | null
  applicable_roles: string[]
  created_at: string
}

interface HybridComponent {
  type: 'hourly' | 'percentage' | 'flat_per_job' | 'per_unit'
  rate: number
  unit_type?: string  // For per_unit: 'square', 'kw', 'linear_foot', etc.
  description?: string
}

type TierFormRow = { min: string; max: string; rate: string }
type HybridComponentForm = Omit<HybridComponent, 'rate'> & { rate: string }
type VolumeTierForm = Omit<VolumeTier, 'min_volume' | 'max_volume' | 'bonus_value'> & {
  min_volume: string
  max_volume: string
  bonus_value: string
}
type OverrideTierForm = Omit<OverrideTier, 'min_team_volume' | 'max_team_volume' | 'override_value'> & {
  min_team_volume: string
  max_team_volume: string
  override_value: string
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

const planTypeLabels: Record<string, string> = {
  flat_rate: 'Flat Rate',
  percentage: 'Percentage',
  tiered: 'Tiered',
  hybrid: 'Hybrid',
  hourly: 'Hourly',
  unit_based: 'Per Unit',
}

function volumeTierFieldLabels(m: VolumeTier['tier_metric']) {
  const t = normalizeVolumeBonusTierMetric(m)
  if (t === 'closing_rate')
    return { min: 'Min close rate (%)', max: 'Max close rate (%)' }
  if (t === 'sits') return { min: 'Min sits', max: 'Max sits' }
  return { min: 'Min volume ($)', max: 'Max volume ($)' }
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
    hourly_rate: '',
    unit_rate: '',
    unit_type: 'square',
    custom_unit_label: '',
    tiers: [{ min: '0', max: '10000', rate: '5' }] as TierFormRow[],
    volume_bonuses: [] as VolumeTierForm[],
    // Hybrid components
    hybrid_components: [] as HybridComponentForm[],
    // Manager-specific fields
    is_manager_plan: false,
    personal_sales_enabled: true,
    team_override_enabled: false,
    team_overrides: [] as OverrideTierForm[],
    applicable_roles: ['sales_rep'],
    is_active: true,
    is_default: false,
    readme: '',
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
    const requiredDraft = (value: string, label: string) => {
      if (parseDraftFloat(value) !== null) return true
      alert(`${label} is required`)
      return false
    }
    const optionalDraft = (value: string, label: string) => {
      if (value.trim() === '' || parseDraftFloat(value) !== null) return true
      alert(`${label} must be a valid number`)
      return false
    }

    if (planForm.plan_type === 'tiered') {
      for (let index = 0; index < planForm.tiers.length; index += 1) {
        const tier = planForm.tiers[index]
        const row = `Tier ${index + 1}`
        if (
          !requiredDraft(tier.min, `${row} min`) ||
          !optionalDraft(tier.max, `${row} max`) ||
          !requiredDraft(tier.rate, `${row} rate`)
        ) {
          return
        }
      }
    }

    for (let index = 0; index < planForm.volume_bonuses.length; index += 1) {
      const bonus = planForm.volume_bonuses[index]
      const row = `Volume bonus ${index + 1}`
      if (
        !requiredDraft(bonus.min_volume, `${row} min`) ||
        !optionalDraft(bonus.max_volume, `${row} max`) ||
        !requiredDraft(bonus.bonus_value, `${row} value`)
      ) {
        return
      }
    }

    if (planForm.plan_type === 'hybrid') {
      for (let index = 0; index < planForm.hybrid_components.length; index += 1) {
        if (!requiredDraft(planForm.hybrid_components[index].rate, `Hybrid component ${index + 1} rate`)) {
          return
        }
      }
    }

    if (planForm.is_manager_plan && planForm.team_override_enabled) {
      for (let index = 0; index < planForm.team_overrides.length; index += 1) {
        const teamOverride = planForm.team_overrides[index]
        const row = `Team override ${index + 1}`
        if (
          !requiredDraft(teamOverride.min_team_volume, `${row} min`) ||
          !optionalDraft(teamOverride.max_team_volume, `${row} max`) ||
          !requiredDraft(teamOverride.override_value, `${row} value`)
        ) {
          return
        }
      }
    }

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
      hourly_rate: ['hourly', 'hybrid'].includes(planForm.plan_type) 
        ? parseFloat(planForm.hourly_rate) || null 
        : null,
      unit_rate: planForm.plan_type === 'unit_based' || planForm.hybrid_components.some(c => c.type === 'per_unit')
        ? parseFloat(planForm.unit_rate) || null 
        : null,
      unit_type: planForm.plan_type === 'unit_based' 
        ? (planForm.unit_type === 'custom' ? planForm.custom_unit_label : planForm.unit_type)
        : null,
      tiers:
        planForm.plan_type === 'tiered'
          ? planForm.tiers.map((t) => ({
              min: parseDraftFloat(t.min, { required: true }) ?? 0,
              max: t.max.trim() === '' ? null : parseDraftFloat(t.max, { required: true }) ?? 0,
              rate: parseDraftFloat(t.rate, { required: true }) ?? 0,
            }))
          : null,
      volume_bonuses:
        planForm.volume_bonuses.length > 0
          ? planForm.volume_bonuses.map((b) => ({
              ...b,
              min_volume: parseDraftFloat(b.min_volume, { required: true }) ?? 0,
              max_volume: b.max_volume.trim() === '' ? null : parseDraftFloat(b.max_volume, { required: true }) ?? 0,
              bonus_value: parseDraftFloat(b.bonus_value, { required: true }) ?? 0,
            }))
          : null,
      hybrid_components:
        planForm.plan_type === 'hybrid' && planForm.hybrid_components.length > 0
          ? planForm.hybrid_components.map((c) => ({
              ...c,
              rate: parseDraftFloat(c.rate, { required: true }) ?? 0,
            }))
          : null,
      is_manager_plan: planForm.is_manager_plan,
      personal_sales_enabled: planForm.is_manager_plan ? planForm.personal_sales_enabled : null,
      team_override_enabled: planForm.is_manager_plan ? planForm.team_override_enabled : null,
      team_overrides:
        planForm.is_manager_plan && planForm.team_override_enabled && planForm.team_overrides.length > 0
          ? planForm.team_overrides.map((o) => ({
              ...o,
              min_team_volume: parseDraftFloat(o.min_team_volume, { required: true }) ?? 0,
              max_team_volume:
                o.max_team_volume.trim() === ''
                  ? null
                  : parseDraftFloat(o.max_team_volume, { required: true }) ?? 0,
              override_value: parseDraftFloat(o.override_value, { required: true }) ?? 0,
            }))
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
      hourly_rate: '',
      unit_rate: '',
      unit_type: 'square',
      custom_unit_label: '',
      tiers: [{ min: '0', max: '10000', rate: '5' }],
      volume_bonuses: [],
      hybrid_components: [],
      is_manager_plan: false,
      personal_sales_enabled: true,
      team_override_enabled: false,
      team_overrides: [],
      applicable_roles: ['sales_rep'],
      is_active: true,
      is_default: false,
      readme: '',
    })
  }

  const openEditPlan = (plan: CompPlan) => {
    setEditingPlan(plan)
    const isCustomUnit = plan.unit_type && !isKnownCompPlanUnitType(plan.unit_type)
    setPlanForm({
      name: plan.name,
      description: plan.description || '',
      plan_type: plan.plan_type,
      flat_amount: plan.flat_amount?.toString() || '',
      base_percentage: plan.base_percentage?.toString() || '',
      hourly_rate: plan.hourly_rate?.toString() || '',
      unit_rate: plan.unit_rate?.toString() || '',
      unit_type: isCustomUnit ? 'custom' : (plan.unit_type || 'square'),
      custom_unit_label: isCustomUnit ? (plan.unit_type || '') : '',
      tiers: (plan.tiers || [{ min: 0, max: 10000, rate: 5 }]).map((t) => ({
        min: formatNumericDraft(t.min),
        max: t.max == null ? '' : formatNumericDraft(t.max),
        rate: formatNumericDraft(t.rate),
      })),
      volume_bonuses: (plan.volume_bonuses || []).map((b) => ({
        ...b,
        tier_metric: normalizeVolumeBonusTierMetric(b.tier_metric) as VolumeTier['tier_metric'],
        min_volume: formatNumericDraft(b.min_volume),
        max_volume: b.max_volume == null ? '' : formatNumericDraft(b.max_volume),
        bonus_value: formatNumericDraft(b.bonus_value),
      })),
      hybrid_components: (plan.hybrid_components || []).map((c) => ({
        ...c,
        rate: formatNumericDraft(c.rate),
      })),
      is_manager_plan: plan.is_manager_plan || false,
      personal_sales_enabled: plan.personal_sales_enabled ?? true,
      team_override_enabled: plan.team_override_enabled || false,
      team_overrides: (plan.team_overrides || []).map((o) => ({
        ...o,
        min_team_volume: formatNumericDraft(o.min_team_volume),
        max_team_volume: o.max_team_volume == null ? '' : formatNumericDraft(o.max_team_volume),
        override_value: formatNumericDraft(o.override_value),
      })),
      applicable_roles: plan.applicable_roles || ['sales_rep'],
      is_active: plan.is_active,
      is_default: plan.is_default,
      readme: (plan as any).readme || '',
    })
    setShowPlanModal(true)
  }

  const addTier = () => {
    const lastTier = planForm.tiers[planForm.tiers.length - 1]
    const lastMax = lastTier.max.trim() === '' ? 0 : parseDraftFloat(lastTier.max, { required: true }) ?? 0
    const lastRate = parseDraftFloat(lastTier.rate, { required: true }) ?? 0
    setPlanForm(prev => ({
      ...prev,
      tiers: [
        ...prev.tiers,
        {
          min: String(lastMax + 1),
          max: String(lastMax + 10000),
          rate: String(lastRate + 1),
        },
      ],
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
        i === index ? { ...tier, [field]: value } : tier
      ),
    }))
  }

  // Volume bonus functions
  const addVolumeBonus = () => {
    const lastBonus = planForm.volume_bonuses[planForm.volume_bonuses.length - 1]
    const lastMax = lastBonus
      ? lastBonus.max_volume.trim() === ''
        ? parseDraftFloat(lastBonus.min_volume, { required: true }) ?? 0
        : parseDraftFloat(lastBonus.max_volume, { required: true }) ?? 0
      : 0
    const newMin = lastBonus ? lastMax + 1 : 0
    setPlanForm(prev => ({
      ...prev,
      volume_bonuses: [...prev.volume_bonuses, {
        min_volume: String(newMin),
        max_volume: String(newMin + 50000),
        bonus_type: 'percentage',
        bonus_value: '1',
        tier_metric: 'volume',
      }],
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
        if (field === 'bonus_type') {
          return { ...bonus, [field]: value as 'percentage' | 'flat' }
        }
        if (field === 'tier_metric') {
          return { ...bonus, tier_metric: value as VolumeTier['tier_metric'] }
        }
        return { ...bonus, [field]: String(value) }
      }),
    }))
  }

  // Team override functions (for manager plans)
  const addTeamOverride = () => {
    const lastOverride = planForm.team_overrides[planForm.team_overrides.length - 1]
    const lastMax = lastOverride
      ? lastOverride.max_team_volume.trim() === ''
        ? parseDraftFloat(lastOverride.min_team_volume, { required: true }) ?? 0
        : parseDraftFloat(lastOverride.max_team_volume, { required: true }) ?? 0
      : 0
    const newMin = lastOverride ? lastMax + 1 : 0
    setPlanForm(prev => ({
      ...prev,
      team_overrides: [...prev.team_overrides, {
        min_team_volume: String(newMin),
        max_team_volume: String(newMin + 100000),
        override_type: 'percentage',
        override_value: '1',
      }],
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
        if (field === 'override_type') {
          return { ...override, [field]: value as 'percentage' | 'flat' }
        }
        return { ...override, [field]: String(value) }
      }),
    }))
  }

  // Hybrid component functions
  const addHybridComponent = () => {
    setPlanForm(prev => ({
      ...prev,
      hybrid_components: [...prev.hybrid_components, {
        type: 'hourly',
        rate: '',
        description: '',
      }]
    }))
  }

  const removeHybridComponent = (index: number) => {
    setPlanForm(prev => ({
      ...prev,
      hybrid_components: prev.hybrid_components.filter((_, i) => i !== index)
    }))
  }

  const updateHybridComponent = (index: number, field: string, value: string | number) => {
    setPlanForm(prev => ({
      ...prev,
      hybrid_components: prev.hybrid_components.map((comp, i) => {
        if (i !== index) return comp
        if (field === 'type') {
          return { ...comp, [field]: value as HybridComponent['type'] }
        }
        if (field === 'rate') {
          return { ...comp, rate: String(value) }
        }
        return { ...comp, [field]: value }
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
                            {formatVolumeBonusTierRange(vb, {
                              nextMinVolume: plan.volume_bonuses![i + 1]?.min_volume ?? null,
                            })}
                            :{' '}
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
                    <option value="hourly">Hourly Rate</option>
                    <option value="unit_based">Per Unit (sq, kW, etc.)</option>
                    <option value="hybrid">Hybrid (Multiple Components)</option>
                  </select>
                </div>

                {/* Hourly Rate */}
                {planForm.plan_type === 'hourly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate ($)</label>
                    <input
                      type="number"
                      value={planForm.hourly_rate}
                      onChange={(e) => setPlanForm(prev => ({ ...prev, hourly_rate: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="e.g., 18.50"
                      step="0.25"
                    />
                  </div>
                )}

                {/* Unit-Based Rate */}
                {planForm.plan_type === 'unit_based' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Unit Type</label>
                        <select
                          value={planForm.unit_type}
                          onChange={(e) => setPlanForm(prev => ({ ...prev, unit_type: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                        >
                          <option value="square">{COMP_PLAN_UNIT_RATE_LABELS.square} (roofing)</option>
                          <option value="kw">{COMP_PLAN_UNIT_RATE_LABELS.kw} (solar)</option>
                          <option value="linear_foot">{COMP_PLAN_UNIT_RATE_LABELS.linear_foot}</option>
                          <option value="panel">{COMP_PLAN_UNIT_RATE_LABELS.panel}</option>
                          <option value="window">{COMP_PLAN_UNIT_RATE_LABELS.window}</option>
                          <option value="sit">{COMP_PLAN_UNIT_RATE_LABELS.sit}</option>
                          <option value="sale">{COMP_PLAN_UNIT_RATE_LABELS.sale}</option>
                          <option value="custom">{COMP_PLAN_UNIT_RATE_LABELS.custom}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Rate per Unit ($)</label>
                        <input
                          type="number"
                          value={planForm.unit_rate}
                          onChange={(e) => setPlanForm(prev => ({ ...prev, unit_rate: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                          placeholder="e.g., 25.00"
                          step="0.01"
                        />
                      </div>
                    </div>
                    {planForm.unit_type === 'custom' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Custom Unit Label</label>
                        <input
                          type="text"
                          value={planForm.custom_unit_label}
                          onChange={(e) => setPlanForm(prev => ({ ...prev, custom_unit_label: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                          placeholder="e.g., per gutter section"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Hybrid Plan Components */}
                {planForm.plan_type === 'hybrid' && (
                  <div className="space-y-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-purple-900">Compensation Components</h4>
                        <p className="text-sm text-purple-700">Add multiple pay components (e.g., hourly + commission)</p>
                      </div>
                      <button
                        type="button"
                        onClick={addHybridComponent}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
                      >
                        + Add Component
                      </button>
                    </div>
                    
                    {planForm.hybrid_components.length === 0 && (
                      <p className="text-sm text-purple-600 text-center py-4">No components added yet. Click "Add Component" to start.</p>
                    )}
                    
                    {planForm.hybrid_components.map((comp, index) => (
                      <div key={index} className="p-3 bg-white rounded-lg border border-purple-200">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 grid grid-cols-3 gap-3">
                            <div>
                              <label className="text-xs text-gray-600">Type</label>
                              <select
                                value={comp.type}
                                onChange={(e) => updateHybridComponent(index, 'type', e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                              >
                                <option value="hourly">Hourly Rate</option>
                                <option value="percentage">% of Sale</option>
                                <option value="flat_per_job">$ per Job</option>
                                <option value="per_unit">Per Unit</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-600">
                                {comp.type === 'hourly' ? '$/Hour' : 
                                 comp.type === 'percentage' ? '% Rate' : 
                                 comp.type === 'flat_per_job' ? '$/Job' : '$/Unit'}
                              </label>
                              <input
                                type="number"
                                value={comp.rate}
                                onChange={(e) => updateHybridComponent(index, 'rate', e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                step={comp.type === 'percentage' ? '0.1' : '0.01'}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-600">
                                {comp.type === 'per_unit' ? 'Unit Type' : 'Description'}
                              </label>
                              {comp.type === 'per_unit' ? (
                                <select
                                  value={comp.unit_type || 'square'}
                                  onChange={(e) => updateHybridComponent(index, 'unit_type', e.target.value)}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                >
                                  <option value="square">Square</option>
                                  <option value="kw">kW</option>
                                  <option value="linear_foot">Linear Ft</option>
                                  <option value="panel">Panel</option>
                                  <option value="sit">Sit</option>
                                  <option value="sale">Sale</option>
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={comp.description || ''}
                                  onChange={(e) => updateHybridComponent(index, 'description', e.target.value)}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                                  placeholder="Optional"
                                />
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeHybridComponent(index)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {planForm.hybrid_components.length > 0 && (
                      <div className="p-3 bg-purple-100 rounded-lg">
                        <p className="text-sm text-purple-800">
                          <strong>Example:</strong> Inspector with $15/hr + 2% commission on closed deals
                        </p>
                      </div>
                    )}
                  </div>
                )}

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
                              value={tier.max}
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

                {/* Applies To Roles */}
                <div className="border-t pt-4 space-y-2">
                  <p className="text-sm font-medium text-gray-900">Applies to</p>
                  <div className="flex flex-wrap gap-4">
                    {[
                      { role: 'sales_rep', label: 'Sales Rep' },
                      { role: 'canvasser', label: 'Canvasser' },
                      { role: 'call_center', label: 'Call Center' },
                      { role: 'sales_manager', label: 'Sales Manager' },
                      { role: 'setter_manager', label: 'Setter Manager' },
                      { role: 'regional_manager', label: 'Regional Manager' },
                    ].map(({ role, label }) => (
                      <label key={role} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={planForm.applicable_roles.includes(role)}
                          onChange={(e) => {
                            const checked = e.target.checked
                            const managerRoles = ['sales_manager', 'setter_manager', 'regional_manager']
                            setPlanForm(prev => {
                              const next = checked
                                ? [...prev.applicable_roles, role]
                                : prev.applicable_roles.filter(r => r !== role)
                              const isManager = next.some(r => managerRoles.includes(r))
                              return { ...prev, applicable_roles: next, is_manager_plan: isManager }
                            })
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Manager Plan Toggle (auto-set by role selection, kept for manager-specific options) */}
                <div className="hidden">
                  <input type="checkbox" checked={planForm.is_manager_plan} readOnly />
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
                              If team sells ${(parseDraftFloat(planForm.team_overrides[0]?.min_team_volume || '0', { required: true }) ?? 0).toLocaleString()}+ in a period,
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
                      <p className="text-xs text-gray-500 mt-0.5">
                        Bonus tiers by monthly commissionable volume ($), sit count (setters), or close rate % (closers).
                        Use % add or a flat $ bonus per sale.
                      </p>
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
                      {planForm.volume_bonuses.map((vb, index) => {
                        const rangeL = volumeTierFieldLabels(vb.tier_metric)
                        return (
                        <div key={index} className="flex flex-wrap items-end gap-2 p-3 bg-blue-50 rounded-lg">
                          <div className="w-full sm:w-40">
                            <label className="text-xs text-gray-600">Tier basis</label>
                            <select
                              value={normalizeVolumeBonusTierMetric(vb.tier_metric)}
                              onChange={(e) => updateVolumeBonus(index, 'tier_metric', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            >
                              <option value="volume">Volume ($)</option>
                              <option value="closing_rate">Close rate (%)</option>
                              <option value="sits">Sits (count)</option>
                            </select>
                          </div>
                          <div className="flex-1 min-w-[7rem]">
                            <label className="text-xs text-gray-600">{rangeL.min}</label>
                            <input
                              type="number"
                              value={vb.min_volume}
                              onChange={(e) => updateVolumeBonus(index, 'min_volume', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="flex-1 min-w-[7rem]">
                            <label className="text-xs text-gray-600">{rangeL.max}</label>
                            <input
                              type="number"
                              value={vb.max_volume || ''}
                              onChange={(e) => updateVolumeBonus(index, 'max_volume', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                              placeholder="∞ (no limit)"
                            />
                          </div>
                          <div className="w-28">
                            <label className="text-xs text-gray-600">Bonus type</label>
                            <select
                              value={vb.bonus_type}
                              onChange={(e) => updateVolumeBonus(index, 'bonus_type', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            >
                              <option value="percentage">% Add</option>
                              <option value="flat">$ amount</option>
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
                        )
                      })}
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
                            Base rate plus tier bonus ({formatVolumeBonusTierRange({
                              min_volume: parseDraftFloat(planForm.volume_bonuses[0].min_volume, { required: true }) ?? 0,
                              max_volume: planForm.volume_bonuses[0].max_volume.trim() === ''
                                ? null
                                : parseDraftFloat(planForm.volume_bonuses[0].max_volume, { required: true }) ?? 0,
                              tier_metric: planForm.volume_bonuses[0].tier_metric,
                            })}).
                            <br />
                            {planForm.volume_bonuses[0]?.bonus_type === 'percentage' ? (
                              <>
                                Example: {planForm.base_percentage}% + {planForm.volume_bonuses[0]?.bonus_value}% ={' '}
                                <span className="font-medium text-green-600">
                                  {(parseFloat(planForm.base_percentage) + (parseDraftFloat(planForm.volume_bonuses[0]?.bonus_value || '0', { required: true }) ?? 0)).toFixed(1)}%
                                </span>{' '}
                                on commissionable amount; flat $ tiers add that amount per qualifying sale.
                              </>
                            ) : (
                              <>
                                Example: {planForm.base_percentage}% of sale +{' '}
                                <span className="font-medium text-green-600">
                                  ${planForm.volume_bonuses[0]?.bonus_value} bonus
                                </span>{' '}
                                once for the period when the tier applies.
                              </>
                            )}
                          </>
                        ) : (
                          <>Tiers add extra rate or a per-sale dollar bonus when the rep qualifies on the chosen basis.</>
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
