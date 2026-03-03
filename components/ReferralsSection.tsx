'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface Referral {
  id: string
  referrer_customer_id: string
  referrer_name: string | null
  referrer_email: string | null
  referred_name: string
  referred_email: string | null
  referred_phone: string | null
  referred_address: string | null
  referred_notes: string | null
  referred_customer_id: string | null
  referred_lead_id: string | null
  referred_project_id: string | null
  bonus_amount: number
  bonus_type: string
  status: 'pending' | 'qualified' | 'installed' | 'paid' | 'cancelled'
  install_date: string | null
  paid_at: string | null
  created_at: string
}

function getDaysSinceInstall(referral: Referral): number | null {
  if (!referral.install_date || referral.paid_at) return null
  const installDate = new Date(referral.install_date)
  const today = new Date()
  const diffTime = today.getTime() - installDate.getTime()
  return Math.floor(diffTime / (1000 * 60 * 60 * 24))
}

interface ReferralsSectionProps {
  customerId?: string
  projectId?: string
  customerName?: string
  orgId: string
  canManage?: boolean
}

export default function ReferralsSection({ 
  customerId, 
  projectId, 
  customerName,
  orgId,
  canManage = false 
}: ReferralsSectionProps) {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingReferral, setEditingReferral] = useState<Referral | null>(null)
  const [defaultBonus, setDefaultBonus] = useState(100)
  
  const [form, setForm] = useState({
    referred_name: '',
    referred_email: '',
    referred_phone: '',
    referred_address: '',
    referred_notes: '',
    bonus_amount: '100',
    bonus_type: 'cash',
  })

  useEffect(() => {
    loadReferrals()
    loadDefaultBonus()
  }, [customerId, projectId])

  const loadDefaultBonus = async () => {
    const supabase = createClientBrowser()
    const { data: org } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', orgId)
      .single()
    
    if (org?.settings?.referral_bonus) {
      setDefaultBonus(org.settings.referral_bonus)
      setForm(prev => ({ ...prev, bonus_amount: org.settings.referral_bonus.toString() }))
    }
  }

  const loadReferrals = async () => {
    const supabase = createClientBrowser()
    
    let query = supabase
      .from('referrals')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (customerId) {
      // Show referrals made BY this customer AND referrals OF this customer
      query = query.or(`referrer_customer_id.eq.${customerId},referred_customer_id.eq.${customerId}`)
    }
    
    if (projectId) {
      query = query.eq('referred_project_id', projectId)
    }

    const { data, error } = await query
    
    if (error) {
      console.error('Error loading referrals:', error)
    } else {
      setReferrals(data || [])
    }
    setLoading(false)
  }

  const openModal = (referral?: Referral) => {
    if (referral) {
      setEditingReferral(referral)
      setForm({
        referred_name: referral.referred_name,
        referred_email: referral.referred_email || '',
        referred_phone: referral.referred_phone || '',
        referred_address: referral.referred_address || '',
        referred_notes: referral.referred_notes || '',
        bonus_amount: referral.bonus_amount.toString(),
        bonus_type: referral.bonus_type || 'cash',
      })
    } else {
      setEditingReferral(null)
      setForm({
        referred_name: '',
        referred_email: '',
        referred_phone: '',
        referred_address: '',
        referred_notes: '',
        bonus_amount: defaultBonus.toString(),
        bonus_type: 'cash',
      })
    }
    setShowModal(true)
  }

  const saveReferral = async () => {
    if (!form.referred_name.trim()) {
      alert('Referred person name is required')
      return
    }

    if (!customerId) {
      alert('Customer ID is required to create a referral')
      return
    }

    setSaving(true)
    const supabase = createClientBrowser()

    const referralData = {
      org_id: orgId,
      referrer_customer_id: customerId,
      referrer_name: customerName || null,
      referred_name: form.referred_name.trim(),
      referred_email: form.referred_email.trim() || null,
      referred_phone: form.referred_phone.trim() || null,
      referred_address: form.referred_address.trim() || null,
      referred_notes: form.referred_notes.trim() || null,
      bonus_amount: parseFloat(form.bonus_amount) || defaultBonus,
      bonus_type: form.bonus_type,
    }

    if (editingReferral) {
      const { error } = await supabase
        .from('referrals')
        .update(referralData)
        .eq('id', editingReferral.id)
      
      if (error) {
        alert(`Failed to update referral: ${error.message}`)
        setSaving(false)
        return
      }
    } else {
      const { error } = await supabase
        .from('referrals')
        .insert(referralData)
      
      if (error) {
        alert(`Failed to create referral: ${error.message}`)
        setSaving(false)
        return
      }
    }

    setShowModal(false)
    await loadReferrals()
    setSaving(false)
  }

  const updateStatus = async (referralId: string, newStatus: string) => {
    const supabase = createClientBrowser()
    
    const updateData: any = { status: newStatus }
    
    // If marking as installed, set install date
    if (newStatus === 'installed') {
      updateData.install_date = new Date().toISOString().split('T')[0]
    }
    
    // If marking as paid, set paid date
    if (newStatus === 'paid') {
      updateData.paid_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('referrals')
      .update(updateData)
      .eq('id', referralId)

    if (error) {
      alert(`Failed to update status: ${error.message}`)
    } else {
      await loadReferrals()
    }
  }

  const markAsPaid = async (referral: Referral) => {
    const paymentMethod = prompt('Payment method (e.g., Check #123, Venmo, Cash):')
    if (!paymentMethod) return

    const supabase = createClientBrowser()
    
    const { error } = await supabase
      .from('referrals')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        payment_method: paymentMethod,
      })
      .eq('id', referral.id)

    if (error) {
      alert(`Failed to mark as paid: ${error.message}`)
    } else {
      await loadReferrals()
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-700'
      case 'qualified': return 'bg-blue-100 text-blue-700'
      case 'installed': return 'bg-purple-100 text-purple-700'
      case 'paid': return 'bg-green-100 text-green-700'
      case 'cancelled': return 'bg-gray-100 text-gray-500'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const referralsMadeByCustomer = referrals.filter(r => r.referrer_customer_id === customerId)
  const referralsOfCustomer = referrals.filter(r => r.referred_customer_id === customerId)

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Referrals</h2>
            <p className="text-sm text-gray-500">
              {customerId ? 'Track referrals made by this customer' : 'Referral linked to this project'}
            </p>
          </div>
          {customerId && (
            <button
              onClick={() => openModal()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
            >
              + Add Referral
            </button>
          )}
        </div>

        {/* Referrals Made By This Customer */}
        {customerId && referralsMadeByCustomer.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Referrals Made ({referralsMadeByCustomer.length})</h3>
            <div className="space-y-3">
              {referralsMadeByCustomer.map((referral) => (
                <ReferralCard 
                  key={referral.id} 
                  referral={referral} 
                  type="made"
                  canManage={canManage}
                  onEdit={() => openModal(referral)}
                  onUpdateStatus={updateStatus}
                  onMarkPaid={markAsPaid}
                  getStatusColor={getStatusColor}
                />
              ))}
            </div>
          </div>
        )}

        {/* Referrals Of This Customer (they were referred) */}
        {customerId && referralsOfCustomer.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Referred By</h3>
            <div className="space-y-3">
              {referralsOfCustomer.map((referral) => (
                <ReferralCard 
                  key={referral.id} 
                  referral={referral} 
                  type="received"
                  canManage={canManage}
                  onEdit={() => openModal(referral)}
                  onUpdateStatus={updateStatus}
                  onMarkPaid={markAsPaid}
                  getStatusColor={getStatusColor}
                />
              ))}
            </div>
          </div>
        )}

        {/* Project-specific referrals */}
        {projectId && referrals.length > 0 && (
          <div className="space-y-3">
            {referrals.map((referral) => (
              <ReferralCard 
                key={referral.id} 
                referral={referral} 
                type="project"
                canManage={canManage}
                onEdit={() => openModal(referral)}
                onUpdateStatus={updateStatus}
                onMarkPaid={markAsPaid}
                getStatusColor={getStatusColor}
              />
            ))}
          </div>
        )}

        {referrals.length === 0 && (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="mt-2 text-sm text-gray-500">No referrals yet</p>
            {customerId && (
              <button
                onClick={() => openModal()}
                className="mt-3 text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              >
                Add first referral →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Referral Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">
                {editingReferral ? 'Edit Referral' : 'Add New Referral'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {customerName ? `Referral from ${customerName}` : 'Track a customer referral'}
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Referred Person Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.referred_name}
                  onChange={(e) => setForm(prev => ({ ...prev, referred_name: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="John Smith"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={form.referred_email}
                    onChange={(e) => setForm(prev => ({ ...prev, referred_email: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={form.referred_phone}
                    onChange={(e) => setForm(prev => ({ ...prev, referred_phone: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                <input
                  type="text"
                  value={form.referred_address}
                  onChange={(e) => setForm(prev => ({ ...prev, referred_address: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="123 Main St, City, State"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                <textarea
                  value={form.referred_notes}
                  onChange={(e) => setForm(prev => ({ ...prev, referred_notes: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                  placeholder="Any additional details..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bonus Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      value={form.bonus_amount}
                      onChange={(e) => setForm(prev => ({ ...prev, bonus_amount: e.target.value }))}
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bonus Type</label>
                  <select
                    value={form.bonus_type}
                    onChange={(e) => setForm(prev => ({ ...prev, bonus_type: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="gift_card">Gift Card</option>
                    <option value="credit">Account Credit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={saveReferral}
                disabled={saving || !form.referred_name.trim()}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingReferral ? 'Update' : 'Add Referral'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Referral Card Component
function ReferralCard({ 
  referral, 
  type,
  canManage,
  onEdit,
  onUpdateStatus,
  onMarkPaid,
  getStatusColor
}: { 
  referral: Referral
  type: 'made' | 'received' | 'project'
  canManage: boolean
  onEdit: () => void
  onUpdateStatus: (id: string, status: string) => void
  onMarkPaid: (referral: Referral) => void
  getStatusColor: (status: string) => string
}) {
  const daysSinceInstall = getDaysSinceInstall(referral)
  const needsAttention = referral.status === 'installed' && !referral.paid_at && (daysSinceInstall || 0) >= 7

  return (
    <div className={`border rounded-lg p-4 ${needsAttention ? 'border-orange-300 bg-orange-50' : 'hover:bg-gray-50'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">
              {type === 'received' ? referral.referrer_name : referral.referred_name}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(referral.status)}`}>
              {referral.status}
            </span>
            {needsAttention && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-200 text-orange-800">
                ⚠️ Unpaid {daysSinceInstall} days
              </span>
            )}
          </div>
          
          <div className="mt-1 text-sm text-gray-500 space-y-1">
            {type === 'received' && (
              <p>You were referred by this customer</p>
            )}
            {referral.referred_phone && <p>Phone: {referral.referred_phone}</p>}
            {referral.referred_email && <p>Email: {referral.referred_email}</p>}
            {referral.referred_address && <p>Address: {referral.referred_address}</p>}
          </div>

          <div className="mt-2 flex items-center gap-4 text-sm">
            <span className="font-medium text-green-600">
              ${referral.bonus_amount.toFixed(2)} {referral.bonus_type}
            </span>
            {referral.install_date && (
              <span className="text-gray-500">
                Installed: {new Date(referral.install_date).toLocaleDateString()}
              </span>
            )}
            {referral.paid_at && (
              <span className="text-green-600">
                Paid: {new Date(referral.paid_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {referral.referred_notes && (
            <p className="mt-2 text-sm text-gray-600 italic">{referral.referred_notes}</p>
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-2 ml-4">
            {referral.status === 'pending' && (
              <button
                onClick={() => onUpdateStatus(referral.id, 'qualified')}
                className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                Mark Qualified
              </button>
            )}
            {referral.status === 'qualified' && (
              <button
                onClick={() => onUpdateStatus(referral.id, 'installed')}
                className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
              >
                Mark Installed
              </button>
            )}
            {referral.status === 'installed' && !referral.paid_at && (
              <button
                onClick={() => onMarkPaid(referral)}
                className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                Mark Paid
              </button>
            )}
            <button
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-indigo-600"
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Links to related records */}
      <div className="mt-3 flex gap-3 text-xs">
        {referral.referred_customer_id && (
          <Link href={`/customers/${referral.referred_customer_id}`} className="text-indigo-600 hover:underline">
            View Customer →
          </Link>
        )}
        {referral.referred_project_id && (
          <Link href={`/projects/${referral.referred_project_id}`} className="text-indigo-600 hover:underline">
            View Project →
          </Link>
        )}
        {referral.referred_lead_id && (
          <Link href={`/leads/${referral.referred_lead_id}`} className="text-indigo-600 hover:underline">
            View Lead →
          </Link>
        )}
      </div>
    </div>
  )
}
