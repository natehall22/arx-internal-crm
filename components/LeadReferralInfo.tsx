'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface ReferrerResult {
  id: string
  type: 'customer' | 'lead'
  name: string
  phone: string | null
  email: string | null
  address: string | null
}

interface Referral {
  id: string
  referrer_customer_id: string
  referrer_name: string | null
  bonus_amount: number
  bonus_type: string
  status: string
  paid_at: string | null
}

interface LeadReferralInfoProps {
  leadId: string
  leadName: string | null
  leadPhone: string | null
  leadEmail: string | null
  leadAddress: string | null
  orgId: string
  source: string | null
}

export default function LeadReferralInfo({ 
  leadId, 
  leadName,
  leadPhone,
  leadEmail,
  leadAddress,
  orgId,
  source 
}: LeadReferralInfoProps) {
  const [referral, setReferral] = useState<Referral | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ReferrerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bonusAmount, setBonusAmount] = useState('100')
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadReferral()
  }, [leadId])

  const loadReferral = async () => {
    try {
      const response = await fetch(`/api/referrals?lead_id=${leadId}`)
      if (response.ok) {
        const { referral: data } = await response.json()
        setReferral(data)
      }
    } catch (err) {
      console.error('Error loading referral:', err)
    } finally {
      setLoading(false)
    }
  }

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchReferrers(searchQuery)
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

  const searchReferrers = async (query: string) => {
    setSearching(true)
    try {
      const response = await fetch(`/api/referrals?q=${encodeURIComponent(query)}&exclude_lead_id=${leadId}`)
      if (response.ok) {
        const { results } = await response.json()
        setSearchResults(results || [])
      }
    } catch (err) {
      console.error('Error searching referrers:', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const selectReferrer = async (referrer: ReferrerResult) => {
    setSaving(true)
    try {
      const response = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrer,
          leadId,
          leadName,
          leadEmail,
          leadPhone,
          leadAddress,
          bonusAmount: parseFloat(bonusAmount) || 100,
        })
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to link referral: ${data.error}`)
      } else {
        await loadReferral()
      }
    } catch (err) {
      console.error('Error creating referral:', err)
      alert('Failed to link referral')
    }

    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setSaving(false)
  }

  const removeReferral = async () => {
    if (!referral) return
    if (!confirm('Remove this referral link? The referral record will be deleted.')) return

    try {
      const response = await fetch(`/api/referrals?id=${referral.id}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        setReferral(null)
      }
    } catch (err) {
      console.error('Error removing referral:', err)
    }
  }

  if (loading) {
    return null
  }

  // Only show if source is referral or there's already a referral linked
  if (source !== 'referral' && !referral) {
    return null
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <h3 className="font-medium text-indigo-900">Referral Information</h3>
      </div>

      {referral ? (
        <div className="bg-white rounded-lg p-3 border border-indigo-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-600">Referred by:</p>
              <p className="font-medium text-gray-900">{referral.referrer_name || 'Unknown'}</p>
              <div className="mt-2 flex items-center gap-3 text-sm">
                <span className="text-green-600 font-medium">
                  ${referral.bonus_amount.toFixed(2)} {referral.bonus_type}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  referral.status === 'paid' ? 'bg-green-100 text-green-700' :
                  referral.status === 'installed' ? 'bg-purple-100 text-purple-700' :
                  referral.status === 'qualified' ? 'bg-blue-100 text-blue-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {referral.status}
                </span>
                {referral.paid_at && (
                  <span className="text-gray-500">
                    Paid {new Date(referral.paid_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/customers/${referral.referrer_customer_id}?tab=referrals`}
                className="text-sm text-indigo-600 hover:text-indigo-800"
              >
                View →
              </Link>
              <button
                onClick={removeReferral}
                className="text-gray-400 hover:text-red-500"
                title="Remove referral link"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : showSearch ? (
        <div>
          <label className="text-sm font-medium text-indigo-800 mb-2 block">
            Who referred this lead?
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, phone, or address..."
              className="w-full px-4 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              autoFocus
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

          {/* Bonus Amount */}
          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm text-indigo-800">Bonus:</label>
            <div className="relative w-24">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                className="w-full pl-6 pr-2 py-1 border border-indigo-300 rounded text-sm"
              />
            </div>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-2 bg-white border border-indigo-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  type="button"
                  onClick={() => selectReferrer(result)}
                  disabled={saving}
                  className="w-full px-4 py-3 text-left hover:bg-indigo-50 border-b last:border-b-0 transition disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{result.name}</p>
                      <p className="text-sm text-gray-500">
                        {result.phone || result.email || 'No contact info'}
                      </p>
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

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setShowSearch(false)}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-indigo-700 mb-2">
            This lead came from a referral but hasn&apos;t been linked to a referrer yet.
          </p>
          <button
            onClick={() => setShowSearch(true)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            + Link to referrer
          </button>
        </div>
      )}
    </div>
  )
}
