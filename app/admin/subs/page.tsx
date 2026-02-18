'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface SubContractor {
  id: string
  company_name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  services: string[]
  active: boolean
  portal_access_enabled: boolean
  rating: number | null
  created_at: string
}

export default function SubContractorsPage() {
  const router = useRouter()
  const [subs, setSubs] = useState<SubContractor[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSub, setEditingSub] = useState<SubContractor | null>(null)
  const [saving, setSaving] = useState(false)
  const [orgId, setOrgId] = useState('')

  const [formData, setFormData] = useState({
    company_name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    license_number: '',
    services: [] as string[],
    internal_notes: '',
    portal_access_enabled: false,
  })

  const serviceOptions = [
    'Roofing',
    'Siding',
    'Gutters',
    'Windows',
    'Doors',
    'Painting',
    'Drywall',
    'Electrical',
    'Plumbing',
    'HVAC',
    'Flooring',
    'General Labor',
  ]

  const supabase = createClientBrowser()

  useEffect(() => {
    loadSubs()
  }, [])

  const loadSubs = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        console.log('Subs page: No auth user', authError)
        router.push('/login')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('org_id, role')
        .eq('id', user.id)
        .single()

      console.log('Subs page: Profile loaded', { profile, profileError, userId: user.id })

      if (profileError || !profile) {
        console.error('Subs page: Profile error', profileError)
        setLoading(false)
        return
      }

      // Allow any admin-level role to access subs management
      const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
      if (!adminRoles.includes(profile.role)) {
        console.log('Subs page access denied. User role:', profile.role)
        router.push('/dashboard')
        return
      }

      console.log('Subs page: Access granted for role:', profile.role)
      setOrgId(profile.org_id)

      const { data, error: subsError } = await supabase
        .from('sub_contractors')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('company_name')

      if (subsError) {
        console.error('Subs page: Error loading subs', subsError)
      }

      setSubs(data || [])
      setLoading(false)
    } catch (error) {
      console.error('Subs page: Unexpected error', error)
      setLoading(false)
    }
  }

  const openModal = (sub?: SubContractor) => {
    if (sub) {
      setEditingSub(sub)
      setFormData({
        company_name: sub.company_name,
        contact_name: sub.contact_name || '',
        phone: sub.phone || '',
        email: sub.email || '',
        address: '',
        city: '',
        state: '',
        zip: '',
        license_number: '',
        services: sub.services || [],
        internal_notes: '',
        portal_access_enabled: sub.portal_access_enabled,
      })
    } else {
      setEditingSub(null)
      setFormData({
        company_name: '',
        contact_name: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        state: '',
        zip: '',
        license_number: '',
        services: [],
        internal_notes: '',
        portal_access_enabled: false,
      })
    }
    setShowModal(true)
  }

  const toggleService = (service: string) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(service)
        ? prev.services.filter(s => s !== service)
        : [...prev.services, service],
    }))
  }

  const saveSub = async () => {
    if (!formData.company_name) {
      alert('Company name is required')
      return
    }

    setSaving(true)

    try {
      const subData: any = {
        company_name: formData.company_name,
        contact_name: formData.contact_name || null,
        phone: formData.phone || null,
        email: formData.email || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        license_number: formData.license_number || null,
        services: formData.services,
        internal_notes: formData.internal_notes || null,
        portal_access_enabled: formData.portal_access_enabled,
      }

      if (editingSub) {
        await supabase
          .from('sub_contractors')
          .update(subData)
          .eq('id', editingSub.id)
      } else {
        // Generate portal access token
        subData.org_id = orgId
        subData.portal_access_token = crypto.randomUUID()
        
        await supabase.from('sub_contractors').insert(subData)
      }

      setShowModal(false)
      await loadSubs()
    } catch (error) {
      console.error('Error saving sub:', error)
      alert('Failed to save sub-contractor')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (sub: SubContractor) => {
    await supabase
      .from('sub_contractors')
      .update({ active: !sub.active })
      .eq('id', sub.id)

    await loadSubs()
  }

  const regenerateToken = async (sub: SubContractor) => {
    if (!confirm('Regenerate portal access token? The old link will stop working.')) return

    const newToken = crypto.randomUUID()
    await supabase
      .from('sub_contractors')
      .update({ portal_access_token: newToken })
      .eq('id', sub.id)

    alert(`New portal link: ${window.location.origin}/sub-portal/${newToken}`)
    await loadSubs()
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

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Sub-Contractors</h1>
            <p className="text-gray-500 mt-1">Manage your sub-contractor network</p>
          </div>
          <button
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Sub-Contractor
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-gray-900">{subs.length}</div>
            <div className="text-sm text-gray-500">Total Subs</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-green-600">
              {subs.filter(s => s.active).length}
            </div>
            <div className="text-sm text-gray-500">Active</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-indigo-600">
              {subs.filter(s => s.portal_access_enabled).length}
            </div>
            <div className="text-sm text-gray-500">Portal Access</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="text-2xl font-bold text-gray-600">
              {subs.filter(s => !s.active).length}
            </div>
            <div className="text-sm text-gray-500">Inactive</div>
          </div>
        </div>

        {/* Subs List */}
        {subs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No sub-contractors yet</h3>
            <p className="text-gray-500 mb-4">Add your first sub-contractor to get started</p>
            <button
              onClick={() => openModal()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Add Sub-Contractor
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Services</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Portal</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {subs.map((sub) => (
                  <tr key={sub.id} className={`hover:bg-gray-50 ${!sub.active ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{sub.company_name}</div>
                    </td>
                    <td className="px-6 py-4">
                      {sub.contact_name && <div className="text-sm text-gray-900">{sub.contact_name}</div>}
                      {sub.phone && <div className="text-sm text-gray-500">{sub.phone}</div>}
                      {sub.email && <div className="text-sm text-gray-500">{sub.email}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {sub.services?.slice(0, 3).map(s => (
                          <span key={s} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                            {s}
                          </span>
                        ))}
                        {sub.services?.length > 3 && (
                          <span className="text-xs text-gray-500">+{sub.services.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {sub.portal_access_enabled ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Enabled
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">Disabled</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        sub.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {sub.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openModal(sub)}
                          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                        >
                          Edit
                        </button>
                        {sub.portal_access_enabled && (
                          <button
                            onClick={() => regenerateToken(sub)}
                            className="text-gray-600 hover:text-gray-800 text-sm font-medium"
                          >
                            New Link
                          </button>
                        )}
                        <button
                          onClick={() => toggleActive(sub)}
                          className={`text-sm font-medium ${
                            sub.active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'
                          }`}
                        >
                          {sub.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingSub ? 'Edit Sub-Contractor' : 'Add Sub-Contractor'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Company Name *</label>
                    <input
                      type="text"
                      value={formData.company_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Contact Name</label>
                    <input
                      type="text"
                      value={formData.contact_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, contact_name: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Services</label>
                  <div className="flex flex-wrap gap-2">
                    {serviceOptions.map(service => (
                      <button
                        key={service}
                        type="button"
                        onClick={() => toggleService(service)}
                        className={`px-3 py-1.5 rounded-lg text-sm ${
                          formData.services.includes(service)
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {service}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">License Number</label>
                  <input
                    type="text"
                    value={formData.license_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, license_number: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Internal Notes</label>
                  <textarea
                    value={formData.internal_notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, internal_notes: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="portal_access"
                    checked={formData.portal_access_enabled}
                    onChange={(e) => setFormData(prev => ({ ...prev, portal_access_enabled: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="portal_access" className="text-sm text-gray-700">
                    <span className="font-medium">Enable Portal Access</span>
                    <p className="text-gray-500">Allow this sub to view assigned work orders via a unique link</p>
                  </label>
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
                  onClick={saveSub}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
