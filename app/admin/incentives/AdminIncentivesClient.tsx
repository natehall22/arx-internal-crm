'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  SpiffProgram,
  SpiffAchievement,
  IncentiveCycle,
  IncentiveBadge,
  UserBadge,
  SpiffTriggerMetric,
  SpiffRewardType,
  SpiffStatus,
  IncentiveCycleCadence,
  BadgeCriteriaType,
} from '@/lib/types/incentive'

// ─── helpers ────────────────────────────────────────────────────────────────

const TRIGGER_METRIC_LABELS: Record<SpiffTriggerMetric, string> = {
  inspections_set: 'Inspections Set',
  inspections_sat: 'Inspections Sat',
  closed_sales: 'Closed Sales',
  closed_revenue: 'Closed Revenue ($)',
  doors_knocked: 'Doors Knocked',
  close_rate: 'Close Rate (%)',
  upgrade_attached: 'Upgrade Attached',
}

const THRESHOLD_LABELS: Record<SpiffTriggerMetric, string> = {
  inspections_set: 'Number of inspections',
  inspections_sat: 'Number of sat inspections',
  closed_sales: 'Number of closed sales',
  closed_revenue: 'Revenue target ($)',
  doors_knocked: 'Number of doors knocked',
  close_rate: 'Close rate target (%)',
  upgrade_attached: 'Number of upgrades attached',
}

const BADGE_CRITERIA_LABELS: Record<BadgeCriteriaType, string> = {
  first_inspection_set: 'First Inspection Set',
  first_closed_sale: 'First Closed Sale',
  inspections_set_milestone: 'Inspections Set Milestone',
  closed_sales_milestone: 'Closed Sales Milestone',
  streak_weekly_inspections: 'Streak: Weekly Inspections',
  streak_weekly_sales: 'Streak: Weekly Sales',
  close_rate_threshold: 'Close Rate Threshold',
  spiff_winner: 'Heat Winner',
  top_leaderboard: 'Top Leaderboard',
}

const ELIGIBLE_ROLE_OPTIONS = [
  { value: 'setter', label: 'Field Marketer / Setter' },
  { value: 'sales_rep', label: 'Closer' },
  { value: 'sales_manager', label: 'Sales Manager' },
]

const CRITERIA_VALUE_REQUIRED: BadgeCriteriaType[] = [
  'inspections_set_milestone',
  'closed_sales_milestone',
  'streak_weekly_inspections',
  'streak_weekly_sales',
  'close_rate_threshold',
]

function statusBadge(status: SpiffStatus) {
  const classes: Record<SpiffStatus, string> = {
    draft: 'bg-gray-100 text-gray-600',
    active: 'bg-green-100 text-green-700',
    completed: 'bg-blue-100 text-blue-700',
    cancelled: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-1 text-xs rounded-full font-medium ${classes[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ─── types ───────────────────────────────────────────────────────────────────

interface SimpleUser {
  id: string
  full_name: string
  role: string
}

interface SpiffFormState {
  name: string
  description: string
  trigger_metric: SpiffTriggerMetric
  threshold: string
  reward_type: SpiffRewardType
  reward_amount: string
  reward_note: string
  eligible_roles: string[]
  is_public: boolean
  starts_at: string
  ends_at: string
  status: SpiffStatus
}

interface CycleFormState {
  cadence: IncentiveCycleCadence
  label: string
  starts_at: string
  ends_at: string
}

interface BadgeFormState {
  name: string
  description: string
  icon_key: string
  color_hex: string
  criteria_type: BadgeCriteriaType
  criteria_value: string
  is_active: boolean
}

// ─── defaults ────────────────────────────────────────────────────────────────

function defaultSpiffForm(): SpiffFormState {
  const today = new Date().toISOString().split('T')[0]
  const oneWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  return {
    name: '',
    description: '',
    trigger_metric: 'inspections_set',
    threshold: '',
    reward_type: 'cash',
    reward_amount: '',
    reward_note: '',
    eligible_roles: [],
    is_public: true,
    starts_at: today,
    ends_at: oneWeek,
    status: 'draft',
  }
}

function defaultCycleForm(): CycleFormState {
  const today = new Date().toISOString().split('T')[0]
  const oneWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  return {
    cadence: 'weekly',
    label: '',
    starts_at: today,
    ends_at: oneWeek,
  }
}

function defaultBadgeForm(): BadgeFormState {
  return {
    name: '',
    description: '',
    icon_key: 'star',
    color_hex: '#F59E0B',
    criteria_type: 'first_inspection_set',
    criteria_value: '',
    is_active: true,
  }
}

// ─── SPIFF wizard step components ────────────────────────────────────────────

function SpiffStep1({
  form,
  setForm,
}: {
  form: SpiffFormState
  setForm: React.Dispatch<React.SetStateAction<SpiffFormState>>
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900">Step 1 — What are we rewarding?</h3>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          placeholder="e.g., June Inspection Blitz"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          rows={2}
          placeholder="Short description shown to the team"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Trigger metric</label>
        <select
          value={form.trigger_metric}
          onChange={(e) =>
            setForm((p) => ({ ...p, trigger_metric: e.target.value as SpiffTriggerMetric }))
          }
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
        >
          {(Object.entries(TRIGGER_METRIC_LABELS) as [SpiffTriggerMetric, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {THRESHOLD_LABELS[form.trigger_metric]}
        </label>
        <input
          type="number"
          value={form.threshold}
          onChange={(e) => setForm((p) => ({ ...p, threshold: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          placeholder="e.g., 10"
          min="0"
          step={form.trigger_metric === 'close_rate' ? '0.1' : '1'}
        />
      </div>
    </div>
  )
}

function SpiffStep2({
  form,
  setForm,
}: {
  form: SpiffFormState
  setForm: React.Dispatch<React.SetStateAction<SpiffFormState>>
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900">Step 2 — What is the reward?</h3>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Reward type</label>
        <div className="flex gap-3">
          {(['cash', 'gift_card', 'recognition'] as SpiffRewardType[]).map((rt) => (
            <button
              key={rt}
              type="button"
              onClick={() => setForm((p) => ({ ...p, reward_type: rt }))}
              className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium ${
                form.reward_type === rt
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {rt === 'cash' ? 'Cash' : rt === 'gift_card' ? 'Gift Card' : 'Recognition Only'}
            </button>
          ))}
        </div>
      </div>
      {form.reward_type !== 'recognition' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reward amount ($)
          </label>
          <input
            type="number"
            value={form.reward_amount}
            onChange={(e) => setForm((p) => ({ ...p, reward_amount: e.target.value }))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            placeholder="e.g., 100"
            min="0"
            step="1"
          />
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reward note <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={form.reward_note}
          onChange={(e) => setForm((p) => ({ ...p, reward_note: e.target.value }))}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          placeholder='e.g., "Amazon gift card via manager"'
        />
      </div>
    </div>
  )
}

function SpiffStep3({
  form,
  setForm,
}: {
  form: SpiffFormState
  setForm: React.Dispatch<React.SetStateAction<SpiffFormState>>
}) {
  const toggleRole = (role: string) => {
    setForm((p) => ({
      ...p,
      eligible_roles: p.eligible_roles.includes(role)
        ? p.eligible_roles.filter((r) => r !== role)
        : [...p.eligible_roles, role],
    }))
  }

  const setAllRoles = () => {
    setForm((p) => ({
      ...p,
      eligible_roles:
        p.eligible_roles.length === ELIGIBLE_ROLE_OPTIONS.length
          ? []
          : ELIGIBLE_ROLE_OPTIONS.map((o) => o.value),
    }))
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900">Step 3 — Who and when?</h3>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Eligible roles{' '}
          <span className="font-normal text-gray-400">(empty = all roles eligible)</span>
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.eligible_roles.length === ELIGIBLE_ROLE_OPTIONS.length}
              onChange={setAllRoles}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600"
            />
            <span className="text-sm font-medium text-gray-700">All Roles</span>
          </label>
          {ELIGIBLE_ROLE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={form.eligible_roles.includes(opt.value)}
                onChange={() => toggleRole(opt.value)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_public}
            onChange={(e) => setForm((p) => ({ ...p, is_public: e.target.checked }))}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-700">Visible on leaderboard</span>
            <p className="text-xs text-gray-500">Team members can see this Heat and their progress</p>
          </div>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
          <input
            type="date"
            value={form.starts_at}
            onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
          <input
            type="date"
            value={form.ends_at}
            onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>
    </div>
  )
}

function SpiffStep4({
  form,
}: {
  form: SpiffFormState
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900">Step 4 — Review + Publish</h3>
      <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Name</span>
          <span className="font-medium text-gray-900">{form.name || '—'}</span>
        </div>
        {form.description && (
          <div className="flex justify-between">
            <span className="text-gray-500">Description</span>
            <span className="font-medium text-gray-900 max-w-xs text-right">{form.description}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">Metric</span>
          <span className="font-medium text-gray-900">
            {TRIGGER_METRIC_LABELS[form.trigger_metric]}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Threshold</span>
          <span className="font-medium text-gray-900">{form.threshold || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Reward</span>
          <span className="font-medium text-gray-900">
            {form.reward_type === 'recognition'
              ? 'Recognition Only'
              : `${form.reward_type === 'cash' ? 'Cash' : 'Gift Card'} — $${form.reward_amount || '0'}`}
          </span>
        </div>
        {form.reward_note && (
          <div className="flex justify-between">
            <span className="text-gray-500">Note</span>
            <span className="font-medium text-gray-900">{form.reward_note}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">Eligible roles</span>
          <span className="font-medium text-gray-900">
            {form.eligible_roles.length === 0
              ? 'All roles'
              : form.eligible_roles
                  .map((r) => ELIGIBLE_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r)
                  .join(', ')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Leaderboard</span>
          <span className="font-medium text-gray-900">{form.is_public ? 'Visible' : 'Hidden'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Dates</span>
          <span className="font-medium text-gray-900">
            {form.starts_at} → {form.ends_at}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

interface Props {
  currentUserId: string
}

export default function AdminIncentivesClient({ currentUserId }: Props) {
  const [activeTab, setActiveTab] = useState<'spiffs' | 'cycles' | 'badges'>('spiffs')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // data
  const [spiffs, setSpiffs] = useState<SpiffProgram[]>([])
  const [cycles, setCycles] = useState<IncentiveCycle[]>([])
  const [badges, setBadges] = useState<IncentiveBadge[]>([])
  const [users, setUsers] = useState<SimpleUser[]>([])

  // spiff filter
  const [spiffFilter, setSpiffFilter] = useState<SpiffStatus | 'all'>('all')

  // spiff modal
  const [showSpiffModal, setShowSpiffModal] = useState(false)
  const [spiffStep, setSpiffStep] = useState(1)
  const [editingSpiff, setEditingSpiff] = useState<SpiffProgram | null>(null)
  const [spiffForm, setSpiffForm] = useState<SpiffFormState>(defaultSpiffForm())
  const [spiffSaving, setSpiffSaving] = useState(false)

  // cycle modal
  const [showCycleModal, setShowCycleModal] = useState(false)
  const [cycleForm, setCycleForm] = useState<CycleFormState>(defaultCycleForm())
  const [cycleSaving, setCycleSaving] = useState(false)

  // lock payout modal
  const [showPayoutModal, setShowPayoutModal] = useState(false)
  const [payoutCycle, setPayoutCycle] = useState<IncentiveCycle | null>(null)
  const [payoutAchievements, setPayoutAchievements] = useState<SpiffAchievement[]>([])
  const [payoutLoading, setPayoutLoading] = useState(false)

  // badge modal
  const [showBadgeModal, setShowBadgeModal] = useState(false)
  const [editingBadge, setEditingBadge] = useState<IncentiveBadge | null>(null)
  const [badgeForm, setBadgeForm] = useState<BadgeFormState>(defaultBadgeForm())
  const [badgeSaving, setBadgeSaving] = useState(false)
  const [seedBadgesSaving, setSeedBadgesSaving] = useState(false)

  // award badge modal
  const [showAwardModal, setShowAwardModal] = useState(false)
  const [awardBadge, setAwardBadge] = useState<IncentiveBadge | null>(null)
  const [awardUserId, setAwardUserId] = useState('')
  const [awardNote, setAwardNote] = useState('')
  const [awardSaving, setAwardSaving] = useState(false)

  // ── data loading ──────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/incentives')
      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Failed to load Sisu')
        setLoading(false)
        return
      }
      const data = await res.json()
      setSpiffs(data.spiffs || [])
      setCycles(data.cycles || [])
      setBadges(data.badges || [])
      setUsers(data.users || [])
    } catch {
      setError('Failed to load Sisu')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── SPIFF actions ─────────────────────────────────────────────────────────

  const openNewSpiff = () => {
    setEditingSpiff(null)
    setSpiffForm(defaultSpiffForm())
    setSpiffStep(1)
    setShowSpiffModal(true)
  }

  const openEditSpiff = (s: SpiffProgram) => {
    setEditingSpiff(s)
    setSpiffForm({
      name: s.name,
      description: s.description ?? '',
      trigger_metric: s.trigger_metric,
      threshold: String(s.threshold),
      reward_type: s.reward_type,
      reward_amount: s.reward_amount != null ? String(s.reward_amount) : '',
      reward_note: s.reward_note ?? '',
      eligible_roles: s.eligible_roles ?? [],
      is_public: s.is_public,
      starts_at: s.starts_at.split('T')[0],
      ends_at: s.ends_at.split('T')[0],
      status: s.status,
    })
    setSpiffStep(1)
    setShowSpiffModal(true)
  }

  const validateSpiff = (): string | null => {
    if (!spiffForm.name.trim()) return 'Name is required'
    if (!spiffForm.threshold || isNaN(parseFloat(spiffForm.threshold)))
      return 'Threshold is required'
    if (spiffForm.reward_type !== 'recognition' && !spiffForm.reward_amount)
      return 'Reward amount is required'
    if (!spiffForm.starts_at || !spiffForm.ends_at) return 'Dates are required'
    if (spiffForm.starts_at > spiffForm.ends_at) return 'Start date must be before end date'
    return null
  }

  const saveSpiff = async (publishNow: boolean) => {
    const err = validateSpiff()
    if (err) {
      alert(err)
      return
    }
    setSpiffSaving(true)
    const payload = {
      resource: 'spiff_program',
      id: editingSpiff?.id,
      name: spiffForm.name,
      description: spiffForm.description || null,
      trigger_metric: spiffForm.trigger_metric,
      threshold: parseFloat(spiffForm.threshold),
      reward_type: spiffForm.reward_type,
      reward_amount:
        spiffForm.reward_type !== 'recognition' && spiffForm.reward_amount
          ? parseFloat(spiffForm.reward_amount)
          : null,
      reward_note: spiffForm.reward_note || null,
      eligible_roles: spiffForm.eligible_roles,
      is_public: spiffForm.is_public,
      starts_at: spiffForm.starts_at,
      ends_at: spiffForm.ends_at,
      status: publishNow ? 'active' : editingSpiff ? spiffForm.status : 'draft',
      created_by: currentUserId,
    }
    try {
      const res = await fetch('/api/admin/incentives', {
        method: editingSpiff ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to save Heat')
        setSpiffSaving(false)
        return
      }
      setShowSpiffModal(false)
      setEditingSpiff(null)
      setSpiffForm(defaultSpiffForm())
      loadAll()
    } catch {
      alert('Failed to save Heat')
    }
    setSpiffSaving(false)
  }

  const cancelSpiff = async (id: string) => {
    if (!confirm('Cancel this Heat? This cannot be undone.')) return
    try {
      const res = await fetch('/api/admin/incentives', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'spiff_program', id, status: 'cancelled' }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to cancel Heat')
        return
      }
      loadAll()
    } catch {
      alert('Failed to cancel Heat')
    }
  }

  // ── Cycle actions ──────────────────────────────────────────────────────────

  const openNewCycle = () => {
    setCycleForm(defaultCycleForm())
    setShowCycleModal(true)
  }

  const saveCycle = async () => {
    if (!cycleForm.label.trim()) {
      alert('Label is required')
      return
    }
    if (!cycleForm.starts_at || !cycleForm.ends_at) {
      alert('Dates are required')
      return
    }
    setCycleSaving(true)
    try {
      const res = await fetch('/api/admin/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'incentive_cycle', ...cycleForm }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to save cycle')
        setCycleSaving(false)
        return
      }
      setShowCycleModal(false)
      setCycleForm(defaultCycleForm())
      loadAll()
    } catch {
      alert('Failed to save cycle')
    }
    setCycleSaving(false)
  }

  const openPayout = async (cycle: IncentiveCycle) => {
    setPayoutCycle(cycle)
    setPayoutLoading(true)
    setShowPayoutModal(true)
    try {
      const res = await fetch(
        `/api/admin/incentives?resource=payout_queue&cycle_id=${cycle.id}`,
      )
      if (res.ok) {
        const d = await res.json()
        setPayoutAchievements(d.achievements || [])
      }
    } catch {
      // ignore
    }
    setPayoutLoading(false)
  }

  const lockCycle = async (cycle: IncentiveCycle) => {
    if (!confirm(`Lock cycle "${cycle.label}"? This will finalize the payout queue.`)) return
    try {
      const res = await fetch('/api/admin/incentives', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'incentive_cycle', id: cycle.id, lock: true }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to lock cycle')
        return
      }
      loadAll()
      if (payoutCycle?.id === cycle.id) openPayout({ ...cycle, locked_at: new Date().toISOString() })
    } catch {
      alert('Failed to lock cycle')
    }
  }

  const exportCycleCSV = (cycle: IncentiveCycle) => {
    const rows = payoutAchievements.filter((a) => a.qualified)
    if (rows.length === 0) {
      alert('No qualified winners to export')
      return
    }
    const header = 'User Name,Role,Heat Name,Payout Amount\n'
    const lines = rows.map((a) => {
      const user = users.find((u) => u.id === a.user_id)
      return [
        user?.full_name ?? a.user_id,
        user?.role ?? '',
        spiffs.find((s) => s.id === a.spiff_program_id)?.name ?? a.spiff_program_id,
        a.payout_amount ?? 0,
      ].join(',')
    })
    const csv = header + lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cycle-${cycle.label.replace(/\s+/g, '-')}-winners.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Badge actions ──────────────────────────────────────────────────────────

  const openNewBadge = () => {
    setEditingBadge(null)
    setBadgeForm(defaultBadgeForm())
    setShowBadgeModal(true)
  }

  const openEditBadge = (b: IncentiveBadge) => {
    setEditingBadge(b)
    setBadgeForm({
      name: b.name,
      description: b.description ?? '',
      icon_key: b.icon_key,
      color_hex: b.color_hex,
      criteria_type: b.criteria_type,
      criteria_value: b.criteria_value != null ? String(b.criteria_value) : '',
      is_active: b.is_active,
    })
    setShowBadgeModal(true)
  }

  const saveBadge = async () => {
    if (!badgeForm.name.trim()) {
      alert('Name is required')
      return
    }
    setBadgeSaving(true)
    const payload = {
      resource: 'incentive_badge',
      id: editingBadge?.id,
      name: badgeForm.name,
      description: badgeForm.description || null,
      icon_key: badgeForm.icon_key,
      color_hex: badgeForm.color_hex,
      criteria_type: badgeForm.criteria_type,
      criteria_value:
        CRITERIA_VALUE_REQUIRED.includes(badgeForm.criteria_type) && badgeForm.criteria_value
          ? parseFloat(badgeForm.criteria_value)
          : null,
      is_active: badgeForm.is_active,
    }
    try {
      const res = await fetch('/api/admin/incentives', {
        method: editingBadge ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to save badge')
        setBadgeSaving(false)
        return
      }
      setShowBadgeModal(false)
      setEditingBadge(null)
      setBadgeForm(defaultBadgeForm())
      loadAll()
    } catch {
      alert('Failed to save badge')
    }
    setBadgeSaving(false)
  }

  const toggleBadgeActive = async (badge: IncentiveBadge) => {
    try {
      await fetch('/api/admin/incentives', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'incentive_badge',
          id: badge.id,
          is_active: !badge.is_active,
        }),
      })
      loadAll()
    } catch {
      alert('Failed to update badge')
    }
  }

  const seedDefaultBadges = async () => {
    setSeedBadgesSaving(true)
    try {
      const res = await fetch('/api/admin/sisu/seed-badges', { method: 'POST' })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: unknown }
        alert(typeof d.error === 'string' ? d.error : 'Failed to seed default badges')
        setSeedBadgesSaving(false)
        return
      }
      loadAll()
    } catch {
      alert('Failed to seed default badges')
    }
    setSeedBadgesSaving(false)
  }

  const openAward = (badge: IncentiveBadge) => {
    setAwardBadge(badge)
    setAwardUserId('')
    setAwardNote('')
    setShowAwardModal(true)
  }

  const awardBadgeToUser = async () => {
    if (!awardBadge || !awardUserId) {
      alert('Please select a user')
      return
    }
    setAwardSaving(true)
    try {
      const res = await fetch('/api/admin/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'user_badge',
          badge_id: awardBadge.id,
          user_id: awardUserId,
          awarded_by: currentUserId,
          note: awardNote || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Failed to award badge')
        setAwardSaving(false)
        return
      }
      setShowAwardModal(false)
      setAwardBadge(null)
      loadAll()
    } catch {
      alert('Failed to award badge')
    }
    setAwardSaving(false)
  }

  // ── render ────────────────────────────────────────────────────────────────

  const filteredSpiffs =
    spiffFilter === 'all' ? spiffs : spiffs.filter((s) => s.status === spiffFilter)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg">
        {error}
      </div>
    )
  }

  return (
    <>
      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b mb-6">
        {([
          ['spiffs', `Heats (${spiffs.length})`],
          ['cycles', `Cycles (${cycles.length})`],
          ['badges', `Badges (${badges.length})`],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════ TAB: SPIFFs ═══════════════════════════ */}
      {activeTab === 'spiffs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            {/* filter pills */}
            <div className="flex gap-2">
              {(['all', 'active', 'draft', 'completed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSpiffFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                    spiffFilter === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={openNewSpiff}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm"
            >
              + New Heat
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Metric</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Threshold</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reward</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredSpiffs.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{s.name}</p>
                      {s.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{s.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {TRIGGER_METRIC_LABELS[s.trigger_metric]}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{s.threshold}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {s.reward_type === 'recognition'
                        ? 'Recognition'
                        : `$${s.reward_amount ?? 0} ${s.reward_type === 'gift_card' ? '(gift card)' : ''}`}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {s.starts_at.split('T')[0]} → {s.ends_at.split('T')[0]}
                    </td>
                    <td className="px-6 py-4">{statusBadge(s.status)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditSpiff(s)}
                          className="text-sm text-indigo-600 hover:text-indigo-800"
                        >
                          Edit
                        </button>
                        {s.status !== 'cancelled' && s.status !== 'completed' && (
                          <button
                            onClick={() => cancelSpiff(s.id)}
                            className="text-sm text-red-500 hover:text-red-700"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredSpiffs.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No Heats found{spiffFilter !== 'all' ? ` with status "${spiffFilter}"` : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════ TAB: Cycles ════════════════════════════ */}
      {activeTab === 'cycles' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={openNewCycle}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm"
            >
              + New Cycle
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cadence</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">End</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cycles.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{c.label}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 capitalize">{c.cadence}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{c.starts_at.split('T')[0]}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{c.ends_at.split('T')[0]}</td>
                    <td className="px-6 py-4">
                      {c.locked_at ? (
                        <span className="px-2 py-1 text-xs rounded-full font-medium bg-gray-200 text-gray-700">
                          Locked
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full font-medium bg-green-100 text-green-700">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!c.locked_at && (
                          <button
                            onClick={() => lockCycle(c)}
                            className="text-sm text-amber-600 hover:text-amber-800"
                          >
                            Lock Cycle
                          </button>
                        )}
                        <button
                          onClick={() => openPayout(c)}
                          className="text-sm text-indigo-600 hover:text-indigo-800"
                        >
                          {c.locked_at ? 'View Payout' : 'Payout Queue'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cycles.length === 0 && (
              <div className="text-center py-12 text-gray-500">No cycles created yet</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════ TAB: Badges ════════════════════════════ */}
      {activeTab === 'badges' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={openNewBadge}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm"
            >
              + New Badge
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {badges.map((b) => (
              <div key={b.id} className={`bg-white rounded-xl shadow-sm border p-5 ${!b.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3 mb-3">
                  {/* icon preview */}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                    style={{ backgroundColor: b.color_hex }}
                  >
                    {b.icon_key.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{b.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {BADGE_CRITERIA_LABELS[b.criteria_type]}
                      {b.criteria_value != null ? ` (${b.criteria_value})` : ''}
                    </p>
                  </div>
                  {/* active toggle */}
                  <button
                    type="button"
                    onClick={() => toggleBadgeActive(b)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      b.is_active ? 'bg-indigo-600' : 'bg-gray-200'
                    }`}
                    title={b.is_active ? 'Deactivate' : 'Activate'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        b.is_active ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {b.description && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">{b.description}</p>
                )}
                <div className="flex gap-2 pt-3 border-t">
                  <button
                    onClick={() => openEditBadge(b)}
                    className="flex-1 py-1.5 text-sm text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => openAward(b)}
                    className="flex-1 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Award Manually
                  </button>
                </div>
              </div>
            ))}
            {badges.length === 0 && (
              <div className="col-span-full text-center py-12 bg-white rounded-xl border text-gray-500">
                <p>No badges created yet</p>
                <button
                  type="button"
                  disabled={seedBadgesSaving}
                  onClick={seedDefaultBadges}
                  className="mt-4 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                >
                  {seedBadgesSaving ? 'Seeding...' : 'Seed Default Badges'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL: SPIFF wizard ══════════════════════════ */}
      {showSpiffModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {editingSpiff ? 'Edit Heat' : 'New Heat'}
              </h2>
              {/* step indicator */}
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className={`w-2 h-2 rounded-full ${
                      n === spiffStep ? 'bg-indigo-600' : n < spiffStep ? 'bg-indigo-300' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="p-6">
              {spiffStep === 1 && <SpiffStep1 form={spiffForm} setForm={setSpiffForm} />}
              {spiffStep === 2 && <SpiffStep2 form={spiffForm} setForm={setSpiffForm} />}
              {spiffStep === 3 && <SpiffStep3 form={spiffForm} setForm={setSpiffForm} />}
              {spiffStep === 4 && <SpiffStep4 form={spiffForm} />}
            </div>
            <div className="p-6 border-t flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  if (spiffStep === 1) {
                    setShowSpiffModal(false)
                  } else {
                    setSpiffStep((n) => n - 1)
                  }
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                {spiffStep === 1 ? 'Cancel' : '← Back'}
              </button>
              <div className="flex gap-3">
                {spiffStep < 4 && (
                  <button
                    onClick={() => setSpiffStep((n) => n + 1)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Next →
                  </button>
                )}
                {spiffStep === 4 && (
                  <>
                    <button
                      disabled={spiffSaving}
                      onClick={() => saveSpiff(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50"
                    >
                      {spiffSaving ? 'Saving...' : 'Save as Draft'}
                    </button>
                    <button
                      disabled={spiffSaving}
                      onClick={() => saveSpiff(true)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {spiffSaving ? 'Publishing...' : 'Publish Now'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL: New Cycle ═════════════════════════════ */}
      {showCycleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">New Sisu Cycle</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cadence</label>
                <select
                  value={cycleForm.cadence}
                  onChange={(e) =>
                    setCycleForm((p) => ({ ...p, cadence: e.target.value as IncentiveCycleCadence }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={cycleForm.label}
                  onChange={(e) => setCycleForm((p) => ({ ...p, label: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder='e.g., "Week of 2026-06-08" or "June 2026"'
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
                  <input
                    type="date"
                    value={cycleForm.starts_at}
                    onChange={(e) => setCycleForm((p) => ({ ...p, starts_at: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
                  <input
                    type="date"
                    value={cycleForm.ends_at}
                    onChange={(e) => setCycleForm((p) => ({ ...p, ends_at: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowCycleModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                Cancel
              </button>
              <button
                disabled={cycleSaving}
                onClick={saveCycle}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {cycleSaving ? 'Saving...' : 'Create Cycle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL: Payout Queue ══════════════════════════ */}
      {showPayoutModal && payoutCycle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Payout Queue — {payoutCycle.label}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {payoutCycle.locked_at
                    ? `Locked ${new Date(payoutCycle.locked_at).toLocaleDateString()}`
                    : 'Not yet locked'}
                </p>
              </div>
              <div className="flex gap-2">
                {payoutCycle.locked_at && (
                  <button
                    onClick={() => exportCycleCSV(payoutCycle)}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Export CSV
                  </button>
                )}
                {!payoutCycle.locked_at && (
                  <button
                    onClick={() => lockCycle(payoutCycle)}
                    className="px-3 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                  >
                    Lock Cycle
                  </button>
                )}
              </div>
            </div>
            <div className="p-6">
              {payoutLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                </div>
              ) : payoutAchievements.filter((a) => a.qualified).length === 0 ? (
                <p className="text-center text-gray-500 py-8">No qualified winners for this cycle yet</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Heat</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Payout</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {payoutAchievements
                      .filter((a) => a.qualified)
                      .map((a) => {
                        const user = users.find((u) => u.id === a.user_id)
                        const spiff = spiffs.find((s) => s.id === a.spiff_program_id)
                        return (
                          <tr key={a.id}>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {user?.full_name ?? a.user_id}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {spiff?.name ?? a.spiff_program_id}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{a.current_value}</td>
                            <td className="px-4 py-3 text-sm text-right font-semibold text-green-600">
                              {a.payout_amount != null ? `$${a.payout_amount}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-6 border-t flex justify-end">
              <button
                onClick={() => setShowPayoutModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL: Badge create/edit ═════════════════════ */}
      {showBadgeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">
                {editingBadge ? 'Edit Badge' : 'New Badge'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {/* preview */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: badgeForm.color_hex || '#F59E0B' }}
                >
                  {badgeForm.icon_key.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{badgeForm.name || 'Badge name'}</p>
                  <p className="text-xs text-gray-500">Preview</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={badgeForm.name}
                  onChange={(e) => setBadgeForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="e.g., Inspection All-Star"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={badgeForm.description}
                  onChange={(e) => setBadgeForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Icon key</label>
                  <input
                    type="text"
                    value={badgeForm.icon_key}
                    onChange={(e) => setBadgeForm((p) => ({ ...p, icon_key: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="star"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={badgeForm.color_hex}
                      onChange={(e) => setBadgeForm((p) => ({ ...p, color_hex: e.target.value }))}
                      className="h-10 w-12 border border-gray-300 rounded-lg cursor-pointer"
                    />
                    <input
                      type="text"
                      value={badgeForm.color_hex}
                      onChange={(e) => setBadgeForm((p) => ({ ...p, color_hex: e.target.value }))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                      placeholder="#F59E0B"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Criteria type</label>
                <select
                  value={badgeForm.criteria_type}
                  onChange={(e) =>
                    setBadgeForm((p) => ({ ...p, criteria_type: e.target.value as BadgeCriteriaType }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  {(Object.entries(BADGE_CRITERIA_LABELS) as [BadgeCriteriaType, string][]).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </div>
              {CRITERIA_VALUE_REQUIRED.includes(badgeForm.criteria_type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Criteria value
                  </label>
                  <input
                    type="number"
                    value={badgeForm.criteria_value}
                    onChange={(e) =>
                      setBadgeForm((p) => ({ ...p, criteria_value: e.target.value }))
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="e.g., 50"
                    min="0"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={badgeForm.is_active}
                  onChange={(e) => setBadgeForm((p) => ({ ...p, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                />
                <span className="text-sm text-gray-700">Active</span>
              </label>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowBadgeModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                Cancel
              </button>
              <button
                disabled={badgeSaving}
                onClick={saveBadge}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {badgeSaving ? 'Saving...' : editingBadge ? 'Update Badge' : 'Create Badge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL: Award badge ═══════════════════════════ */}
      {showAwardModal && awardBadge && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Award Badge Manually</h2>
              <p className="text-sm text-gray-500 mt-1">{awardBadge.name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select user</label>
                <select
                  value={awardUserId}
                  onChange={(e) => setAwardUserId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select a team member...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={awardNote}
                  onChange={(e) => setAwardNote(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="Why are you awarding this?"
                />
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowAwardModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                Cancel
              </button>
              <button
                disabled={!awardUserId || awardSaving}
                onClick={awardBadgeToUser}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {awardSaving ? 'Awarding...' : 'Award Badge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
