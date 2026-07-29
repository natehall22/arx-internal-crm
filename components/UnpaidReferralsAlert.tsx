'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface UnpaidReferral {
  id: string
  referrer_name: string | null
  referred_name: string
  bonus_amount: number
  install_date: string
  days_since_install: number
  referrer_customer_id: string
}

/** Matches the `p_days_threshold` default on `get_unpaid_referrals()`. */
const UNPAID_ALERT_DAYS = 7

function daysSince(installDate: string): number {
  const diffMs = Date.now() - new Date(installDate).getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

export default function UnpaidReferralsAlert() {
  const [unpaidReferrals, setUnpaidReferrals] = useState<UnpaidReferral[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    loadUnpaidReferrals()
  }, [])

  const loadUnpaidReferrals = async () => {
    const supabase = createClientBrowser()
    
    // Get current user's org
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) return

    // Only show to admins and managers
    if (!['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)) {
      setLoading(false)
      return
    }

    // `days_since_install` is computed, not stored — selecting and filtering on it as
    // a column made every request fail, which the `!error` guard below swallowed, so
    // this alert never fired. Filter on install_date and derive the age here.
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - UNPAID_ALERT_DAYS)
    const cutoffDate = cutoff.toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('referrals')
      .select('id, referrer_name, referred_name, bonus_amount, install_date, referrer_customer_id')
      .eq('org_id', profile.org_id)
      .eq('status', 'installed')
      .is('paid_at', null)
      .not('install_date', 'is', null)
      .lte('install_date', cutoffDate)
      .order('install_date', { ascending: true })

    if (error) {
      console.error('Error loading unpaid referrals:', error)
      setLoading(false)
      return
    }

    setUnpaidReferrals(
      (data || []).map((referral) => ({
        ...referral,
        bonus_amount: Number(referral.bonus_amount) || 0,
        days_since_install: daysSince(referral.install_date),
      }))
    )
    setLoading(false)
  }

  if (loading || dismissed || unpaidReferrals.length === 0) {
    return null
  }

  const totalOwed = unpaidReferrals.reduce((sum, r) => sum + r.bonus_amount, 0)

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-orange-800">
              {unpaidReferrals.length} Unpaid Referral{unpaidReferrals.length > 1 ? 's' : ''} Need Attention
            </h3>
            <p className="text-sm text-orange-700 mt-1">
              Total owed: <span className="font-semibold">${totalOwed.toFixed(2)}</span>
            </p>
            <div className="mt-3 space-y-2">
              {unpaidReferrals.slice(0, 3).map((referral) => (
                <div key={referral.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-orange-900 font-medium">{referral.referrer_name || 'Unknown'}</span>
                    <span className="text-orange-700"> referred </span>
                    <span className="text-orange-900">{referral.referred_name}</span>
                    <span className="text-orange-600 ml-2">
                      ({referral.days_since_install} days ago)
                    </span>
                  </div>
                  <span className="font-medium text-orange-800">${referral.bonus_amount.toFixed(2)}</span>
                </div>
              ))}
              {unpaidReferrals.length > 3 && (
                <p className="text-sm text-orange-600">
                  +{unpaidReferrals.length - 3} more...
                </p>
              )}
            </div>
            <div className="mt-3 flex gap-3">
              {unpaidReferrals.length > 0 && (
                <Link
                  href={`/customers/${unpaidReferrals[0].referrer_customer_id}?tab=referrals`}
                  className="text-sm font-medium text-orange-700 hover:text-orange-900"
                >
                  View Referrals →
                </Link>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-orange-400 hover:text-orange-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
