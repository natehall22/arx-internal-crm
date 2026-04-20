'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import ScheduleJobModal from '@/components/ops/ScheduleJobModal'
import JobPaymentsCard from '@/components/ops/JobPaymentsCard'
import JobInvoicesCard from '@/components/ops/JobInvoicesCard'
import CompleteJobModal from '@/components/ops/CompleteJobModal'
import JobNextActionBanner from '@/components/ops/JobNextActionBanner'
import JobReadyToPayBanner from '@/components/ops/JobReadyToPayBanner'
import JobPayrollSentBanner from '@/components/ops/JobPayrollSentBanner'
import AINextActionBanner from '@/components/jobs/AINextActionBanner'
import AINoteSummary from '@/components/jobs/AINoteSummary'
import LinkCustomerButton from '@/components/customers/LinkCustomerButton'
import JobWorkOrdersCard from '@/components/ops/JobWorkOrdersCard'
import SoldScopeCard from '@/components/ops/SoldScopeCard'
import JobMaterialsCard from '@/components/ops/JobMaterialsCard'
import FinalPhotosCard from '@/components/ops/FinalPhotosCard'
import JobFileWorkspaceCard from '@/components/ops/JobFileWorkspaceCard'
import OperationsSnapshotCard from '@/components/ops/OperationsSnapshotCard'
import ChangeOrdersSection from '@/components/change-orders/ChangeOrdersSection'
import PayrollAttributionEditor from '@/components/payroll/PayrollAttributionEditor'
import { JobPaymentSummary } from '@/lib/types/job-payments'
import { buildCommissionPayrollSnapshot, SALES_COMMISSION_POOL_RATE } from '@/lib/commission-payroll'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected' | 'on_hold'

interface Job {
  id: string
  org_id: string
  project_id: string
  job_number: string
  status: JobStatus
  job_type: string
  address_text: string
  sale_amount: number | null
  deposit: number | null
  deposit_required_percent: number | null
  finance_submitted_at: string | null
  payroll_sent_at?: string | null
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
  dealer_fee_amount?: number | null
  // Insurance
  job_source?: 'retail' | 'insurance'
  insurance_stage?: string | null
  acv_amount?: number | null
  depreciation_amount?: number | null
  supplement_amount?: number | null
  claim_number?: string | null
  insurance_company?: string | null
  final_front: boolean
  final_back: boolean
  final_left: boolean
  final_right: boolean
  final_slope_1: boolean
  final_slope_2: boolean
  flashing_detail: boolean
  pipe_boots: boolean
  before_photos: string[]
  progress_photos: string[]
  after_photos: string[]
  created_at: string
  accepted_proposal_id?: string | null
  accepted_estimate_id?: string | null
  linked_proposal_id?: string | null
  opportunity_id?: string | null
  payroll_attribution?: {
    opportunity_id: string
    setter_user_id: string | null
    closer_user_id: string | null
    setter_name: string | null
    closer_name: string | null
  } | null
  special_instructions?: string | null
  assigned_crew?: { id: string; name: string; color: string; phone: string } | null
  assigned_sub?: { id: string; company_name: string; contact_name: string; phone: string } | null
  customer?: { id: string; name: string; phone: string; email: string } | null
  salesperson?: { id: string; full_name: string } | null
  project?: {
    id: string
    scope_of_work: string | null
    product_summary: string | null
    ops_notes: string | null
    permits_status?: string | null
    install_date?: string | null
    /** Latest project review questionnaire JSON (all fields shown in Operations Snapshot) */
    project_review?: unknown
    payment_method?: string | null
  } | null
  installation_agreement?: { pdf_url: string | null; status: string } | null
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
  not_ordered: { label: 'Not Ordered', color: 'text-gray-700' },
  ordered: { label: 'Ordered', color: 'text-blue-600' },
  partial: { label: 'Partial', color: 'text-amber-600' },
  received: { label: 'Received', color: 'text-green-600' },
}

/** First incomplete pipeline stage index (0–4), or 4 when fully done. */
function depositMilestoneMet(job: Job): boolean {
  if (job.status !== 'sold') return true
  const sale = job.sale_amount
  if (!sale || sale <= 0) return true
  const pct = job.deposit_required_percent
  if (pct == null || pct <= 0) return (job.deposit ?? 0) > 0
  const required = sale * (pct / 100)
  return (job.deposit ?? 0) >= required - 0.005
}

function getJobPipelineCurrentIndex(job: Job): number {
  const d1 = depositMilestoneMet(job)
  const d2 = !!job.scheduled_date
  const d3 =
    job.status === 'in_progress' ||
    !!job.started_at ||
    job.status === 'complete' ||
    job.status === 'collected'
  const d4 = job.status === 'complete' || job.status === 'collected' || !!job.completed_at
  const done = [true, d1, d2, d3, d4]
  const firstOpen = done.findIndex((v) => !v)
  return firstOpen === -1 ? 4 : firstOpen
}

const PIPELINE_STAGES = ['Sold', 'Deposit', 'Scheduled', 'In Progress', 'Complete'] as const

type WorkflowBtnId = 'schedule' | 'materials' | 'materialsReady' | 'startJob' | 'complete' | 'collected'

function getWorkflowPrimaryAndSecondaryIds(job: Job): { primary: WorkflowBtnId; secondary: WorkflowBtnId[] } {
  const show: Record<WorkflowBtnId, boolean> = {
    schedule: true,
    materials: job.status === 'sold',
    materialsReady: job.status === 'materials' && job.materials_status === 'received',
    startJob: job.status === 'scheduled',
    complete: job.status === 'in_progress',
    collected: job.status === 'complete',
  }
  let primary: WorkflowBtnId
  if (!job.scheduled_date) primary = 'schedule'
  else if (show.materials) primary = 'materials'
  else if (show.materialsReady) primary = 'materialsReady'
  else if (show.startJob) primary = 'startJob'
  else if (show.complete) primary = 'complete'
  else if (show.collected) primary = 'collected'
  else primary = 'schedule'

  const order: WorkflowBtnId[] = ['schedule', 'materials', 'materialsReady', 'startJob', 'complete', 'collected']
  const secondary = order.filter((id) => id !== primary && show[id])
  return { primary, secondary }
}

function renderWorkflowButton(
  job: Job,
  id: WorkflowBtnId,
  isPrimary: boolean,
    opts: {
    saving: boolean
    openScheduleModal: (mode?: 'schedule' | 'reassign') => void
    updateStatus: (newStatus: JobStatus, extraUpdates?: Record<string, unknown>) => void | Promise<void>
    handleCompleteClick: () => void
    handleCollectedClick: () => void
    canMarkCollected: boolean
    markCollectedTitle?: string
  }
) {
  const outline =
    'min-h-[44px] px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-800 disabled:opacity-50'
  const primaryIndigo =
    'min-h-[44px] px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50'
  const primaryGreen =
    'min-h-[44px] px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50'
  const primaryGray =
    'min-h-[44px] px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 text-sm font-medium disabled:opacity-50'
  const pc = isPrimary ? primaryIndigo : outline
  const pcGreen = isPrimary ? primaryGreen : outline
  const pcGray = isPrimary ? primaryGray : outline
  const { saving, openScheduleModal, updateStatus, handleCompleteClick, handleCollectedClick, canMarkCollected, markCollectedTitle } = opts

  switch (id) {
    case 'schedule':
      return (
        <button key={id} type="button" onClick={() => openScheduleModal('schedule')} className={pc}>
          {job.scheduled_date ? 'Reschedule' : 'Schedule Job'}
        </button>
      )
    case 'materials':
      return (
        <button
          key={id}
          type="button"
          onClick={() => updateStatus('materials')}
          disabled={saving}
          className={pc}
        >
          Start Material Ordering
        </button>
      )
    case 'materialsReady':
      return (
        <button
          key={id}
          type="button"
          onClick={() => updateStatus('scheduled')}
          disabled={saving}
          className={pc}
        >
          Materials Ready — Schedule Job
        </button>
      )
    case 'startJob':
      return (
        <button
          key={id}
          type="button"
          onClick={() => updateStatus('in_progress')}
          disabled={saving}
          className={pcGreen}
        >
          Start Job
        </button>
      )
    case 'complete':
      return (
        <button
          key={id}
          type="button"
          onClick={handleCompleteClick}
          disabled={saving}
          className={pcGreen}
        >
          Mark Job Complete
        </button>
      )
    case 'collected':
      return (
        <button
          key={id}
          type="button"
          onClick={handleCollectedClick}
          disabled={saving || !canMarkCollected}
          title={markCollectedTitle}
          className={pcGray}
        >
          Mark as Collected
        </button>
      )
  }
}

interface JobChangeOrdersSectionProps {
  projectId: string
  projectAddress: string
  customerName: string
  customerEmail: string | null
  originalContractAmount: number
  originalContractDate: string | null
  originalContractId: string | null
  paymentMethod: string | null
  amountCollected: number
  jobId: string
  repName: string
  changeOrders: {
    id: string
    co_number: string
    signed_at: string
    customer_signed_at: string | null
    updated_total: number
    pdf_url: string | null
    status: string
    signing_token: string | null
  }[]
}

interface JobDetailClientProps {
  initialJob: Job
  crews: Crew[]
  subs: SubContractor[]
  userRole: string
  canViewJobBilling: boolean
  canEditPayrollAttribution: boolean
  changeOrdersSection: JobChangeOrdersSectionProps | null
}

interface JobNote {
  id: string
  note: string
  is_internal: boolean
  created_at: string
  user: { full_name: string } | null
}

interface OrgUser {
  id: string
  full_name: string
}

// ─── Insurance Card ────────────────────────────────────────────────────────────
const INSURANCE_STAGES: { value: string; label: string; probability: number }[] = [
  { value: 'contingency_signed',    label: 'Contingency signed',       probability: 35 },
  { value: 'claim_filed',           label: 'Claim filed',              probability: 50 },
  { value: 'claim_approved',        label: 'Claim approved',           probability: 88 },
  { value: 'acv_received',          label: 'ACV received',             probability: 95 },
  { value: 'job_complete',          label: 'Job complete',             probability: 95 },
  { value: 'depreciation_filed',    label: 'Depreciation filed',       probability: 82 },
  { value: 'depreciation_received', label: 'Depreciation received',    probability: 100 },
  { value: 'supplements_filed',     label: 'Supplements filed',        probability: 55 },
  { value: 'fully_collected',       label: 'Fully collected',          probability: 100 },
]

function InsuranceCard({ job, onUpdate }: { job: Job; onUpdate: (fields: Partial<Job>) => void }) {
  const isInsurance = job.job_source === 'insurance'
  const [open, setOpen] = useState(isInsurance)

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">Job Source</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { onUpdate({ job_source: 'retail', insurance_stage: null }); setOpen(false) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              !isInsurance
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Retail
          </button>
          <button
            onClick={() => { onUpdate({ job_source: 'insurance' }); setOpen(true) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              isInsurance
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Insurance
          </button>
        </div>
      </div>

      {isInsurance && (
        <div className="space-y-4">
          {/* Stage */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Claim stage</label>
            <select
              value={job.insurance_stage || ''}
              onChange={e => onUpdate({ insurance_stage: e.target.value || null })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Select stage…</option>
              {INSURANCE_STAGES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {job.insurance_stage && (
              <p className="text-xs text-gray-400 mt-1">
                Forecast probability: {INSURANCE_STAGES.find(s => s.value === job.insurance_stage)?.probability ?? 0}%
              </p>
            )}
          </div>

          {/* Claim info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Claim number</label>
              <input
                type="text"
                defaultValue={job.claim_number || ''}
                onBlur={e => e.target.value !== (job.claim_number || '') && onUpdate({ claim_number: e.target.value || null })}
                placeholder="e.g. CLM-2026-001"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Insurance company</label>
              <input
                type="text"
                defaultValue={job.insurance_company || ''}
                onBlur={e => e.target.value !== (job.insurance_company || '') && onUpdate({ insurance_company: e.target.value || null })}
                placeholder="e.g. State Farm"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Payment amounts */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Payment amounts</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">ACV ($)</label>
                <input
                  type="number"
                  defaultValue={job.acv_amount ?? ''}
                  onBlur={e => onUpdate({ acv_amount: e.target.value ? Number(e.target.value) : null })}
                  placeholder="0"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Depreciation ($)</label>
                <input
                  type="number"
                  defaultValue={job.depreciation_amount ?? ''}
                  onBlur={e => onUpdate({ depreciation_amount: e.target.value ? Number(e.target.value) : null })}
                  placeholder="0"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Supplements ($)</label>
                <input
                  type="number"
                  defaultValue={job.supplement_amount ?? ''}
                  onBlur={e => onUpdate({ supplement_amount: e.target.value ? Number(e.target.value) : null })}
                  placeholder="0"
                  className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
            {(job.acv_amount || job.depreciation_amount || job.supplement_amount) && (
              <p className="text-xs text-gray-500 mt-2">
                Total expected: ${(
                  (job.acv_amount || 0) +
                  (job.depreciation_amount || 0) +
                  (job.supplement_amount || 0)
                ).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
// ──────────────────────────────────────────────────────────────────────────────

export default function JobDetailClient({
  initialJob,
  crews,
  subs,
  userRole,
  canViewJobBilling,
  canEditPayrollAttribution,
  changeOrdersSection,
}: JobDetailClientProps) {
  const router = useRouter()
  const [job, setJob] = useState<Job>(initialJob)
  const [materialOrdersTotal, setMaterialOrdersTotal] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingLaborCost, setSavingLaborCost] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleModalMode, setScheduleModalMode] = useState<'schedule' | 'reassign'>('schedule')

  const openScheduleModal = useCallback((mode: 'schedule' | 'reassign' = 'schedule') => {
    setScheduleModalMode(mode)
    setShowScheduleModal(true)
  }, [])
  const [newNoteText, setNewNoteText] = useState('')
  const [jobNotes, setJobNotes] = useState<JobNote[]>([])
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [showCompleteModal, setShowCompleteModal] = useState(false)
  const [paymentSummary, setPaymentSummary] = useState<JobPaymentSummary | null>(null)
  const [paymentsRefreshKey, setPaymentsRefreshKey] = useState(0)
  const [autoCollecting, setAutoCollecting] = useState(false)
  const openCostAttachmentShortcutRef = useRef<(() => void) | null>(null)
  const registerOpenCostAttachmentShortcut = useCallback((openPicker: (() => void) | null) => {
    openCostAttachmentShortcutRef.current = openPicker
  }, [])
  // Mobile tab navigation (lg+ always shows all sections)
  const [mobileTab, setMobileTab] = useState<'overview' | 'scope' | 'materials' | 'financials' | 'photos' | 'notes'>('overview')

  // Mention/tagging state
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionCursorPos, setMentionCursorPos] = useState(0)

  // Load payment summary for balance check
  useEffect(() => {
    if (!canViewJobBilling) {
      setPaymentSummary(null)
      return
    }

    const loadPayments = async () => {
      try {
        const response = await fetch(`/api/ops/jobs/${job.id}/payments`)
        if (response.ok) {
          const data = await response.json()
          setPaymentSummary(data)
        }
      } catch (error) {
        console.error('Error loading payments:', error)
      }
    }
    loadPayments()
  }, [job.id, canViewJobBilling, paymentsRefreshKey])

  // On mobile: deep links / hash → correct tab (initial load + client-side hash changes)
  useEffect(() => {
    const applyHashToTab = () => {
      if (typeof window === 'undefined' || window.innerWidth >= 1024) return
      const hash = window.location.hash
      if (hash === '#materials-section') {
        setMobileTab('materials')
      } else if (hash === '#payments-section' || hash === '#invoices-section') {
        setMobileTab('financials')
      } else if (hash === '#job-files-workspace-section') {
        setMobileTab('photos')
      }
    }
    applyHashToTab()
    window.addEventListener('hashchange', applyHashToTab)
    return () => window.removeEventListener('hashchange', applyHashToTab)
  }, [])

  useEffect(() => {
    const loadMaterialOrdersTotal = async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}/product-orders`)
        if (!response.ok) return
        const data = await response.json()
        if (typeof data?.total === 'number') {
          setMaterialOrdersTotal(data.total)
        }
      } catch (error) {
        console.error('Error loading material totals:', error)
      }
    }

    loadMaterialOrdersTotal()
  }, [job.id])

  // If a completed job is fully paid, auto-transition to "collected"
  // so status and banner stay aligned with payment state.
  useEffect(() => {
    if (!paymentSummary) return
    if (job.status !== 'complete') return
    if (autoCollecting) return

    const saleAmountCents = Math.round((job.sale_amount || 0) * 100)
    const collectedCents = paymentSummary.collected_cents || 0

    // Only auto-collect for paid jobs with an actual sale amount.
    if (saleAmountCents <= 0) return
    if (collectedCents < saleAmountCents) return

    const markCollected = async () => {
      setAutoCollecting(true)
      try {
        const response = await fetch(`/api/ops/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'collected' }),
        })

        if (response.ok) {
          await reloadJob()
        }
      } catch (error) {
        console.error('Error auto-marking collected:', error)
      } finally {
        setAutoCollecting(false)
      }
    }

    markCollected()
  }, [job.id, job.status, job.sale_amount, paymentSummary, autoCollecting])

  // Load job notes
  useEffect(() => {
    const loadNotes = async () => {
      setLoadingNotes(true)
      try {
        const response = await fetch(`/api/ops/jobs/${job.id}/notes`)
        if (response.ok) {
          const data = await response.json()
          setJobNotes(data.notes || [])
        }
      } catch (error) {
        console.error('Error loading notes:', error)
      } finally {
        setLoadingNotes(false)
      }
    }
    loadNotes()
  }, [job.id])

  // Load org users for @mentions
  useEffect(() => {
    const loadOrgUsers = async () => {
      try {
        const response = await fetch('/api/users')
        if (response.ok) {
          const data = await response.json()
          setOrgUsers(data.users || [])
        }
      } catch (error) {
        console.error('Error loading org users:', error)
      }
    }
    loadOrgUsers()
  }, [])

  // Handle note text change with @mention detection
  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setNewNoteText(value)
    
    // Check if we're in the middle of typing a mention
    const textBeforeCursor = value.substring(0, cursorPos)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/)
    
    if (mentionMatch) {
      setShowMentionDropdown(true)
      setMentionSearch(mentionMatch[1].toLowerCase())
      setMentionCursorPos(cursorPos)
    } else {
      setShowMentionDropdown(false)
      setMentionSearch('')
    }
  }

  // Insert mention into text
  const insertMention = (user: OrgUser) => {
    const textBeforeCursor = newNoteText.substring(0, mentionCursorPos)
    const textAfterCursor = newNoteText.substring(mentionCursorPos)
    
    // Find where the @ starts
    const atIndex = textBeforeCursor.lastIndexOf('@')
    const beforeAt = textBeforeCursor.substring(0, atIndex)
    
    // Insert the mention
    const newText = `${beforeAt}@${user.full_name} ${textAfterCursor}`
    setNewNoteText(newText)
    setShowMentionDropdown(false)
    setMentionSearch('')
  }

  // Filter users based on search
  const filteredUsers = orgUsers.filter(user => 
    user.full_name.toLowerCase().includes(mentionSearch)
  ).slice(0, 5)

  // Render note text with highlighted mentions
  const renderNoteWithMentions = (text: string) => {
    const mentionRegex = /@([A-Za-z\s]+?)(?=\s|$|@)/g
    const parts = []
    let lastIndex = 0
    let match

    while ((match = mentionRegex.exec(text)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }
      // Add the mention with styling
      parts.push(
        <span key={match.index} className="text-indigo-600 font-medium">
          @{match[1]}
        </span>
      )
      lastIndex = match.index + match[0].length
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }
    
    return parts.length > 0 ? parts : text
  }

  const addNote = async () => {
    if (!newNoteText.trim()) return
    
    setSaving(true)
    try {
      const noteText = newNoteText.trim()
      const mentionedUserIds = orgUsers
        .filter((u) => {
          if (!u?.id || !u?.full_name) return false
          const escapedName = u.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const mentionPattern = new RegExp(`(^|\\s)@${escapedName}(?=\\s|$|[.,!?;:])`, 'i')
          return mentionPattern.test(noteText)
        })
        .map((u) => u.id)

      const response = await fetch(`/api/ops/jobs/${job.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: noteText,
          mentioned_user_ids: mentionedUserIds,
          customer_name: job.customer?.name || null,
          customer_id: job.customer?.id || null,
          job_number: job.job_number || null,
          page_url: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      })
      
      if (response.ok) {
        const data = await response.json()
        setJobNotes(prev => [data.note, ...prev])
        setNewNoteText('')
      } else {
        alert('Failed to add note')
      }
    } catch (error) {
      console.error('Error adding note:', error)
      alert('Failed to add note')
    } finally {
      setSaving(false)
    }
  }

  const reloadJob = async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${job.id}`)
      if (!response.ok) {
        console.error('Failed to reload job')
        return
      }
      
      const { job: data } = await response.json()
      
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
          installation_agreement: job.installation_agreement,
          /** Server job payload does not include opportunity / payroll attribution — preserve from SSR. */
          payroll_attribution: job.payroll_attribution,
          opportunity_id: job.opportunity_id,
        }
        setJob(transformedJob)
      }
    } catch (error) {
      console.error('Error reloading job:', error)
    }
  }

  const updateStatus = async (newStatus: JobStatus, extraUpdates?: Record<string, any>) => {
    setSaving(true)

    const updates: any = { status: newStatus, ...extraUpdates }
    if (newStatus === 'in_progress' && !job.started_at) {
      updates.started_at = new Date().toISOString()
    } else if (newStatus === 'complete' && !job.completed_at) {
      updates.completed_at = new Date().toISOString()
    }

    try {
      const response = await fetch(`/api/ops/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to update status:', error)
        alert('Failed to update status')
      }
    } catch (error) {
      console.error('Error updating status:', error)
      alert('Failed to update status')
    }

    await reloadJob()
    setSaving(false)
  }

  const handleCompleteClick = () => {
    const saleAmountCents = Math.round((job.sale_amount || 0) * 100)
    const collectedCents = paymentSummary?.collected_cents || 0
    const remainingCents = saleAmountCents - collectedCents

    if (remainingCents > 0) {
      setShowCompleteModal(true)
    } else {
      updateStatus('complete')
    }
  }

  const handleCompleteWithBalance = async (reason?: string) => {
    await updateStatus('complete', {
      allow_close_with_balance: true,
      close_balance_reason: reason || null,
    })
    setShowCompleteModal(false)
  }

  const saleAmountCentsForCollected = Math.round((job.sale_amount || 0) * 100)
  const collectedCentsForWorkflow = paymentSummary?.collected_cents ?? 0
  const canMarkCollected =
    saleAmountCentsForCollected <= 0 ||
    (paymentSummary != null && collectedCentsForWorkflow >= saleAmountCentsForCollected)
  const markCollectedTitle =
    !canMarkCollected && saleAmountCentsForCollected > 0
      ? paymentSummary == null
        ? 'Loading payment summary…'
        : 'Record payments until the job is fully collected before moving it to the Completed list.'
      : undefined

  const handleCollectedClick = () => {
    if (saleAmountCentsForCollected > 0 && collectedCentsForWorkflow < saleAmountCentsForCollected) {
      alert(
        'Record payments until the balance is zero. The Completed list is only for jobs that are fully collected.'
      )
      return
    }
    void updateStatus('collected')
  }

  const updateMaterialsStatus = async (newStatus: string) => {
    setSaving(true)

    const updates: any = { materials_status: newStatus }
    if (newStatus === 'ordered' && !job.materials_ordered_at) {
      updates.materials_ordered_at = new Date().toISOString()
    }

    try {
      const response = await fetch(`/api/ops/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to update materials status:', error)
        alert('Failed to update materials status')
      }
    } catch (error) {
      console.error('Error updating materials status:', error)
      alert('Failed to update materials status')
    }

    await reloadJob()
    setSaving(false)
  }

  const updateLaborCost = async (newLaborCost: number | null) => {
    setSavingLaborCost(true)

    try {
      const response = await fetch(`/api/ops/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labor_cost: newLaborCost }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to update labor cost:', error)
        alert('Failed to update labor cost')
      } else {
        await reloadJob()
      }
    } catch (error) {
      console.error('Error updating labor cost:', error)
      alert('Failed to update labor cost')
    } finally {
      setSavingLaborCost(false)
    }
  }

  const deleteJob = async () => {
    if (!confirm(`Are you sure you want to delete job ${job.job_number}? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
    try {
      const response = await fetch(`/api/ops/jobs/${job.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to delete job')
        setDeleting(false)
        return
      }

      router.push('/ops')
    } catch (error) {
      console.error('Error deleting job:', error)
      alert('Failed to delete job')
      setDeleting(false)
    }
  }

  const status = statusConfig[job.status] || statusConfig.sold
  const materials = materialsConfig[job.materials_status] || materialsConfig.not_ordered
  const effectiveMaterialCost = materialOrdersTotal ?? job.material_cost ?? null
  const canViewProfitability = userRole === 'admin' || userRole === 'owner'
  const canViewFinancialTab = canViewProfitability || canViewJobBilling
  const payrollSnapshot = useMemo(() => buildCommissionPayrollSnapshot(job), [job])
  const saleAmount = job.sale_amount || 0
  const laborCost = job.labor_cost || 0
  const materialCost = effectiveMaterialCost || 0
  const dealerFeeCost = job.dealer_fee_amount || 0
  const toCents = (value: number) => Math.round(value * 100)
  const formatCents = (valueInCents: number) =>
    `$${(valueInCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const saleAmountCents = toCents(saleAmount)
  const laborCostCents = toCents(laborCost)
  const materialCostCents = toCents(materialCost)
  const dealerFeeCents = toCents(dealerFeeCost)
  const commissionCents =
    payrollSnapshot.poolCap != null
      ? Math.round(payrollSnapshot.poolCap * 100)
      : Math.round(saleAmountCents * SALES_COMMISSION_POOL_RATE)
  const profitCents =
    saleAmountCents - laborCostCents - materialCostCents - dealerFeeCents - commissionCents
  const profitPercent = saleAmountCents > 0 ? ((profitCents / saleAmountCents) * 100).toFixed(1) : '0.0'

  const handleAttachReceiptInvoiceShortcut = () => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

    if (isMobile) {
      // Show Photos tab first so JobFileWorkspaceCard (and file input) are in the layout — then open picker + scroll
      setMobileTab('photos')
      setTimeout(() => {
        openCostAttachmentShortcutRef.current?.()
        const workspaceEl = document.getElementById('job-files-workspace-section')
        if (workspaceEl) workspaceEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } else {
      openCostAttachmentShortcutRef.current?.()
      const workspaceEl = document.getElementById('job-files-workspace-section')
      if (workspaceEl) workspaceEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="mb-4 sm:mb-6">
          <Link href="/ops" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium min-h-[44px] inline-flex items-center">
            ← Back to Production Board
          </Link>
        </div>

        <JobNextActionBanner
          jobId={job.id}
          status={job.status}
          saleAmount={job.sale_amount}
          depositRequiredPercent={job.deposit_required_percent}
          paymentMethod={job.project?.payment_method || null}
          materialsStatus={job.materials_status}
          scheduledDate={job.scheduled_date}
          assignedCrewId={job.assigned_crew?.id || null}
          assignedSubId={job.assigned_sub?.id || null}
          financeSubmittedAt={job.finance_submitted_at || null}
          refreshKey={paymentsRefreshKey}
          onSchedule={() => openScheduleModal('schedule')}
          onMarkJobComplete={handleCompleteClick}
          onStartJob={() => updateStatus('in_progress')}
          onMarkCollected={handleCollectedClick}
        />
        <JobReadyToPayBanner
          status={job.status}
          paymentSummary={paymentSummary}
          saleAmount={job.sale_amount}
          canViewBilling={canViewJobBilling}
          onMarkCollected={handleCollectedClick}
          onMarkJobComplete={handleCompleteClick}
        />
        <JobPayrollSentBanner
          jobId={job.id}
          status={job.status}
          payrollSentAt={job.payroll_sent_at ?? null}
          paymentSummary={paymentSummary}
          saleAmount={job.sale_amount}
          canViewBilling={canViewJobBilling}
          onUpdated={reloadJob}
        />
        <AINextActionBanner
          job={{
            status: job.status,
            deposit: job.deposit,
            deposit_required_percent: job.deposit_required_percent ?? 0,
            materials_status: job.materials_status,
            scheduled_date: job.scheduled_date,
            assigned_sub_id: job.assigned_sub?.id || null,
            assigned_crew_id: job.assigned_crew?.id || null,
            final_front: !!job.final_front,
            final_back: !!job.final_back,
            final_left: !!job.final_left,
            final_right: !!job.final_right,
            final_slope_1: !!job.final_slope_1,
            final_slope_2: !!job.final_slope_2,
            flashing_detail: !!job.flashing_detail,
            pipe_boots: !!job.pipe_boots,
            labor_cost: job.labor_cost,
            material_cost: job.material_cost,
            sale_amount: job.sale_amount ?? 0,
          }}
        />

        {/* Mobile Quick Actions — same workflow priority as desktop */}
        <div className="lg:hidden mb-4 bg-white rounded-xl shadow-sm border p-4">
          <div className="flex flex-col gap-2">
            {(() => {
              const { primary: primaryId, secondary: secondaryIds } = getWorkflowPrimaryAndSecondaryIds(job)
              const wfOpts = {
                saving,
                openScheduleModal,
                updateStatus,
                handleCompleteClick,
                handleCollectedClick,
                canMarkCollected,
                markCollectedTitle,
              }
              const overflowAllowed =
                (job.status !== 'on_hold' && job.status !== 'complete' && job.status !== 'collected') || userRole === 'admin'
              return (
                <>
                  <div className="w-full [&>button]:w-full">{renderWorkflowButton(job, primaryId, true, wfOpts)}</div>
                  {secondaryIds.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 [&>button]:w-full">{secondaryIds.map((id) => renderWorkflowButton(job, id, false, wfOpts))}</div>
                  )}
                  {overflowAllowed && (
                    <details className="relative">
                      <summary className="list-none cursor-pointer min-h-[44px] w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 text-center select-none [&::-webkit-details-marker]:hidden">
                        More actions ▾
                      </summary>
                      <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 py-1">
                        {job.status !== 'on_hold' && job.status !== 'complete' && job.status !== 'collected' && (
                          <button
                            type="button"
                            onClick={() => updateStatus('on_hold')}
                            disabled={saving}
                            className="w-full text-left px-3 py-2.5 text-sm text-orange-700 disabled:opacity-50"
                          >
                            Pause Job
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            onClick={() => void deleteJob()}
                            disabled={deleting}
                            className="w-full text-left px-3 py-2.5 text-sm text-red-600 disabled:opacity-50"
                          >
                            {deleting ? 'Deleting…' : 'Delete Job'}
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </>
              )
            })()}
          </div>
          
          {/* Mobile Assignment & Materials Summary */}
          <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500 text-xs block">Assigned</span>
              <span className="font-medium text-gray-900 truncate block">
                {job.assigned_crew?.name || job.assigned_sub?.company_name || 'Not assigned'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Materials</span>
              <span className={`font-medium ${materials.color}`}>
                {materials.label}
              </span>
            </div>
          </div>
        </div>

        {/* Mobile tab bar — hidden on desktop */}
        <div className="lg:hidden bg-white border rounded-xl shadow-sm mb-4 overflow-hidden">
          <div className="flex overflow-x-auto">
            {([
              { key: 'overview', label: 'Overview' },
              { key: 'scope',    label: 'Details' },
              { key: 'materials', label: 'Materials' },
              ...(canViewFinancialTab ? [{ key: 'financials' as const, label: 'Financials' }] : []),
              { key: 'photos',   label: 'Photos' },
              { key: 'notes',    label: 'Notes' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setMobileTab(tab.key)}
                className={`flex-none min-w-[5.75rem] px-3 py-3 text-xs font-medium border-b-2 transition-colors ${
                  mobileTab === tab.key
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-sm font-mono text-gray-900">{job.job_number}</span>
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
                    {canViewJobBilling && paymentSummary && (() => {
                      const saleCents = Math.round((job.sale_amount || 0) * 100)
                      if (saleCents <= 0) return null
                      const collected = paymentSummary.collected_cents
                      const full = collected >= saleCents
                      const partial = collected > 0 && !full
                      const label = full ? 'Paid in full' : partial ? 'Partially paid' : 'Unpaid'
                      const cls = full
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : partial
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-gray-50 text-gray-700 border-gray-200'
                      return (
                        <span
                          className={`px-2.5 py-1 text-xs font-medium rounded-full border ${cls}`}
                          title={
                            full
                              ? 'Recorded payments cover the contract amount'
                              : `Collected ${paymentSummary.collected_dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of ${(job.sale_amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
                          }
                        >
                          {label}
                        </span>
                      )
                    })()}
                  </div>
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">
                    {job.customer?.name || 'Customer'}
                  </h1>
                  {job.address_text ? (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(job.address_text)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 text-sm sm:text-base text-indigo-600 hover:text-indigo-800 break-words inline-flex items-start gap-1.5 min-h-[44px] sm:min-h-0 items-center"
                    >
                      <span className="break-words">{job.address_text}</span>
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ) : (
                    <p className="text-gray-500 mt-1 text-sm">No address</p>
                  )}

                  {/** Pipeline — milestones; vertical on small screens, horizontal on lg+ */}
                  {(() => {
                    const pipelineCurrentIdx = getJobPipelineCurrentIndex(job)
                    const currentLabel = PIPELINE_STAGES[pipelineCurrentIdx] ?? '—'
                    return (
                      <>
                        <div className="mt-3 pt-3 border-t border-gray-100 lg:hidden">
                          <div className="flex items-baseline justify-between gap-2 mb-3">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Job progress
                            </span>
                            <span className="text-sm font-semibold text-indigo-700 tabular-nums shrink-0">
                              Now: {currentLabel}
                            </span>
                          </div>
                          <ol className="space-y-0" aria-label="Job pipeline steps">
                            {PIPELINE_STAGES.map((label, i) => {
                              const isDone = i < pipelineCurrentIdx
                              const isCurrent = i === pipelineCurrentIdx
                              const isLast = i === PIPELINE_STAGES.length - 1
                              return (
                                <li key={label} className="flex gap-3">
                                  <div className="flex flex-col items-center w-7 flex-shrink-0 pt-0.5">
                                    <span
                                      className={`rounded-full w-3 h-3 border-2 shrink-0 ${
                                        isDone
                                          ? 'bg-emerald-500 border-emerald-500'
                                          : isCurrent
                                            ? 'bg-indigo-600 border-indigo-600 shadow-[0_0_0_3px_rgba(79,70,229,0.25)]'
                                            : 'bg-white border-gray-300'
                                      }`}
                                      aria-hidden
                                    />
                                    {!isLast && (
                                      <span
                                        className={`w-0.5 flex-1 min-h-[14px] my-0.5 rounded-full ${
                                          pipelineCurrentIdx > i ? 'bg-emerald-400' : 'bg-gray-200'
                                        }`}
                                        aria-hidden
                                      />
                                    )}
                                  </div>
                                  <div className={`pb-2.5 min-w-0 ${isLast ? 'pb-0' : ''}`}>
                                    <span
                                      className={`text-sm leading-snug ${
                                        isCurrent
                                          ? 'font-semibold text-gray-900'
                                          : isDone
                                            ? 'text-gray-800'
                                            : 'text-gray-400'
                                      }`}
                                    >
                                      {label}
                                    </span>
                                  </div>
                                </li>
                              )
                            })}
                          </ol>
                        </div>

                        <div className="mt-3 pt-3 border-t border-gray-100 overflow-x-auto pb-0.5 hidden lg:block">
                          <div className="flex items-center min-w-[520px]">
                            {PIPELINE_STAGES.map((label, i) => (
                              <div key={label} className="flex items-center flex-1 min-w-0">
                                {i > 0 && (
                                  <div
                                    className={`h-1 flex-1 rounded-full mx-1 min-w-[8px] ${
                                      pipelineCurrentIdx >= i ? 'bg-emerald-400' : 'bg-gray-200'
                                    }`}
                                  />
                                )}
                                <div className="flex flex-col items-center shrink-0 flex-1 min-w-[4.5rem]">
                                  <span
                                    className={`text-[10px] uppercase tracking-wide text-center leading-tight px-0.5 ${
                                      i === pipelineCurrentIdx
                                        ? 'text-indigo-800 font-semibold'
                                        : i < pipelineCurrentIdx
                                          ? 'text-gray-600'
                                          : 'text-gray-400'
                                    }`}
                                  >
                                    {label}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
                <span className={`text-sm px-3 py-1 rounded-full whitespace-nowrap self-start ${
                  job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
                  job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
                  job.job_type === 'windows' ? 'bg-purple-100 text-purple-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {job.job_type}
                </span>
              </div>

              {/* Desktop: one primary CTA + outlined secondaries + More (pause/delete) */}
              <div className="hidden lg:flex flex-wrap items-center gap-2 pt-4 border-t">
                {(() => {
                  const { primary: primaryId, secondary: secondaryIds } = getWorkflowPrimaryAndSecondaryIds(job)
                  const wfOpts = {
                    saving,
                    openScheduleModal,
                    updateStatus,
                    handleCompleteClick,
                    handleCollectedClick,
                    canMarkCollected,
                    markCollectedTitle,
                  }
                  const overflowAllowed =
                    (job.status !== 'on_hold' && job.status !== 'complete' && job.status !== 'collected') || userRole === 'admin'
                  return (
                    <>
                      {renderWorkflowButton(job, primaryId, true, wfOpts)}
                      {secondaryIds.map((id) => renderWorkflowButton(job, id, false, wfOpts))}
                      <div className="flex-1 min-w-[8px]" aria-hidden />
                      {overflowAllowed && (
                        <details className="relative">
                          <summary className="list-none cursor-pointer min-h-[44px] px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
                            More
                            <span className="text-gray-400">▾</span>
                          </summary>
                          <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-gray-200 bg-white shadow-lg z-20 py-1">
                            {job.status !== 'on_hold' && job.status !== 'complete' && job.status !== 'collected' && (
                              <button
                                type="button"
                                onClick={() => updateStatus('on_hold')}
                                disabled={saving}
                                className="w-full text-left px-3 py-2.5 text-sm text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                              >
                                Pause Job
                              </button>
                            )}
                            {userRole === 'admin' && (
                              <button
                                type="button"
                                onClick={() => {
                                  void deleteJob()
                                }}
                                disabled={deleting}
                                className="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {deleting ? 'Deleting…' : 'Delete Job'}
                              </button>
                            )}
                          </div>
                        </details>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            {/* SCOPE TAB */}
            <div className={mobileTab !== 'scope' ? 'hidden lg:block' : undefined}>
              <OperationsSnapshotCard
                project={job.project}
                headerAction={
                  job.project_id ? (
                    <Link
                      href={`/projects/${job.project_id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800 shrink-0"
                    >
                      View project →
                    </Link>
                  ) : undefined
                }
              />

              {/* Sold Scope + Job Packet - What was sold (from accepted proposal) */}
              <SoldScopeCard
                projectId={job.project_id}
                acceptedProposalId={job.accepted_proposal_id}
                acceptedEstimateId={job.accepted_estimate_id}
                linkedProposalId={job.linked_proposal_id}
                opportunityId={job.opportunity_id}
                jobId={job.id}
                orgId={job.org_id}
                showJobPacketButton={true}
                jobScopeOfWork={job.project?.scope_of_work || null}
                jobMaterialsNotes={job.materials_notes}
              />
            </div>

            {/* MATERIALS TAB */}
            <div id="materials-section" className={mobileTab !== 'materials' ? 'hidden lg:block' : undefined}>
              <JobMaterialsCard
                jobId={job.id}
                userRole={userRole}
                title="Materials"
                materialsStatus={job.materials_status}
                onMaterialsStatusChange={updateMaterialsStatus}
                updatingMaterialsStatus={saving}
                laborCost={job.labor_cost}
                onSaveLaborCost={updateLaborCost}
                savingLaborCost={savingLaborCost}
                materialsOrderedAt={job.materials_ordered_at}
                materialsEta={job.materials_eta}
                materialsNotes={job.materials_notes}
                onTotalChange={setMaterialOrdersTotal}
                onAttachReceiptInvoice={handleAttachReceiptInvoiceShortcut}
              />
            </div>

            {/* PHOTOS & FILES TAB */}
            <div id="job-files-workspace-section" className={mobileTab !== 'photos' ? 'hidden lg:block' : undefined}>
              <JobFileWorkspaceCard
                jobId={job.id}
                userRole={userRole}
                registerOpenCostAttachmentShortcut={registerOpenCostAttachmentShortcut}
                dealerFeeAmount={job.dealer_fee_amount ?? null}
              />
            </div>

            {/* NOTES TAB */}
            <div className={`bg-white rounded-xl shadow-sm border p-4 sm:p-6 ${mobileTab !== 'notes' ? 'hidden lg:block' : ''}`}>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Internal Notes</h2>
              
              {/* Add new note */}
              <div className="mb-4 relative">
                <AINoteSummary notes={jobNotes} />
                <textarea
                  value={newNoteText}
                  onChange={handleNoteChange}
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg mb-2 text-gray-900 text-base"
                  placeholder="Add a note… Tip: type @ to mention a teammate."
                />
                
                {/* @mention dropdown */}
                {showMentionDropdown && filteredUsers.length > 0 && (
                  <div className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 w-full sm:w-64 max-h-48 overflow-y-auto">
                    {filteredUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => insertMention(user)}
                        className="w-full text-left px-3 py-3 sm:py-2 hover:bg-gray-100 text-gray-900 text-sm min-h-[44px]"
                      >
                        {user.full_name}
                      </button>
                    ))}
                  </div>
                )}
                
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <button
                    onClick={addNote}
                    disabled={saving || !newNoteText.trim()}
                    className="min-h-[44px] px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Adding...' : 'Add Note'}
                  </button>
                </div>
              </div>

              {/* Notes list */}
              <div className="border-t pt-4">
                {loadingNotes ? (
                  <p className="text-gray-500 text-sm">Loading notes...</p>
                ) : jobNotes.length === 0 ? (
                  <p className="text-gray-500 text-sm">No notes yet</p>
                ) : (
                  <div className="space-y-4">
                    {jobNotes.map((note) => (
                      <div key={note.id} className="border-b pb-3 last:border-b-0 last:pb-0">
                        <p className="text-sm sm:text-base text-gray-900 whitespace-pre-wrap break-words">{renderNoteWithMentions(note.note)}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {note.user?.full_name || 'Unknown'} • {new Date(note.created_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6">
            {/* OVERVIEW TAB — Schedule, Assignment, Customer */}
            <div className={mobileTab !== 'overview' ? 'hidden lg:block' : undefined}>
            <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Schedule</h2>
              {job.scheduled_date ? (
                <div>
                  <div className="text-lg sm:text-xl font-bold text-gray-900">
                    {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      timeZone: 'America/New_York',
                    })}
                  </div>
                  {job.scheduled_time_start && (
                    <p className="text-sm sm:text-base text-gray-900 mt-1">Start: {job.scheduled_time_start}</p>
                  )}
                  {job.estimated_duration_hours && (
                    <p className="text-sm sm:text-base text-gray-900">Duration: {job.estimated_duration_hours} hours</p>
                  )}
                  {(job.assigned_crew?.name || job.assigned_sub?.company_name) && (
                    <p className="text-sm font-medium text-gray-800 mt-2 pt-2 border-t border-gray-100">
                      {job.assigned_crew?.name ? (
                        <>
                          Crew: <span className="text-indigo-700">{job.assigned_crew.name}</span>
                        </>
                      ) : (
                        <>
                          Sub: <span className="text-indigo-700">{job.assigned_sub?.company_name}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-3 sm:py-4">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700" aria-hidden>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-900">Not scheduled yet</p>
                      <p className="text-xs text-amber-800/90 mt-0.5">Add a date to get this job on the calendar.</p>
                      <button
                        type="button"
                        onClick={() => openScheduleModal('schedule')}
                        className="mt-3 min-h-[44px] w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                      >
                        Schedule now
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Assignment</h2>
                {(job.scheduled_date || job.assigned_crew || job.assigned_sub) && (
                  <button
                    type="button"
                    onClick={() => openScheduleModal('reassign')}
                    className="min-h-[44px] shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 w-full sm:w-auto"
                  >
                    Reassign crew or sub
                  </button>
                )}
              </div>
              {job.assigned_crew ? (
                <div className="flex items-center gap-3">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                    style={{ backgroundColor: job.assigned_crew.color }}
                  >
                    {job.assigned_crew.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{job.assigned_crew.name}</div>
                    <div className="text-sm text-gray-900">In-House Crew</div>
                    {job.assigned_crew.phone && (
                      <a href={`tel:${job.assigned_crew.phone}`} className="text-sm text-indigo-600 min-h-[44px] inline-flex items-center">
                        {job.assigned_crew.phone}
                      </a>
                    )}
                  </div>
                </div>
              ) : job.assigned_sub ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-600 font-bold">S</span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{job.assigned_sub.company_name}</div>
                    <div className="text-sm text-gray-900">Sub-Contractor</div>
                    {job.assigned_sub.phone && (
                      <a href={`tel:${job.assigned_sub.phone}`} className="text-sm text-indigo-600 min-h-[44px] inline-flex items-center">
                        {job.assigned_sub.phone}
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-900 mb-3">Not assigned</p>
                  <button
                    type="button"
                    onClick={() => openScheduleModal('schedule')}
                    className="min-h-[44px] text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Assign crew or sub →
                  </button>
                </div>
              )}
            </div>

            <InsuranceCard job={job} onUpdate={(fields) => {
              setJob(j => ({ ...j, ...fields }))
              fetch(`/api/ops/jobs/${job.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
              })
            }} />

            <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Customer</h2>
              {job.customer ? (
                <div>
                  <div className="font-medium text-gray-900 mb-2 break-words">{job.customer.name}</div>
                  {job.customer.phone && (
                    <a href={`tel:${job.customer.phone}`} className="min-h-[44px] flex items-center text-sm text-indigo-600 mb-1">
                      📞 {job.customer.phone}
                    </a>
                  )}
                  {job.customer.email && (
                    <a href={`mailto:${job.customer.email}`} className="min-h-[44px] flex items-center text-sm text-indigo-600 break-all">
                      ✉️ {job.customer.email}
                    </a>
                  )}
                  <Link
                    href={`/customers/${job.customer.id}`}
                    className="min-h-[44px] flex items-center text-sm text-gray-900 hover:text-indigo-600 mt-2"
                  >
                    View customer →
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-gray-900 mb-2">No customer linked</p>
                  <LinkCustomerButton sourceType="job" sourceId={job.id} />
                </div>
              )}
            </div>

            </div>{/* end overview tab wrapper */}

            {/* Final photos — desktop: above Financials (admin/owner); mobile: Photos tab */}
            <div className={mobileTab !== 'photos' ? 'hidden lg:block' : undefined}>
              <FinalPhotosCard jobId={job.id} projectId={job.project_id} orgId={job.org_id} />
            </div>

            {/* FINANCIALS TAB — Financials, Payments, Invoices, Work Orders */}
            <div className={mobileTab !== 'financials' ? 'hidden lg:block' : undefined}>
            {canViewProfitability && (
              <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Financials</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Sale minus est. comp, labor, materials, and any lender dealer fee — admin &amp; owner only.
                </p>
                <div className="space-y-3 text-sm sm:text-base">
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-700">Sale</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      {job.sale_amount !== null ? formatCents(saleAmountCents) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-700">Est. sales comp</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      {job.sale_amount !== null ? formatCents(commissionCents) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-700">Labor</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      {job.labor_cost !== null ? formatCents(laborCostCents) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-700">Materials</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      {effectiveMaterialCost !== null ? formatCents(materialCostCents) : '—'}
                    </span>
                  </div>
                  {dealerFeeCents > 0 && (
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-700">Lender / dealer fee</span>
                      <span className="font-medium text-amber-900 tabular-nums">{formatCents(dealerFeeCents)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 pt-3 flex justify-between gap-4">
                    <span className="text-gray-900 font-medium">Est. profit</span>
                    <span className={`font-semibold tabular-nums ${job.sale_amount !== null ? 'text-green-600' : 'text-gray-900'}`}>
                      {job.sale_amount !== null ? formatCents(profitCents) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-700">Margin</span>
                    <span className="font-semibold text-gray-900 tabular-nums">
                      {job.sale_amount !== null ? `${profitPercent}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {job.payroll_attribution && (canViewJobBilling || canEditPayrollAttribution) && (
              <div id="payroll-attribution-section" className="scroll-mt-20">
                <PayrollAttributionEditor
                  opportunityId={job.payroll_attribution.opportunity_id}
                  initial={job.payroll_attribution}
                  canEdit={canEditPayrollAttribution}
                  onSaved={(next) => {
                    setJob((j) => ({ ...j, payroll_attribution: next }))
                  }}
                />
              </div>
            )}

            <div id="payments-section" className="scroll-mt-20">
              {canViewJobBilling ? (
                <JobPaymentsCard
                  jobId={job.id}
                  saleAmount={job.sale_amount}
                  onPaymentChange={() => setPaymentsRefreshKey(k => k + 1)}
                />
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">Payments</h2>
                  <p className="text-sm text-gray-700">
                    Recording deposits and job payments is limited to admin, owner, operations, and finance roles.
                    Ask operations or an admin to record the deposit, or request billing access if your role should
                    include it.
                  </p>
                </div>
              )}
            </div>

            {canViewJobBilling && (
              <div id="invoices-section">
                <JobInvoicesCard
                  jobId={job.id}
                  saleAmount={job.sale_amount}
                  customerEmail={job.customer?.email}
                  onInvoiceChange={() => setPaymentsRefreshKey(k => k + 1)}
                />
              </div>
            )}

            <JobWorkOrdersCard jobId={job.id} projectId={job.project_id} />

            {changeOrdersSection && (
              <ChangeOrdersSection
                variant="ops"
                projectId={changeOrdersSection.projectId}
                projectAddress={changeOrdersSection.projectAddress}
                customerName={changeOrdersSection.customerName}
                customerEmail={changeOrdersSection.customerEmail}
                originalContractAmount={changeOrdersSection.originalContractAmount}
                originalContractDate={changeOrdersSection.originalContractDate}
                originalContractId={changeOrdersSection.originalContractId}
                paymentMethod={changeOrdersSection.paymentMethod}
                amountCollected={changeOrdersSection.amountCollected}
                jobId={changeOrdersSection.jobId}
                repName={changeOrdersSection.repName}
                changeOrders={changeOrdersSection.changeOrders}
              />
            )}
            </div>{/* end costs tab wrapper */}

            {/* OVERVIEW TAB — Permit + Related */}
            <div className={mobileTab !== 'overview' ? 'hidden lg:block' : undefined}>

            {job.permit_required && (
              <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Permit</h2>
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

            <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Related</h2>
              <div className="space-y-1">
                {/* Installation Agreement - from order_form_contracts */}
                {job.installation_agreement && job.installation_agreement.status === 'completed' && (
                  job.installation_agreement.pdf_url ? (
                    <a
                      href={job.installation_agreement.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] flex items-center gap-2 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 mb-3"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      View Installation Agreement
                    </a>
                  ) : (
                    <div className="min-h-[44px] flex items-center gap-2 text-sm text-gray-500 mb-3">
                      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      PDF generating...
                    </div>
                  )
                )}
                {job.project_id && (
                  <Link
                    href={`/projects/${job.project_id}`}
                    className="min-h-[44px] flex items-center text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    View Project →
                  </Link>
                )}
                {job.accepted_proposal_id && (
                  <Link
                    href={`/proposals/${job.accepted_proposal_id}`}
                    className="min-h-[44px] flex items-center text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    View Accepted Proposal →
                  </Link>
                )}
                {job.salesperson && (
                  <p className="text-sm text-gray-900 py-2">
                    Sold by: {job.salesperson.full_name}
                  </p>
                )}
                {job.sale_date && (
                  <p className="text-sm text-gray-900 py-2">
                    Sale date: {new Date(job.sale_date + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                  </p>
                )}
              </div>
            </div>
            </div>{/* end overview tab wrapper (permit + related) */}

          </div>
        </div>
      </div>

      {showScheduleModal && job && (
        <ScheduleJobModal
          mode={scheduleModalMode}
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
          onClose={() => {
            setShowScheduleModal(false)
            setScheduleModalMode('schedule')
          }}
          onSave={() => {
            setShowScheduleModal(false)
            setScheduleModalMode('schedule')
            reloadJob()
          }}
        />
      )}

      {showCompleteModal && (
        <CompleteJobModal
          jobId={job.id}
          remainingCents={
            Math.round((job.sale_amount || 0) * 100) - (paymentSummary?.collected_cents || 0)
          }
          onClose={() => setShowCompleteModal(false)}
          onConfirm={handleCompleteWithBalance}
        />
      )}
    </div>
  )
}
