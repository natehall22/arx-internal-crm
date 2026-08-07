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
import {
  COMP_PLAN_ROLE_OPTIONS,
  compPlanRoleLabel,
  isCompPlanManagerRole,
  isKnownCompPlanRole,
} from '@/lib/comp-plan-roles'
import {
  getCompPlanPayabilityWarnings,
  hasBlockingCompPlanWarning,
  planTypePaysCommission,
  type CompPlanWarning,
} from '@/lib/comp-plan-payability'

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
  plan_purpose: 'primary' | 'management_overlay'
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
  users?: { full_name: string; role: string; manager_user_id?: string | null }
  comp_plans?: { name: string }
}

interface ManagementOverlayAssignment {
  id: string
  user_id: string
  comp_plan_id: string
  lane: 'setter' | 'closer'
  effective_from: string
  effective_to: string | null
  ended_at: string | null
  end_reason: string | null
  comp_plans?: { name: string } | null
}

interface ManagementOverlayVersion {
  id: string
  comp_plan_id: string
  lane: 'setter' | 'closer'
  override_percent: number
  effective_from: string
}

interface AssignmentUser {
  id: string
  full_name: string
  email?: string
  role: string
  manager_user_id?: string | null
}

/** Explicit dark ink for body text on light surfaces (project UI convention). */
const INK = '#2c2c2a'

const planTypeLabels: Record<string, string> = {
  flat_rate: 'Flat Rate',
  percentage: 'Percentage',
  tiered: 'Tiered',
  hybrid: 'Hybrid',
  hourly: 'Hourly',
  unit_based: 'Per Unit',
}

function CompPlanWarningList({ warnings }: { warnings: CompPlanWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => {
        const blocking = w.level === 'blocking'
        return (
          <div
            key={i}
            role={blocking ? 'alert' : undefined}
            className={`rounded-lg border px-4 py-3 ${
              blocking ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
            }`}
          >
            <p
              className="text-sm font-semibold"
              style={{ color: blocking ? '#7f1d1d' : '#78350f' }}
            >
              {blocking ? 'Will not pay: ' : 'Heads up: '}
              {w.title}
            </p>
            <p className="mt-1 text-sm" style={{ color: blocking ? '#7f1d1d' : '#78350f' }}>
              {w.detail}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function volumeTierFieldLabels(m: VolumeTier['tier_metric']) {
  const t = normalizeVolumeBonusTierMetric(m)
  if (t === 'closing_rate')
    return { min: 'Min close rate (%)', max: 'Max close rate (%)' }
  if (t === 'sits') return { min: 'Min sits', max: 'Max sits' }
  return { min: 'Min volume ($)', max: 'Max volume ($)' }
}

function formatEffectiveRange(effectiveFrom: string, effectiveTo: string | null) {
  const from = new Date(`${effectiveFrom}T00:00:00`).toLocaleDateString()
  if (!effectiveTo) return `Effective ${from}`
  return `${from} – ${new Date(`${effectiveTo}T00:00:00`).toLocaleDateString()}`
}

export default function CompPlansPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [compPlans, setCompPlans] = useState<CompPlan[]>([])
  const [userAssignments, setUserAssignments] = useState<UserCompPlan[]>([])
  const [managementOverlayAssignments, setManagementOverlayAssignments] = useState<ManagementOverlayAssignment[]>([])
  const [managementOverlayVersions, setManagementOverlayVersions] = useState<ManagementOverlayVersion[]>([])
  const [users, setUsers] = useState<AssignmentUser[]>([])
  const [activeTab, setActiveTab] = useState<'plans' | 'assignments'>('plans')
  
  // Modal states
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showOverlayModal, setShowOverlayModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState<CompPlan | null>(null)
  
  // Form state
  const [planForm, setPlanForm] = useState({
    name: '',
    plan_purpose: 'primary' as CompPlan['plan_purpose'],
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
    effective_from: '',
    override_percentage: '',
    change_reason: '',
  })

  const easternToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const tomorrowDate = new Date(`${easternToday}T12:00:00.000Z`)
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
  const tomorrowEastern = tomorrowDate.toISOString().slice(0, 10)
  const [overlayForm, setOverlayForm] = useState({
    user_id: '',
    comp_plan_id: '',
    lane: 'setter' as 'setter' | 'closer',
    effective_from: tomorrowEastern,
    change_reason: '',
  })

  // Surfaced live in the builder so an admin never saves a plan that quietly pays $0.
  const planWarnings = getCompPlanPayabilityWarnings({
    plan_type: planForm.plan_type,
    base_percentage: planForm.base_percentage,
    flat_amount: planForm.flat_amount,
    tiers: planForm.tiers,
    volume_bonuses: planForm.volume_bonuses,
    is_manager_plan: planForm.is_manager_plan,
    team_override_enabled: planForm.team_override_enabled,
    team_overrides: planForm.team_overrides,
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
      setManagementOverlayAssignments(data.managementOverlayAssignments || [])
      setManagementOverlayVersions(data.managementOverlayVersions || [])
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

    if (planForm.plan_purpose === 'primary' && planForm.plan_type === 'tiered') {
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

    for (let index = 0; planForm.plan_purpose === 'primary' && index < planForm.volume_bonuses.length; index += 1) {
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

    if (planForm.plan_purpose === 'primary' && planForm.plan_type === 'hybrid') {
      for (let index = 0; index < planForm.hybrid_components.length; index += 1) {
        if (!requiredDraft(planForm.hybrid_components[index].rate, `Hybrid component ${index + 1} rate`)) {
          return
        }
      }
    }

    if (planForm.plan_purpose === 'management_overlay') {
      const rate = parseDraftFloat(planForm.base_percentage, { required: true })
      if (rate === null || rate < 0 || rate > 100) {
        alert('Management overlay rate must be between 0 and 100%.')
        return
      }
    }

    // Last stop before a plan that pays $0 gets saved and assigned to a rep.
    if (planForm.plan_purpose === 'primary' && hasBlockingCompPlanWarning(planWarnings)) {
      const reasons = planWarnings
        .filter((w) => w.level === 'blocking')
        .map((w) => `• ${w.title}`)
        .join('\n')
      const proceed = confirm(
        `This plan will not produce paid commission lines:\n\n${reasons}\n\n` +
          'Anyone assigned to it shows $0 on the payroll export until their pay is entered by hand.\n\n' +
          'Save it anyway?'
      )
      if (!proceed) return
    }

    const planData = {
      resource: editingPlan ? 'comp_plan' : 'comp_plan',
      id: editingPlan?.id,
      name: planForm.name,
      plan_purpose: planForm.plan_purpose,
      description: planForm.description || null,
      plan_type: planForm.plan_purpose === 'management_overlay' ? 'percentage' : planForm.plan_type,
      flat_amount: planForm.plan_purpose === 'primary' && planForm.plan_type === 'flat_rate' ? parseFloat(planForm.flat_amount) || null : null,
      base_percentage: planForm.plan_purpose === 'management_overlay'
        ? parseDraftFloat(planForm.base_percentage, { required: true })
        : ['percentage', 'tiered', 'hybrid'].includes(planForm.plan_type)
        ? parseFloat(planForm.base_percentage) || null 
        : null,
      hourly_rate: planForm.plan_purpose === 'primary' && ['hourly', 'hybrid'].includes(planForm.plan_type)
        ? parseFloat(planForm.hourly_rate) || null 
        : null,
      unit_rate: planForm.plan_purpose === 'primary' && (planForm.plan_type === 'unit_based' || planForm.hybrid_components.some(c => c.type === 'per_unit'))
        ? parseFloat(planForm.unit_rate) || null 
        : null,
      unit_type: planForm.plan_purpose === 'primary' && planForm.plan_type === 'unit_based'
        ? (planForm.unit_type === 'custom' ? planForm.custom_unit_label : planForm.unit_type)
        : null,
      tiers:
        planForm.plan_purpose === 'primary' && planForm.plan_type === 'tiered'
          ? planForm.tiers.map((t) => ({
              min: parseDraftFloat(t.min, { required: true }) ?? 0,
              max: t.max.trim() === '' ? null : parseDraftFloat(t.max, { required: true }) ?? 0,
              rate: parseDraftFloat(t.rate, { required: true }) ?? 0,
            }))
          : null,
      volume_bonuses:
        planForm.plan_purpose === 'primary' && planForm.volume_bonuses.length > 0
          ? planForm.volume_bonuses.map((b) => ({
              ...b,
              min_volume: parseDraftFloat(b.min_volume, { required: true }) ?? 0,
              max_volume: b.max_volume.trim() === '' ? null : parseDraftFloat(b.max_volume, { required: true }) ?? 0,
              bonus_value: parseDraftFloat(b.bonus_value, { required: true }) ?? 0,
            }))
          : null,
      hybrid_components:
        planForm.plan_purpose === 'primary' && planForm.plan_type === 'hybrid' && planForm.hybrid_components.length > 0
          ? planForm.hybrid_components.map((c) => ({
              ...c,
              rate: parseDraftFloat(c.rate, { required: true }) ?? 0,
            }))
          : null,
      is_manager_plan: planForm.plan_purpose === 'management_overlay' ? true : planForm.is_manager_plan,
      personal_sales_enabled: planForm.plan_purpose === 'management_overlay'
        ? false
        : planForm.is_manager_plan ? planForm.personal_sales_enabled : null,
      team_override_enabled: planForm.plan_purpose === 'management_overlay'
        ? false
        : planForm.is_manager_plan ? planForm.team_override_enabled : null,
      team_overrides:
        planForm.plan_purpose === 'primary' && planForm.is_manager_plan && planForm.team_override_enabled && planForm.team_overrides.length > 0
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
      applicable_roles: planForm.plan_purpose === 'management_overlay' ? [] : planForm.applicable_roles,
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
          change_reason: assignForm.change_reason,
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
        effective_from: tomorrowEastern,
        override_percentage: '',
        change_reason: '',
      })
      loadData()
    } catch (error) {
      console.error('Error assigning comp plan:', error)
      alert('Failed to assign comp plan')
    }
  }

  const saveManagementOverlay = async () => {
    try {
      const response = await fetch('/api/admin/comp-plan-overlays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...overlayForm,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to assign management overlay')
        return
      }
      setShowOverlayModal(false)
      setOverlayForm({
        user_id: '',
        comp_plan_id: '',
        lane: 'setter',
        effective_from: tomorrowEastern,
        change_reason: '',
      })
      loadData()
    } catch (error) {
      console.error('Error assigning management overlay:', error)
      alert('Failed to assign management overlay')
    }
  }

  const cancelManagementOverlay = async (assignmentId: string) => {
    const reason = prompt('Why is this scheduled management overlay being cancelled?')?.trim()
    if (!reason) return
    const response = await fetch('/api/admin/comp-plan-overlays', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment_id: assignmentId, change_reason: reason }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      alert(data.error || 'Failed to cancel management overlay')
      return
    }
    loadData()
  }

  const endManagementOverlay = async (assignmentId: string) => {
    const effectiveTo = prompt(
      'Last active date for this overlay (YYYY-MM-DD). Today keeps today’s production eligible:',
      easternToday
    )?.trim()
    if (!effectiveTo) return
    const reason = prompt('Why is this management overlay ending?')?.trim()
    if (!reason) return
    const response = await fetch('/api/admin/comp-plan-overlays', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment_id: assignmentId,
        effective_to: effectiveTo,
        change_reason: reason,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      alert(data.error || 'Failed to end management overlay')
      return
    }
    loadData()
  }

  const deletePlan = async (id: string) => {
    if (!confirm('Deactivate this comp plan? Historical assignments will remain unchanged.')) return
    try {
      const response = await fetch(`/api/admin/data?resource=comp_plan&id=${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to deactivate comp plan')
        return
      }
      loadData()
    } catch (error) {
      console.error('Error deleting comp plan:', error)
    }
  }

  const deleteAssignment = async (id: string, scheduled = false) => {
    const cancellationReason = scheduled
      ? prompt('Why is this scheduled primary plan being cancelled?')?.trim()
      : null
    if (scheduled && !cancellationReason) return
    if (!scheduled && !confirm('End this assignment after today? Historical pay will remain unchanged.')) return
    try {
      const response = await fetch(`/api/admin/data?resource=user_comp_plan&id=${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change_reason: cancellationReason }),
      })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to end assignment')
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
      plan_purpose: 'primary',
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
      plan_purpose: plan.plan_purpose || 'primary',
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

  const today = easternToday
  const usersById = new Map(users.map((user) => [user.id, user]))
  const assignmentsByUser = new Map<string, UserCompPlan[]>()
  for (const assignment of userAssignments) {
    const existing = assignmentsByUser.get(assignment.user_id) || []
    existing.push(assignment)
    assignmentsByUser.set(assignment.user_id, existing)
  }

  const assignmentRows = users.map((user) => {
    const assignments = [...(assignmentsByUser.get(user.id) || [])].sort((a, b) =>
      b.effective_from.localeCompare(a.effective_from)
    )
    const current = assignments.find(
      (assignment) =>
        assignment.effective_from <= today &&
        (!assignment.effective_to || assignment.effective_to >= today)
    )
    const scheduled = [...assignments]
      .filter((assignment) => assignment.effective_from > today)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
    const historical = assignments.find((assignment) => assignment.effective_to && assignment.effective_to < today)
    const primaryAssignment = current || historical || null
    const primaryStatus = current ? 'Current' : historical ? 'Historical' : 'Missing'
    const manager = user.manager_user_id ? usersById.get(user.manager_user_id) : undefined
    const directReports = users.filter((candidate) => candidate.manager_user_id === user.id)

    const overlays = (['setter', 'closer'] as const).flatMap((lane) => {
      const rows = managementOverlayAssignments
        .filter((row) => row.user_id === user.id && row.lane === lane)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
      const active = rows.find(
        (row) => row.effective_from <= today && (!row.effective_to || row.effective_to >= today)
      )
      const scheduled = [...rows]
        .filter((row) => row.effective_from > today)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
      const historical = rows.find((row) => row.effective_to && row.effective_to < today)
      return [
        active
          ? { assignment: active, status: active.ended_at ? 'Ending' as const : 'Current' as const }
          : null,
        scheduled ? { assignment: scheduled, status: 'Scheduled' as const } : null,
        !active && !scheduled && historical
          ? { assignment: historical, status: 'Historical' as const }
          : null,
      ].flatMap((item) => {
        if (!item) return []
        const rateDate = item.status === 'Current' || item.status === 'Ending'
          ? today
          : item.status === 'Scheduled'
            ? item.assignment.effective_from
            : item.assignment.effective_to || item.assignment.effective_from
        const version = managementOverlayVersions
          .filter(
            (row) =>
              row.comp_plan_id === item.assignment.comp_plan_id &&
              row.lane === lane &&
              row.effective_from <= rateDate
          )
          .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
        return [{ ...item, rate: version?.override_percent ?? null }]
      })
    })

    return { user, manager, directReports, primaryAssignment, primaryStatus, scheduledPrimary: scheduled, overlays }
  })

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
            <p className="mt-1" style={{ color: INK }}>
              Manage commission structures and assignments
            </p>
            <p className="mt-1 text-sm" style={{ color: INK }}>
              The 1.5% inspection commission is org-wide, not per plan —{' '}
              <Link href="/admin/payroll" className="text-indigo-700 underline">
                set it on Payroll
              </Link>
              .
            </p>
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
                      {plan.plan_purpose === 'management_overlay' && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded-full">Management Overlay</span>
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
                  {plan.is_manager_plan && plan.plan_purpose !== 'management_overlay' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Management overlay pay is configured separately from this primary sales plan.
                      Legacy team-override settings are not shown as payroll status.
                    </div>
                  )}

                  {plan.plan_purpose === 'management_overlay' && (
                    <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">
                      Fixed setter or closer rate is versioned when this overlay is assigned. No volume tiers.
                    </div>
                  )}

                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-600">Applies to</span>
                    <span className="font-medium text-right" style={{ color: INK }}>
                      {plan.applicable_roles?.length
                        ? plan.applicable_roles.map(compPlanRoleLabel).join(', ')
                        : '—'}
                    </span>
                  </div>
                </div>

                {plan.plan_purpose !== 'management_overlay' && (() => {
                  const warnings = getCompPlanPayabilityWarnings({
                    plan_type: plan.plan_type,
                    base_percentage: plan.base_percentage,
                    flat_amount: plan.flat_amount,
                    tiers: plan.tiers,
                    volume_bonuses: plan.volume_bonuses,
                    is_manager_plan: plan.is_manager_plan,
                    team_override_enabled: plan.team_override_enabled,
                    team_overrides: plan.team_overrides,
                  })
                  if (!hasBlockingCompPlanWarning(warnings)) return null
                  return (
                    <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
                      <p className="text-xs font-semibold" style={{ color: '#7f1d1d' }}>
                        Pays $0 on the payroll export
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: '#7f1d1d' }}>
                        {warnings.find((w) => w.level === 'blocking')?.title}. Anyone on this plan
                        needs their pay entered by hand.
                      </p>
                    </div>
                  )
                })()}

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
                    Deactivate
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
            <div className="mb-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setShowOverlayModal(true)}
                className="px-4 py-2 border border-purple-300 text-purple-800 bg-white rounded-lg hover:bg-purple-50 font-medium text-sm"
              >
                + Assign Management Overlay
              </button>
              <button
                onClick={() => {
                  setAssignForm((previous) => ({ ...previous, effective_from: previous.effective_from || tomorrowEastern }))
                  setShowAssignModal(true)
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm"
              >
                + Assign Plan to User
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm" style={{ color: INK }}>
              Primary Sales Plan controls the user&apos;s own production. Management Overlay is separate,
              payroll-backed manager compensation; this page shows it only when the API supplies that state.
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden md:overflow-x-auto">
              <table className="block w-full md:table md:min-w-[1180px]">
                <thead className="hidden bg-gray-50 border-b md:table-header-group">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Reports To</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Direct Reports</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Primary Sales Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Management Overlay</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="block divide-y md:table-row-group">
                  {assignmentRows.map(({ user, manager, directReports, primaryAssignment, primaryStatus, scheduledPrimary, overlays }) => {
                    const managerEligible = user.role === 'setter_manager' || user.role === 'sales_manager'
                    return (
                    <tr key={user.id} className="block p-4 hover:bg-gray-50 align-top md:table-row md:p-0">
                      <td className="block px-0 py-2 md:table-cell md:px-6 md:py-4">
                        <div className="font-medium text-gray-900">{user.full_name}</div>
                        <div className="mt-1 text-xs text-gray-500">{compPlanRoleLabel(user.role)}</div>
                      </td>
                      <td className="block px-0 py-2 text-sm md:table-cell md:px-6 md:py-4">
                        <div className="mb-1 text-xs font-medium uppercase text-gray-500 md:hidden">Current Reports To</div>
                        {manager ? (
                          <span className="text-gray-900">{manager.full_name}</span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="block px-0 py-2 text-sm text-gray-700 md:table-cell md:px-6 md:py-4">
                        <div className="mb-1 text-xs font-medium uppercase text-gray-500 md:hidden">Current Direct Reports</div>
                        <div className="font-medium">{directReports.length}</div>
                        {directReports.length > 0 && (
                          <div className="mt-1 max-w-[220px] text-xs text-gray-500">
                            {directReports.map((report) => report.full_name).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="block px-0 py-2 text-sm md:table-cell md:px-6 md:py-4">
                        <div className="mb-1 text-xs font-medium uppercase text-gray-500 md:hidden">Primary Sales Plan</div>
                        {primaryAssignment ? (
                          <>
                            <div className="font-medium text-gray-900">
                              {primaryAssignment.comp_plans?.name || 'Unknown plan'}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {formatEffectiveRange(primaryAssignment.effective_from, primaryAssignment.effective_to)}
                            </div>
                            <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              primaryStatus === 'Current'
                                ? 'bg-green-100 text-green-800'
                                : primaryStatus === 'Scheduled'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-700'
                            }`}>
                              {primaryStatus}
                            </span>
                            {primaryAssignment.override_percentage != null && (
                              <div className="mt-1 text-xs text-gray-500">
                                Personal plan rate override: {primaryAssignment.override_percentage}%
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                            Missing primary plan
                          </span>
                        )}
                        {scheduledPrimary && (
                          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                            <div className="font-medium text-gray-900">
                              Next: {scheduledPrimary.comp_plans?.name || 'Unknown plan'}
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              {formatEffectiveRange(scheduledPrimary.effective_from, scheduledPrimary.effective_to)}
                            </div>
                            <span className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                              Scheduled
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="block px-0 py-2 text-sm md:table-cell md:px-6 md:py-4">
                        <div className="mb-1 text-xs font-medium uppercase text-gray-500 md:hidden">Management Overlay</div>
                        {!managerEligible ? (
                          <span className="text-gray-400">Not eligible for this role</span>
                        ) : overlays.length > 0 ? (
                          <div className="space-y-3">
                            {overlays.map(({ assignment, rate, status }) => (
                              <div key={assignment.id} className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2">
                                <div className="font-medium text-gray-900">
                                  {assignment.lane === 'setter' ? 'Setter Manager' : 'Sales Manager'} · {rate ?? '—'}%
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                  {assignment.comp_plans?.name || 'Unknown overlay plan'} · {status}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  {formatEffectiveRange(assignment.effective_from, assignment.effective_to)}
                                </div>
                                {status === 'Ending' && (
                                  <div className="mt-1 text-xs font-medium text-amber-700">
                                    Ends {assignment.effective_to}{assignment.end_reason ? ` · ${assignment.end_reason}` : ''}
                                  </div>
                                )}
                                {status === 'Current' && (
                                  <button
                                    onClick={() => endManagementOverlay(assignment.id)}
                                    className="mt-2 text-xs font-medium text-red-700 hover:text-red-900"
                                  >
                                    End overlay
                                  </button>
                                )}
                                {status === 'Scheduled' && (
                                  <button
                                    onClick={() => cancelManagementOverlay(assignment.id)}
                                    className="mt-2 text-xs font-medium text-red-700 hover:text-red-900"
                                  >
                                    Cancel scheduled
                                  </button>
                                )}
                              </div>
                            ))}
                            {directReports.length === 0 && (
                              <div className="mt-2 text-xs font-medium text-amber-700">No eligible direct reports currently</div>
                            )}
                          </div>
                        ) : (
                          <>
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                              No management overlay
                            </span>
                            <div className="mt-2 text-xs text-gray-500">
                              {directReports.length > 0
                                ? 'Hierarchy is ready; assign a setter or closer overlay.'
                                : 'No direct reports are assigned.'}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="block px-0 py-2 text-left md:table-cell md:px-6 md:py-4 md:text-right">
                        <div className="flex flex-wrap gap-3 md:justify-end">
                        {primaryAssignment && primaryStatus === 'Current' && (
                          <button
                            onClick={() => deleteAssignment(primaryAssignment.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            End plan
                          </button>
                        )}
                        {scheduledPrimary && (
                          <button
                            onClick={() => deleteAssignment(scheduledPrimary.id, true)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Cancel scheduled
                          </button>
                        )}
                        {!primaryAssignment && !scheduledPrimary && (
                          <button
                            onClick={() => {
                              setAssignForm((previous) => ({ ...previous, user_id: user.id }))
                              setAssignForm((previous) => ({ ...previous, effective_from: previous.effective_from || tomorrowEastern }))
                              setShowAssignModal(true)
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm"
                          >
                            Assign plan
                          </button>
                        )}
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No active users available
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plan Purpose</label>
                  <select
                    value={planForm.plan_purpose}
                    onChange={(e) => setPlanForm((previous) => ({
                      ...previous,
                      plan_purpose: e.target.value as CompPlan['plan_purpose'],
                      is_manager_plan: e.target.value === 'management_overlay' ? true : previous.is_manager_plan,
                      is_default: e.target.value === 'management_overlay' ? false : previous.is_default,
                    }))}
                    disabled={Boolean(editingPlan)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                  >
                    <option value="primary">Primary Sales Plan</option>
                    <option value="management_overlay">Management Overlay</option>
                  </select>
                  <p className="mt-1 text-xs" style={{ color: INK }}>
                    {planForm.plan_purpose === 'management_overlay'
                      ? 'Additional fixed-rate manager pay. Its setter or closer lane is selected when assigned.'
                      : 'Pays the user for their own eligible production.'}
                  </p>
                </div>

                {planForm.plan_purpose === 'management_overlay' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fixed Override Rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={planForm.base_percentage}
                      onChange={(e) => setPlanForm((previous) => ({ ...previous, base_percentage: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="1.00"
                    />
                    <p className="mt-1 text-xs text-gray-600">Plan-owned fixed rate; no volume tiers. Create a new future plan to change it after assignment.</p>
                  </div>
                )}

                {planForm.plan_purpose === 'primary' && (
                  <>
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
                  <p className="mt-1 text-xs" style={{ color: INK }}>
                    {planTypePaysCommission(planForm.plan_type)
                      ? 'Percentage, tiered, and flat-rate plans are calculated automatically on the payroll export.'
                      : 'This plan type is not calculated by payroll — see the warning below.'}
                  </p>
                </div>

                {planWarnings.length > 0 && <CompPlanWarningList warnings={planWarnings} />}

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
                  <p className="text-sm font-medium" style={{ color: INK }}>Applies to</p>
                  <p className="text-xs" style={{ color: INK }}>
                    Labels are the published ladder rungs; the grey text is the actual{' '}
                    <code>users.role</code> value. This is a label for admins — pay comes from the
                    plan assigned to each person on the User Assignments tab.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {COMP_PLAN_ROLE_OPTIONS.map(({ role, label, note }) => (
                      <label key={role} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={planForm.applicable_roles.includes(role)}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setPlanForm(prev => {
                              const next = checked
                                ? [...prev.applicable_roles, role]
                                : prev.applicable_roles.filter(r => r !== role)
                              const isManager = next.some(isCompPlanManagerRole)
                              return { ...prev, applicable_roles: next, is_manager_plan: isManager }
                            })
                          }}
                          className="mt-0.5 w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm leading-snug" style={{ color: INK }}>
                          {label}{' '}
                          <span className="font-mono text-xs text-gray-600">{role}</span>
                          {note && (
                            <span className="block text-xs text-gray-600">{note}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* Roles saved on this plan that are not offered above — surfaced so an
                      admin can see (and remove) them instead of them being invisibly kept. */}
                  {planForm.applicable_roles.filter((r) => !isKnownCompPlanRole(r)).length > 0 && (
                    <div className="pt-1">
                      <p className="text-xs font-medium" style={{ color: INK }}>
                        Other roles already saved on this plan
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {planForm.applicable_roles
                          .filter((r) => !isKnownCompPlanRole(r))
                          .map((r) => (
                            <span
                              key={r}
                              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-mono"
                              style={{ color: INK }}
                            >
                              {r}
                              <button
                                type="button"
                                aria-label={`Remove ${r}`}
                                onClick={() =>
                                  setPlanForm(prev => {
                                    const next = prev.applicable_roles.filter(x => x !== r)
                                    return {
                                      ...prev,
                                      applicable_roles: next,
                                      is_manager_plan: next.some(isCompPlanManagerRole),
                                    }
                                  })
                                }
                                className="text-gray-600 hover:text-red-700"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* What this plan cannot express */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-semibold" style={{ color: INK }}>
                    Set elsewhere, not here
                  </p>
                  <ul className="mt-1 space-y-1 text-xs" style={{ color: INK }}>
                    <li>
                      <strong>Inspection commission (1.5%)</strong> — one org-wide rate, set on{' '}
                      <Link href="/admin/payroll" className="text-indigo-700 underline">
                        Payroll
                      </Link>
                      . It is not part of any comp plan.
                    </li>
                    <li>
                      <strong>The Field Marketer $500/week floor</strong> — this builder has no
                      &ldquo;greater of&rdquo; / floor field. The floor is the separate setter-ramp
                      program, which tops a rep up to the floor when the week&apos;s commission
                      falls short. Set the 3% here and run the floor there.
                    </li>
                  </ul>
                </div>

                {/* Manager Plan Toggle (auto-set by role selection, kept for manager-specific options) */}
                <div className="hidden">
                  <input type="checkbox" checked={planForm.is_manager_plan} readOnly />
                </div>

                {/* Legacy manager-plan fields are retained as read-only history only. */}
                {planForm.is_manager_plan && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                    <h4 className="text-sm font-semibold text-purple-900">Manager compensation</h4>
                    <p className="mt-1 text-xs text-purple-800">
                      New manager pay is configured through Management Overlay assignments. Legacy
                      personal-sales and team-override fields cannot be edited here.
                    </p>
                    {editingPlan && (planForm.team_override_enabled || planForm.team_overrides.length > 0) && (
                      <div className="mt-3 rounded-md bg-white px-3 py-2 text-xs text-gray-700">
                        Legacy values retained: personal sales {planForm.personal_sales_enabled ? 'enabled' : 'disabled'};
                        team override {planForm.team_override_enabled ? 'enabled' : 'disabled'};
                        {' '}{planForm.team_overrides.length} legacy tier{planForm.team_overrides.length === 1 ? '' : 's'}.
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

                  </>
                )}

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
                  {planForm.plan_purpose === 'primary' && <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={planForm.is_default}
                      onChange={(e) => setPlanForm(prev => ({ ...prev, is_default: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Default Plan</span>
                  </label>}
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
                    onChange={(e) => setAssignForm(prev => ({
                      ...prev,
                      user_id: e.target.value,
                      comp_plan_id: '',
                    }))}
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
                    {compPlans.filter((plan) => {
                      if (!plan.is_active || plan.plan_purpose === 'management_overlay') return false
                      const selectedUser = users.find((user) => user.id === assignForm.user_id)
                      return !selectedUser || plan.applicable_roles.includes(selectedUser.role)
                    }).map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                  {assignForm.user_id && compPlans.every((plan) => {
                    const selectedUser = users.find((user) => user.id === assignForm.user_id)
                    return !plan.is_active || plan.plan_purpose === 'management_overlay' || !selectedUser || !plan.applicable_roles.includes(selectedUser.role)
                  }) && (
                    <p className="mt-1 text-xs text-amber-700">No active primary plan applies to this user&apos;s role.</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
                  <input
                    type="date"
                    min={tomorrowEastern}
                    value={assignForm.effective_from}
                    onChange={(e) => setAssignForm(prev => ({ ...prev, effective_from: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <p className="mt-1 text-xs text-gray-600">Changes begin no earlier than tomorrow and never rewrite prior sales.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Personal Plan Rate Override (%) <span className="text-gray-400 font-normal">- Optional</span>
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Change Reason</label>
                  <textarea
                    value={assignForm.change_reason}
                    onChange={(e) => setAssignForm((previous) => ({ ...previous, change_reason: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Example: Assign 2026 closer plan"
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
                  disabled={!assignForm.user_id || !assignForm.comp_plan_id || !assignForm.change_reason.trim() || !assignForm.effective_from}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Management Overlay Assignment Modal */}
        {showOverlayModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">Assign Management Overlay</h2>
                <p className="mt-1 text-sm" style={{ color: INK }}>
                  This is additional manager pay and does not replace the user&apos;s primary sales plan.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
                  <select
                    value={overlayForm.user_id}
                    onChange={(e) => setOverlayForm((previous) => ({ ...previous, user_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select manager...</option>
                    {users.filter((user) =>
                      overlayForm.lane === 'setter'
                        ? user.role === 'setter_manager'
                        : user.role === 'sales_manager'
                    ).map((user) => (
                      <option key={user.id} value={user.id}>{user.full_name} ({compPlanRoleLabel(user.role)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Management Overlay Plan</label>
                  <select
                    value={overlayForm.comp_plan_id}
                    onChange={(e) => setOverlayForm((previous) => ({ ...previous, comp_plan_id: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select overlay plan...</option>
                    {compPlans.filter((plan) => plan.is_active && plan.plan_purpose === 'management_overlay').map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.name}</option>
                    ))}
                  </select>
                  {compPlans.every((plan) => plan.plan_purpose !== 'management_overlay') && (
                    <p className="mt-1 text-xs text-amber-700">Create a Management Overlay plan first.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Production Lane</label>
                  <select
                    value={overlayForm.lane}
                    onChange={(e) => setOverlayForm((previous) => ({
                      ...previous,
                      lane: e.target.value as 'setter' | 'closer',
                      user_id: '',
                    }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="setter">Setter production</option>
                    <option value="closer">Closer production</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-600">Pays on eligible direct-report production and the manager&apos;s own production in this lane.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plan Rate</label>
                  <div className="w-full px-4 py-2 border border-gray-200 bg-gray-50 rounded-lg text-gray-900">
                    {(() => {
                      const selected = compPlans.find((plan) => plan.id === overlayForm.comp_plan_id)
                      return selected ? `${Number(selected.base_percentage || 0).toFixed(2)}%` : 'Select an overlay plan'
                    })()}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">This fixed, no-tier rate belongs to the overlay plan and applies to everyone assigned that plan. Create a new plan to change the rate.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
                  <input
                    type="date"
                    min={tomorrowEastern}
                    value={overlayForm.effective_from}
                    onChange={(e) => setOverlayForm((previous) => ({ ...previous, effective_from: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <p className="mt-1 text-xs text-gray-600">New overlay changes begin no earlier than tomorrow and never rewrite earlier sales.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Change Reason</label>
                  <textarea
                    value={overlayForm.change_reason}
                    onChange={(e) => setOverlayForm((previous) => ({ ...previous, change_reason: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Example: Assign 2026 setter manager overlay"
                  />
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button onClick={() => setShowOverlayModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900">Cancel</button>
                <button
                  onClick={saveManagementOverlay}
                  disabled={!overlayForm.user_id || !overlayForm.comp_plan_id || !overlayForm.change_reason.trim()}
                  className="px-4 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-800 disabled:opacity-50"
                >
                  Schedule Overlay
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
