'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface SubContractor {
  id: string
  company_name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  scheduling_email: string | null
  scheduling_calendar_id: string | null
  calendar_share_verified_at: string | null
  services: string[]
  active: boolean
  portal_access_enabled: boolean
  rating: number | null
  created_at: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Plain-language steps a sub can follow with no Google/tech background.
// Written so Nathan can paste this whole block into a text message to a crew
// as-is. Keep the free/busy-only reassurance explicit — that's the line that
// gets a crew to actually do this instead of ignoring it.
//
// The address comes from the server (`orgs.install_scheduling_user_id`), which
// is the SAME account the availability read acts as. Hardcoding it, or reading a
// separate env var, would let the address crews are told drift away from the
// calendar anyone actually looks at.
function buildCalendarShareInstructions(shareEmail: string | null): string {
  const address = shareEmail || '[set an install scheduling account in Ops settings]'
  return `Share your calendar with ARX (optional)

This lets us see when your crew is already busy so we don't double-book you. ARX will only ever see that a time is "busy" — never the appointment details, never what the job is.

1. On a computer, open Google Calendar (calendar.google.com).
2. Click the gear icon in the top right, then "Settings".
3. On the left, under "Settings for my calendars", click your calendar's name.
4. Click "Share with specific people or groups".
5. Click "Add people and groups" and enter this address: ${address}
6. Under permissions, choose "See only free/busy (hide details)".
7. Click "Send".

That's it. ARX will only see when you're busy, never any details about the appointment. This is optional — it just helps us schedule installs more accurately around your other jobs.`
}

export default function SubContractorsPage() {
  const router = useRouter()
  const [subs, setSubs] = useState<SubContractor[]>([])
  /** The ARX account crews share their calendar with — server-resolved, see the API route. */
  const [installSchedulingEmail, setInstallSchedulingEmail] = useState<string | null>(null)
  const calendarShareInstructions = buildCalendarShareInstructions(installSchedulingEmail)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSub, setEditingSub] = useState<SubContractor | null>(null)
  const [saving, setSaving] = useState(false)
  const [orgId, setOrgId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [instructionsCopied, setInstructionsCopied] = useState(false)
  const instructionsCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [formData, setFormData] = useState({
    company_name: '',
    contact_name: '',
    phone: '',
    email: '',
    scheduling_email: '',
    scheduling_calendar_id: '',
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

  useEffect(() => {
    loadSubs()
  }, [])

  useEffect(() => () => {
    if (instructionsCopyTimer.current) clearTimeout(instructionsCopyTimer.current)
  }, [])

  const copyInstructions = async () => {
    try {
      await navigator.clipboard.writeText(calendarShareInstructions)
      setInstructionsCopied(true)
      if (instructionsCopyTimer.current) clearTimeout(instructionsCopyTimer.current)
      instructionsCopyTimer.current = setTimeout(() => setInstructionsCopied(false), 2000)
    } catch {
      prompt('Copy these instructions:', calendarShareInstructions)
    }
  }

  const loadSubs = async () => {
    try {
      const response = await fetch('/api/admin/subs')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to load data')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      setSubs(data.subs || [])
      setInstallSchedulingEmail(
        typeof data.installSchedulingEmail === 'string' ? data.installSchedulingEmail : null
      )
      setOrgId(data.orgId)
      setLoading(false)
    } catch (err) {
      console.error('Subs page error:', err)
      setError('Failed to load data')
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
        scheduling_email: sub.scheduling_email || '',
        scheduling_calendar_id: sub.scheduling_calendar_id || '',
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
        scheduling_email: '',
        scheduling_calendar_id: '',
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

    const schedulingEmail = formData.scheduling_email.trim()
    if (schedulingEmail && !EMAIL_PATTERN.test(schedulingEmail)) {
      alert('Scheduling email must be a valid email address (or left blank)')
      return
    }

    const schedulingCalendarId = formData.scheduling_calendar_id.trim()
    if (schedulingCalendarId && !EMAIL_PATTERN.test(schedulingCalendarId)) {
      alert('Calendar address must be a valid email address (or left blank)')
      return
    }

    setSaving(true)

    try {
      const subData: any = {
        company_name: formData.company_name,
        contact_name: formData.contact_name || null,
        phone: formData.phone || null,
        email: formData.email || null,
        scheduling_email: schedulingEmail || null,
        scheduling_calendar_id: schedulingCalendarId || null,
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
        subData.id = editingSub.id
        const response = await fetch('/api/admin/subs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subData),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update sub')
        }
      } else {
        const response = await fetch('/api/admin/subs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subData),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to create sub')
        }
      }

      setShowModal(false)
      await loadSubs()
    } catch (error: any) {
      console.error('Error saving sub:', error)
      alert(error.message || 'Failed to save sub-contractor')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (sub: SubContractor) => {
    try {
      const response = await fetch('/api/admin/subs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, active: !sub.active }),
      })
      if (!response.ok) {
        throw new Error('Failed to update sub')
      }
      await loadSubs()
    } catch (error) {
      console.error('Error toggling sub:', error)
    }
  }

  const regenerateToken = async (sub: SubContractor) => {
    if (!confirm('Regenerate portal access token? The old link will stop working.')) return

    try {
      const newToken = crypto.randomUUID()
      const response = await fetch('/api/admin/subs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, portal_access_token: newToken }),
      })
      if (!response.ok) {
        throw new Error('Failed to regenerate token')
      }
      alert(`New portal link: ${window.location.origin}/sub-portal/${newToken}`)
      await loadSubs()
    } catch (error) {
      console.error('Error regenerating token:', error)
      alert('Failed to regenerate token')
    }
  }

  const deleteSub = async (sub: SubContractor) => {
    if (!confirm(`Are you sure you want to delete "${sub.company_name}"? This cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch(`/api/admin/subs?id=${sub.id}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to delete subcontractor')
        return
      }
      
      await loadSubs()
    } catch (error) {
      console.error('Error deleting sub:', error)
      alert('Failed to delete subcontractor')
    }
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
                            sub.active ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'
                          }`}
                        >
                          {sub.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteSub(sub)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                          title="Delete subcontractor"
                        >
                          Delete
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
                  <label htmlFor="scheduling_email" className="block text-sm font-medium mb-2" style={{ color: '#2c2c2a' }}>
                    Scheduling email
                  </label>
                  <input
                    id="scheduling_email"
                    type="email"
                    value={formData.scheduling_email}
                    onChange={(e) => setFormData(prev => ({ ...prev, scheduling_email: e.target.value }))}
                    placeholder="crew@example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg min-h-[44px]"
                    style={{ color: '#2c2c2a' }}
                  />
                  <p className="text-sm mt-1" style={{ color: '#2c2c2a' }}>
                    Where install invites go. Whenever a job is scheduled, moved, or cancelled, this
                    address gets a calendar invite with the date, address and job number.
                    <strong> Any email works</strong> — Gmail, Outlook, iCloud, whatever they already
                    use. They don&apos;t need a Google account, and there&apos;s nothing for them to set
                    up: the invite opens in their normal mail app and adds to their calendar in one tap.
                    Leave blank and the job still schedules, but the crew won&apos;t be told.
                  </p>
                </div>

                <div>
                  <label htmlFor="scheduling_calendar_id" className="block text-sm font-medium mb-2" style={{ color: '#2c2c2a' }}>
                    Calendar address (optional)
                  </label>
                  <input
                    id="scheduling_calendar_id"
                    type="email"
                    value={formData.scheduling_calendar_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, scheduling_calendar_id: e.target.value }))}
                    placeholder="Leave blank to use the scheduling email above"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg min-h-[44px]"
                    style={{ color: '#2c2c2a' }}
                  />
                  <p className="text-sm mt-1" style={{ color: '#2c2c2a' }}>
                    Only needed if the calendar the crew shares with ARX (see below) is a{' '}
                    <strong>different</strong> address than the scheduling email above.{' '}
                    <strong>Leaving this blank is the normal case</strong> — ARX will check the
                    scheduling email&apos;s calendar for availability instead.
                  </p>
                </div>

                <div className="p-4 rounded-lg border" style={{
                  borderColor: editingSub?.calendar_share_verified_at ? '#bbf7d0' : '#fde68a',
                  backgroundColor: editingSub?.calendar_share_verified_at ? '#f0fdf4' : '#fffbeb',
                }}>
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2c2c2a' }}>
                    <span aria-hidden="true">{editingSub?.calendar_share_verified_at ? '✅' : '⚠️'}</span>
                    {editingSub ? (
                      editingSub.calendar_share_verified_at ? (
                        <span>
                          Calendar connected — last checked{' '}
                          {new Date(editingSub.calendar_share_verified_at).toLocaleString('en-US', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      ) : (
                        <span>Calendar not shared yet</span>
                      )
                    ) : (
                      <span>Calendar sharing status (save this sub first)</span>
                    )}
                  </div>

                  {(!editingSub || !editingSub.calendar_share_verified_at) && (
                    <div className="mt-3">
                      <p className="text-sm" style={{ color: '#2c2c2a' }}>
                        Text or read these steps to the crew so ARX can see when they&apos;re already
                        busy before booking a new install:
                      </p>
                      <pre
                        className="mt-2 whitespace-pre-wrap text-sm p-3 bg-white border border-gray-200 rounded-lg"
                        style={{ color: '#2c2c2a', fontFamily: 'inherit' }}
                      >
                        {calendarShareInstructions}
                      </pre>
                      <button
                        type="button"
                        onClick={copyInstructions}
                        className="mt-2 min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100"
                        style={{ color: '#2c2c2a' }}
                      >
                        {instructionsCopied ? 'Copied ✓' : 'Copy instructions'}
                      </button>
                    </div>
                  )}
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
