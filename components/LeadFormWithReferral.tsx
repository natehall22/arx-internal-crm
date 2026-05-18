'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClientBrowser } from '@/lib/supabase/client'
import LeadInspectionScheduleModal from '@/components/leads/LeadInspectionScheduleModal'

interface ReferrerResult {
  id: string
  type: 'customer' | 'lead'
  name: string
  phone: string | null
  email: string | null
  address: string | null
}

const leadStatuses = [
  'new',
  'contacted',
  'appointment',
  'inspection',
  'estimate_sent',
  'won',
  'lost',
] as const

const leadSources = [
  'ad_campaign',
  'door_to_door',
  'call_in',
  'referral',
  'web',
  'other',
]

interface LeadFormWithReferralProps {
  orgId: string
  userId: string
  defaultBonusAmount?: number
  /** Enables post-create “Schedule inspection” when user also has scheduling:create server-side */
  canScheduleInspection?: boolean
}

export default function LeadFormWithReferral({
  orgId,
  userId,
  defaultBonusAmount = 100,
  canScheduleInspection = false,
}: LeadFormWithReferralProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null)
  /** Snapshot at save-time: name + phone + address required for RR / pin */
  const [savedEligibleForSchedule, setSavedEligibleForSchedule] = useState(false)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [source, setSource] = useState('')
  
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
    status: 'new',
    notes: '',
  })

  // Load default bonus from org settings
  useEffect(() => {
    loadDefaultBonus()
  }, [])

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
    const supabase = createClientBrowser()
    const searchPattern = `%${query}%`

    // Search customers
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name, phone, email, address_text')
      .eq('org_id', orgId)
      .or(`name.ilike.${searchPattern},phone.ilike.${searchPattern},email.ilike.${searchPattern},address_text.ilike.${searchPattern}`)
      .limit(10)

    // Search leads (existing customers who might refer)
    const { data: leads } = await supabase
      .from('leads')
      .select('id, homeowner_name, phone, email, address_text')
      .eq('org_id', orgId)
      .in('status', ['won', 'appointment', 'inspection', 'estimate_sent']) // Only leads that became customers
      .or(`homeowner_name.ilike.${searchPattern},phone.ilike.${searchPattern},email.ilike.${searchPattern},address_text.ilike.${searchPattern}`)
      .limit(10)

    const results: ReferrerResult[] = [
      ...(customers || []).map(c => ({
        id: c.id,
        type: 'customer' as const,
        name: c.name || 'Unnamed Customer',
        phone: c.phone,
        email: c.email,
        address: c.address_text,
      })),
      ...(leads || []).map(l => ({
        id: l.id,
        type: 'lead' as const,
        name: l.homeowner_name || 'Unnamed Lead',
        phone: l.phone,
        email: l.email,
        address: l.address_text,
      })),
    ]

    // Remove duplicates (by name+phone combo)
    const seen = new Set<string>()
    const uniqueResults = results.filter(r => {
      const key = `${r.name}-${r.phone}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    setSearchResults(uniqueResults)
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
    setSaving(true)

    const supabase = createClientBrowser()

    // Create the lead via API
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: userId,
        homeowner_name: form.homeowner_name || null,
        phone: form.phone || null,
        email: form.email || null,
        address_text: form.address_text || null,
        source: source || null,
        status: form.status,
        notes: form.notes || null,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Lead creation error:', errorData)
      alert(errorData.error || 'Failed to create lead. Please try again.')
      setSaving(false)
      return
    }

    const { lead_id } = await response.json()
    const lead = { id: lead_id }

    // If there's a referrer selected, create the referral record
    if (selectedReferrer && source === 'referral') {
      // First, ensure the referrer has a customer record (or create one if they're a lead)
      let referrerCustomerId = selectedReferrer.type === 'customer' ? selectedReferrer.id : null

      if (selectedReferrer.type === 'lead') {
        // Check if this lead has an associated customer by phone (most reliable)
        let existingCustomer = null
        if (selectedReferrer.phone) {
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('org_id', orgId)
            .eq('phone', selectedReferrer.phone)
            .limit(1)
            .maybeSingle()
          existingCustomer = data
        }
        
        // If not found by phone, try by name
        if (!existingCustomer && selectedReferrer.name) {
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('org_id', orgId)
            .eq('name', selectedReferrer.name)
            .limit(1)
            .maybeSingle()
          existingCustomer = data
        }

        if (existingCustomer) {
          referrerCustomerId = existingCustomer.id
        } else {
          // Create a customer record for this lead
          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({
              org_id: orgId,
              name: selectedReferrer.name,
              phone: selectedReferrer.phone,
              email: selectedReferrer.email,
              address_text: selectedReferrer.address,
            })
            .select('id')
            .single()

          if (newCustomer) {
            referrerCustomerId = newCustomer.id
          }
        }
      }

      if (referrerCustomerId) {
        // Create the referral record
        const { error: referralError } = await supabase
          .from('referrals')
          .insert({
            org_id: orgId,
            referrer_customer_id: referrerCustomerId,
            referrer_name: selectedReferrer.name,
            referrer_email: selectedReferrer.email,
            referrer_phone: selectedReferrer.phone,
            referred_name: form.homeowner_name || 'New Lead',
            referred_email: form.email,
            referred_phone: form.phone,
            referred_address: form.address_text,
            referred_lead_id: lead.id,
            bonus_amount: parseFloat(bonusAmount) || defaultBonusAmount,
            bonus_type: 'cash',
            status: 'pending',
            created_by: userId,
          })

        if (referralError) {
          console.error('Referral creation error:', referralError)
          // Don't fail the whole operation, just log it
        }
      }
    }

    const hasBasicsForSchedule =
      !!form.homeowner_name?.trim() && !!form.phone?.trim() && !!form.address_text?.trim()

    setSavedLeadId(lead.id)
    setSavedEligibleForSchedule(hasBasicsForSchedule)
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
      status: 'new',
      notes: '',
    })
    setSource('')
    setSelectedReferrer(null)
  }

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
                Schedule inspection…
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
              Add name, phone, and address on the lead record, then use <strong>Schedule inspection</strong> from the lead
              page.
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

    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-500">Homeowner Name</label>
          <input
            value={form.homeowner_name}
            onChange={(e) => setForm(prev => ({ ...prev, homeowner_name: e.target.value }))}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-500">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="(555) 555-5555"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-500">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="homeowner@email.com"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-500">Address</label>
          <input
            value={form.address_text}
            onChange={(e) => setForm(prev => ({ ...prev, address_text: e.target.value }))}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="123 Main St, Dallas TX"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-500">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select source</option>
            {leadSources.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-500">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm(prev => ({ ...prev, status: e.target.value }))}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {leadStatuses.map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

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
                  <p className="text-sm text-gray-500">
                    {selectedReferrer.type === 'customer' ? 'Customer' : 'Previous Lead'}
                    {selectedReferrer.phone && ` • ${selectedReferrer.phone}`}
                  </p>
                  {selectedReferrer.address && (
                    <p className="text-sm text-gray-500">{selectedReferrer.address}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearReferrer}
                  className="text-gray-400 hover:text-red-500"
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
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
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
                          <p className="text-sm text-gray-500">
                            {result.phone || result.email || 'No contact info'}
                          </p>
                          {result.address && (
                            <p className="text-xs text-gray-400">{result.address}</p>
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
                <p className="mt-2 text-sm text-gray-500">
                  Type at least 2 characters to search...
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-sm font-medium text-gray-500">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
          rows={4}
          className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Add details about the lead..."
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={saving || !!savedLeadId}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : savedLeadId ? 'Lead created' : 'Create lead'}
        </button>
        
        {source !== 'referral' && (
          <button
            type="button"
            onClick={() => setSource('referral')}
            className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
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
