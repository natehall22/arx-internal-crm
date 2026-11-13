'use client'

import { useState, useEffect, useRef } from 'react'

import CategoryPicker from '@/components/categories/CategoryPicker'
import { useOrgCategories } from '@/hooks/useOrgCategories'
import { activeCategories } from '@/lib/categories'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'
import LeadInspectionScheduleModal from '@/components/leads/LeadInspectionScheduleModal'
import { MANUAL_LEAD_SOURCES } from '@/lib/lead-sources'
import { toast } from '@/components/ui/toast'
import { formatPhone } from '@/lib/format'

interface ReferrerResult {
  id: string
  type: 'customer' | 'lead'
  name: string
  phone: string | null
  email: string | null
  address: string | null
}

interface LeadFormWithReferralProps {
  orgId: string
  userId: string
  defaultBonusAmount?: number
  /** Enables post-create “Schedule inspection” when user also has scheduling:create server-side */
  canScheduleInspection?: boolean
  /** The name field's label (industry profile word; roofing: "Homeowner Name"). */
  nameLabel?: string
  /** The company's word for the first visit, lower case (industry profile; roofing: "inspection"). */
  inspectionWord?: string
  /** The company's service choices (Admin → Campaigns); none = no Service field. */
  serviceChoices?: string[]
  /** People to pick as owner. Given only for a company that set up lead routing: the default is "Me"; "Assign automatically" is an explicit choice. */
  ownerChoices?: Array<{ id: string; name: string }> | null
}

type SchedulingResources = {
  allowed: boolean
  teams: Array<{ id: string; name: string }>
  users: Array<{ id: string; full_name: string; has_calendar?: boolean }>
  inspectionDurationMinutes: number
}

export default function LeadFormWithReferral({
  orgId,
  userId,
  defaultBonusAmount = 100,
  canScheduleInspection = false,
  nameLabel = 'Homeowner Name',
  inspectionWord = 'inspection',
  serviceChoices = [],
  ownerChoices = null,
}: LeadFormWithReferralProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null)
  /** Snapshot at save-time: address is required so scheduling can place a map pin. */
  const [savedEligibleForSchedule, setSavedEligibleForSchedule] = useState(false)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [slotPickerOpen, setSlotPickerOpen] = useState(false)
  const [selectedSchedule, setSelectedSchedule] = useState<CloseScheduleConfirm | null>(null)
  const [schedulingResources, setSchedulingResources] = useState<SchedulingResources | null>(null)
  const [schedulingLoadError, setSchedulingLoadError] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [serviceRequested, setServiceRequested] = useState('')
  // The work category (Residential / Commercial / ...): one tap, optional. Hidden when the company has none turned on.
  const categories = useOrgCategories()
  const [category, setCategory] = useState<string | null>(null)
  const [ownerChoice, setOwnerChoice] = useState(userId)
  
  // Referral state
  const [showReferralSearch, setShowReferralSearch] = useState(false)
  const [referralSearch, setReferralSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ReferrerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedReferrer, setSelectedReferrer] = useState<ReferrerResult | null>(null)
  const [bonusAmount, setBonusAmount] = useState(defaultBonusAmount.toString())
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Form state
  const [form, setForm] = useState({
    homeowner_name: '',
    phone: '',
    email: '',
    address_text: '',
    notes: '',
  })

  // Load default bonus from org settings
  useEffect(() => {
    loadDefaultBonus()
  }, [])

  useEffect(() => {
    if (!canScheduleInspection) return

    let cancelled = false
    setSchedulingLoadError(null)

    fetch('/api/leads/scheduling-resources')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setSchedulingResources({
          allowed: Boolean(data?.allowed),
          teams: Array.isArray(data?.teams) ? data.teams : [],
          users: Array.isArray(data?.users) ? data.users : [],
          inspectionDurationMinutes:
            typeof data?.inspectionDurationMinutes === 'number' ? data.inspectionDurationMinutes : 60,
        })
      })
      .catch(() => {
        if (!cancelled) setSchedulingLoadError('Could not load scheduling options.')
      })

    return () => {
      cancelled = true
    }
  }, [canScheduleInspection])

  const loadDefaultBonus = async () => {
    const supabase = createClientBrowser()
    const { data: org } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', orgId)
      .single()
    
    if (org?.settings?.referral_bonus) {
      setBonusAmount(org.settings.referral_bonus.toString())
    }
  }

  // Auto-show referral search when source is 'referral'
  useEffect(() => {
    if (source === 'referral') {
      setShowReferralSearch(true)
    }
  }, [source])

  // Debounced search for referrers
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (referralSearch.length < 2) {
      setSearchResults([])
      return
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchReferrers(referralSearch)
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [referralSearch])

  const searchReferrers = async (query: string) => {
    setSearching(true)
    try {
      const res = await fetch(`/api/referrals/referrer-search?q=${encodeURIComponent(query)}`)
      const json = res.ok ? await res.json() : { results: [] }
      setSearchResults((json.results ?? []) as ReferrerResult[])
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }

  const selectReferrer = (referrer: ReferrerResult) => {
    setSelectedReferrer(referrer)
    setReferralSearch('')
    setSearchResults([])
  }

  const clearReferrer = () => {
    setSelectedReferrer(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (selectedSchedule) {
      const missingScheduleFields = [
        !form.homeowner_name.trim() ? nameLabel.toLowerCase() : null,
        !form.phone.trim() ? 'phone' : null,
        !form.address_text.trim() ? 'address' : null,
      ].filter(Boolean)

      if (missingScheduleFields.length > 0) {
        toast(`Add ${missingScheduleFields.join(', ')} before saving the scheduled ${inspectionWord}.`)
        return
      }
    }

    setSaving(true)

    // Create the lead via API
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Without a routing setup the person typing owns it (as always). With one, "Assign automatically" sends no owner so the
        // server routes it; a person picked by hand always wins.
        ...(ownerChoices && ownerChoice === 'auto' ? {} : { owner_user_id: ownerChoices ? ownerChoice : userId }),
        service_requested: serviceRequested || null,
        category,
        homeowner_name: form.homeowner_name || null,
        phone: form.phone || null,
        email: form.email || null,
        address_text: form.address_text || null,
        source: source || null,
        notes: form.notes || null,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Lead creation error:', errorData)
      toast.error(errorData.error || 'Failed to create lead. Please try again.')
      setSaving(false)
      return
    }

    const { lead_id } = await response.json()
    const lead = { id: lead_id }

    // If there's a referrer selected, the server finds/creates their customer and records the referral
    // (the setter's phone never needs the referrer's phone / email).
    if (selectedReferrer && source === 'referral') {
      const referralRes = await fetch('/api/referrals/for-new-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrer_type: selectedReferrer.type,
          referrer_id: selectedReferrer.id,
          referred_lead_id: lead.id,
          bonus_amount: parseFloat(bonusAmount) || defaultBonusAmount,
        }),
      }).catch(() => null)
      if (!referralRes?.ok) console.error('Referral creation error')
      // Don't fail the whole operation, just log it
    }

    const hasSchedulableAddress = !!form.address_text?.trim()

    setSavedLeadId(lead.id)
    setSavedEligibleForSchedule(hasSchedulableAddress)
    if (selectedSchedule) {
      const closerUserId =
        selectedSchedule.useRoundRobin && selectedSchedule.teamId
          ? `team:${selectedSchedule.teamId}`
          : selectedSchedule.closerUserId
      const scheduleRes = await fetch(`/api/leads/${lead.id}/schedule-inspection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspection_scheduled_for: selectedSchedule.scheduledLocal,
          use_round_robin: selectedSchedule.useRoundRobin,
          closer_user_id: closerUserId,
        }),
      })
      const scheduleData = await scheduleRes.json().catch(() => ({}))

      if (!scheduleRes.ok) {
        toast.error(
          typeof (scheduleData as { error?: string }).error === 'string'
            ? (scheduleData as { error: string }).error
            : 'Lead was created, but scheduling failed. Open the lead to try another slot.'
        )
        setSaving(false)
        return
      }

      router.push(`/leads/${lead.id}`)
    } else if (canScheduleInspection && hasSchedulableAddress) {
      setScheduleModalOpen(true)
    }
    setSaving(false)
  }

  const startAnotherLead = () => {
    setSavedLeadId(null)
    setSavedEligibleForSchedule(false)
    setScheduleModalOpen(false)
    setForm({
      homeowner_name: '',
      phone: '',
      email: '',
      address_text: '',
      notes: '',
    })
    setSource('')
    setServiceRequested('')
    setOwnerChoice(userId)
    setSelectedReferrer(null)
    setSelectedSchedule(null)
  }

  const selectedScheduleLabel = selectedSchedule
    ? new Date(selectedSchedule.scheduledLocal).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <>
      {savedLeadId && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-900 mb-3">Lead saved successfully.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/leads/${savedLeadId}`}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Open lead →
            </Link>
            {canScheduleInspection && savedEligibleForSchedule && (
              <button
                type="button"
                onClick={() => setScheduleModalOpen(true)}
                className="inline-flex rounded-md border border-green-700 bg-white px-4 py-2 text-sm font-semibold text-green-900 hover:bg-green-50"
              >
                Schedule {inspectionWord}…
              </button>
            )}
            <button
              type="button"
              onClick={startAnotherLead}
              className="inline-flex rounded-md px-4 py-2 text-sm font-medium text-gray-700 underline-offset-4 hover:underline"
            >
              Create another lead
            </button>
          </div>
          {canScheduleInspection && !savedEligibleForSchedule && (
            <p className="mt-3 text-xs text-amber-800">
              Add an address on the lead record, then use <strong>Schedule {inspectionWord}</strong> from the lead page.
            </p>
          )}
        </div>
      )}

      <LeadInspectionScheduleModal
        leadId={savedLeadId ?? ''}
        open={scheduleModalOpen && Boolean(savedLeadId)}
        onClose={() => setScheduleModalOpen(false)}
        onScheduled={() => router.push(`/leads/${savedLeadId ?? ''}`)}
      />

      {schedulingResources?.allowed && (
        <CloseScheduleModal
          open={slotPickerOpen}
          onClose={() => setSlotPickerOpen(false)}
          onConfirm={(params) => {
            setSelectedSchedule(params)
            setSlotPickerOpen(false)
          }}
          closeDurationMinutes={schedulingResources.inspectionDurationMinutes}
          users={schedulingResources.users}
          teams={schedulingResources.teams}
          modalTitle={`Pick ${inspectionWord} time`}
          intro={
            <p>
              Pick an open {inspectionWord} slot. It is booked when you create the lead.
            </p>
          }
          summaryHint="This slot will be booked when you create the lead."
          showAvailableCloserCounts
        />
      )}

    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-[#2c2c2a]">{nameLabel}</label>
          <input
            value={form.homeowner_name}
            onChange={(e) => setForm(prev => ({ ...prev, homeowner_name: e.target.value }))}
            className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[#2c2c2a]">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
            className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
            placeholder="(555) 555-5555"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[#2c2c2a]">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
            className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
            placeholder="homeowner@email.com"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[#2c2c2a]">Address</label>
          <input
            value={form.address_text}
            onChange={(e) => setForm(prev => ({ ...prev, address_text: e.target.value }))}
            className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
            placeholder="123 Main St, Dallas TX"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[#2c2c2a]">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
          >
            <option value="">Select source</option>
            {MANUAL_LEAD_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {serviceChoices.length > 0 && (
          <div>
            <label htmlFor="lead-service" className="text-sm font-medium text-[#2c2c2a]">Service requested</label>
            <select
              id="lead-service"
              value={serviceRequested}
              onChange={(e) => setServiceRequested(e.target.value)}
              className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
            >
              <option value="">Not sure</option>
              {serviceChoices.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        {categories && activeCategories(categories).length > 0 && (
          <div>
            <span className="text-sm font-medium text-[#2c2c2a]">Category</span>
            <div className="mt-2">
              <CategoryPicker options={categories} value={category} onChange={setCategory} label="Category" />
            </div>
          </div>
        )}
        {ownerChoices && (
          <div>
            <label htmlFor="lead-owner" className="text-sm font-medium text-[#2c2c2a]">Owner</label>
            <select
              id="lead-owner"
              value={ownerChoice}
              onChange={(e) => setOwnerChoice(e.target.value)}
              className="mt-2 w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
            >
              <option value={userId}>Me</option>
              <option value="auto">Assign automatically</option>
              {ownerChoices.filter((p) => p.id !== userId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {canScheduleInspection && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-green-950">Schedule {inspectionWord}</h3>
              <p className="mt-1 text-sm text-green-950/80">
                Optional. Pick a time now and it is booked when you save.
              </p>
              {selectedScheduleLabel && (
                <p className="mt-2 text-sm font-medium text-green-900">
                  Selected: {selectedScheduleLabel}
                </p>
              )}
              {schedulingLoadError && (
                <p className="mt-2 text-sm font-medium text-amber-800">{schedulingLoadError}</p>
              )}
            </div>
            <div className="flex gap-2">
              {selectedSchedule && (
                <button
                  type="button"
                  onClick={() => setSelectedSchedule(null)}
                  className="rounded-md border border-green-700 bg-white px-3 py-2 text-sm font-semibold text-green-900 hover:bg-green-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setSlotPickerOpen(true)}
                disabled={!schedulingResources?.allowed}
                className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
              >
                {selectedSchedule ? 'Change slot' : 'Pick available slot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Referral Section */}
      {source === 'referral' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="font-medium text-indigo-900">Referral Information</h3>
            </div>
          </div>

          {selectedReferrer ? (
            <div className="bg-white rounded-lg p-3 border border-indigo-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{selectedReferrer.name}</p>
                  <p className="text-sm text-gray-700">
                    {selectedReferrer.type === 'customer' ? 'Customer' : 'Previous Lead'}
                    {selectedReferrer.phone && ` • ${formatPhone(selectedReferrer.phone)}`}
                  </p>
                  {selectedReferrer.address && (
                    <p className="text-sm text-gray-700">{selectedReferrer.address}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearReferrer}
                  className="text-gray-600 hover:text-red-500"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Bonus Amount */}
              <div className="mt-3 pt-3 border-t">
                <label className="text-sm font-medium text-gray-700">Referral Bonus Amount</label>
                <div className="mt-1 relative w-32">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-700">$</span>
                  <input
                    type="number"
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-indigo-800 mb-2 block">
                Who referred this lead?
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={referralSearch}
                  onChange={(e) => setReferralSearch(e.target.value)}
                  placeholder="Search by name, phone, or address..."
                  className="w-full px-4 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <svg className="animate-spin h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="mt-2 bg-white border border-indigo-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {searchResults.map((result) => (
                    <button
                      key={`${result.type}-${result.id}`}
                      type="button"
                      onClick={() => selectReferrer(result)}
                      className="w-full px-4 py-3 text-left hover:bg-indigo-50 border-b last:border-b-0 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{result.name}</p>
                          <p className="text-sm text-gray-700">
                            {result.phone ? formatPhone(result.phone) : result.email || 'No contact info'}
                          </p>
                          {result.address && (
                            <p className="text-xs text-gray-600">{result.address}</p>
                          )}
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          result.type === 'customer' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {result.type === 'customer' ? 'Customer' : 'Lead'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {referralSearch.length >= 2 && searchResults.length === 0 && !searching && (
                <p className="mt-2 text-sm text-indigo-600">
                  No matching customers or leads found. The referral can be added later.
                </p>
              )}

              {referralSearch.length < 2 && referralSearch.length > 0 && (
                <p className="mt-2 text-sm text-gray-700">
                  Type at least 2 characters to search...
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-sm font-medium text-[#2c2c2a]">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
          rows={4}
          className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-base text-[#2c2c2a]"
          placeholder="Add details about the lead..."
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={saving || !!savedLeadId}
          className="min-h-[44px] rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : savedLeadId ? 'Lead created' : 'Create lead'}
        </button>
        
        {source !== 'referral' && (
          <button
            type="button"
            onClick={() => setSource('referral')}
            className="min-h-[44px] text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            This is a referral
          </button>
        )}
      </div>
    </form>
    </>
  )
}
