'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { pdf } from '@react-pdf/renderer'
import ProposalPDF from '@/components/ProposalPDF'

interface Proposal {
  id: string
  proposal_number: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_address: string
  title: string
  status: string
  subtotal: number
  discount_amount: number
  discount_percent: number
  tax_rate: number
  tax_amount: number
  total: number
  financing_available: boolean
  financing_term_months: number
  financing_rate: number
  monthly_payment: number
  scope_of_work: string
  warranty_info: string
  accent_color: string
  created_at: string
  sent_at: string | null
  viewed_at: string | null
  accepted_at: string | null
  pdf_url: string | null
  pdf_generated_at: string | null
  opportunity_id: string | null
  users?: { full_name: string; email?: string; phone?: string }
}

interface LineItem {
  id: string
  category: string
  name: string
  unit: string
  quantity: number
  unit_price: number
  line_total: number
  is_adder: boolean
  show_to_customer?: boolean  // Whether this item should be shown on customer-facing proposal
}

export default function ProposalDetailPage() {
  const router = useRouter()
  const params = useParams()
  const proposalId = params.id as string
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [userRole, setUserRole] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [measurement, setMeasurement] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [rep, setRep] = useState<any>(null)
  const [savingVisibility, setSavingVisibility] = useState<string | null>(null)

  useEffect(() => {
    loadProposal()
  }, [proposalId])

  const loadProposal = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/proposals/${proposalId}`)
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        if (response.status === 404) {
          router.push('/proposals')
          return
        }
        const data = await response.json()
        setError(data.error || 'Failed to load proposal')
        return
      }

      const data = await response.json()
      setProposal(data.proposal)
      setLineItems(data.lineItems || [])
      setCompany(data.company)
      setRep(data.rep)
      setMeasurement(data.measurement)
      setUserRole(data.role || '')
    } catch (err) {
      console.error('Error loading proposal:', err)
      setError('Failed to load proposal')
    } finally {
      setLoading(false)
    }
  }

  const sendProposal = async () => {
    if (!proposal) return
    setSending(true)

    try {
      // Update status to sent via API
      const response = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'sent',
          sent_at: new Date().toISOString()
        })
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to send proposal: ${data.error}`)
        setSending(false)
        return
      }

      // In a real app, this would send an email with the proposal link
      alert(`Proposal would be sent to ${proposal.customer_email || 'customer'}`)
      
      await loadProposal()
    } catch (err) {
      console.error('Error sending proposal:', err)
      alert('Failed to send proposal')
    }
    setSending(false)
  }

  const generatePDF = async () => {
    if (!proposal) return
    setGenerating(true)

    try {
      // Generate satellite image URL
      const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
      const satelliteImageUrl = proposal.customer_address && googleMapsApiKey
        ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(proposal.customer_address)}&zoom=19&size=800x400&maptype=satellite&key=${googleMapsApiKey}`
        : undefined

      // Prepare data for PDF
      const pdfData = {
        proposal: {
          ...proposal,
          accent_color: proposal.accent_color || '#4f46e5',
          discount_percent: proposal.discount_percent ?? 0,
        },
        lineItems,
        measurement,
        company,
        rep,
        satelliteImageUrl,
      }

      // Generate PDF blob
      const blob = await pdf(<ProposalPDF data={pdfData} />).toBlob()
      
      // Create filename
      const filename = `${proposal.proposal_number}_${proposal.customer_name.replace(/\s+/g, '_')}.pdf`
      
      // Download the file locally
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      // Update proposal with PDF generated timestamp via API
      await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdf_generated_at: new Date().toISOString(),
        })
      })

      // Reload to show updated PDF info
      await loadProposal()
      
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Failed to generate PDF. Please try again.')
    }

    setGenerating(false)
  }

  const toggleItemVisibility = async (itemId: string, showToCustomer: boolean) => {
    setSavingVisibility(itemId)
    try {
      const response = await fetch(`/api/proposals/${proposalId}/line-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_to_customer: showToCustomer })
      })

      if (response.ok) {
        setLineItems(prev => prev.map(item => 
          item.id === itemId ? { ...item, show_to_customer: showToCustomer } : item
        ))
      } else {
        console.error('Failed to update item visibility')
      }
    } catch (err) {
      console.error('Error updating visibility:', err)
    }
    setSavingVisibility(null)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700'
      case 'sent': return 'bg-blue-100 text-blue-700'
      case 'viewed': return 'bg-amber-100 text-amber-700'
      case 'accepted': return 'bg-green-100 text-green-700'
      case 'declined': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading || !proposal) {
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
    <div className="min-h-screen bg-gray-100">
      <Nav />
      
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/proposals" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium mb-2 inline-block">
              ← Back to Proposals
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">{proposal.proposal_number}</h1>
            <p className="text-gray-500">Created {new Date(proposal.created_at).toLocaleDateString()}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(proposal.status)}`}>
              {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
            </span>
            {proposal.pdf_url && (
              <a
                href={proposal.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 border border-green-300 text-green-700 rounded-lg font-medium hover:bg-green-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View PDF
              </a>
            )}
            <button
              onClick={generatePDF}
              disabled={generating}
              className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
            >
              {generating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {proposal.pdf_url ? 'Regenerate PDF' : 'Generate PDF'}
                </>
              )}
            </button>
            {proposal.status === 'draft' && (
              <button
                onClick={sendProposal}
                disabled={sending}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Send to Customer'}
              </button>
            )}
          </div>
        </div>

        {/* Proposal Preview */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div 
            className="p-8 text-white"
            style={{ backgroundColor: proposal.accent_color || '#4f46e5' }}
          >
            <h1 className="text-3xl font-bold mb-2">{proposal.title}</h1>
            <p className="text-white/80">Prepared for {proposal.customer_name}</p>
          </div>

          {/* Content */}
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div>
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wider mb-2">Customer</h3>
                <p className="font-medium text-gray-900">{proposal.customer_name}</p>
                <p className="text-gray-900">{proposal.customer_address}</p>
                {proposal.customer_phone && <p className="text-gray-900">{proposal.customer_phone}</p>}
                {proposal.customer_email && <p className="text-gray-900">{proposal.customer_email}</p>}
              </div>
              <div className="text-right">
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wider mb-2">Project Total</h3>
                <p className="text-4xl font-bold" style={{ color: proposal.accent_color || '#4f46e5' }}>
                  ${proposal.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                {proposal.financing_available && proposal.monthly_payment && (
                  <p className="text-gray-900 mt-1">
                    or ${proposal.monthly_payment.toFixed(2)}/mo for {proposal.financing_term_months} months
                  </p>
                )}
              </div>
            </div>

            {/* Property Satellite Image */}
            {proposal.customer_address && (
              <div className="mb-8">
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wider mb-3">Property Location</h3>
                <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                  <img
                    src={`https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(proposal.customer_address)}&zoom=19&size=800x400&maptype=satellite&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}`}
                    alt={`Satellite view of ${proposal.customer_address}`}
                    className="w-full h-64 object-cover"
                    onError={(e) => {
                      // Hide the image container if it fails to load
                      (e.target as HTMLImageElement).parentElement!.style.display = 'none'
                    }}
                  />
                </div>
              </div>
            )}

            {/* Measurement Summary */}
            {measurement && (
              <div className="mb-8 p-6 bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl text-white">
                <h3 className="text-sm font-medium text-white uppercase tracking-wider mb-4">Roof Measurements</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-300">{measurement.total_squares?.toFixed(1) || '-'}</div>
                    <div className="text-xs text-white uppercase">Squares</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-300">{measurement.total_area_sqft?.toLocaleString() || '-'}</div>
                    <div className="text-xs text-white uppercase">Sq Ft</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-300">{measurement.predominant_pitch || '-'}</div>
                    <div className="text-xs text-white uppercase">Pitch</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-300">{measurement.facet_count || '-'}</div>
                    <div className="text-xs text-white uppercase">Sections</div>
                  </div>
                </div>
                {(measurement.ridges_lf || measurement.eaves_lf || measurement.valleys_lf) && (
                  <div className="mt-4 pt-4 border-t border-slate-500 grid grid-cols-3 gap-4 text-center">
                    {measurement.ridges_lf && (
                      <div>
                        <div className="text-lg font-semibold text-white">{measurement.ridges_lf} LF</div>
                        <div className="text-xs text-white">Ridges</div>
                      </div>
                    )}
                    {measurement.eaves_lf && (
                      <div>
                        <div className="text-lg font-semibold text-white">{measurement.eaves_lf} LF</div>
                        <div className="text-xs text-white">Eaves</div>
                      </div>
                    )}
                    {measurement.valleys_lf && (
                      <div>
                        <div className="text-lg font-semibold text-white">{measurement.valleys_lf} LF</div>
                        <div className="text-xs text-white">Valleys</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Scope of Work */}
            {proposal.scope_of_work && (
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Scope of Work</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{proposal.scope_of_work}</p>
              </div>
            )}

            {/* Line Items (Admin Only) */}
            {userRole === 'admin' && lineItems.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">Line Items (Admin View)</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>Toggle visibility for customer proposal</span>
                  </div>
                </div>
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Item</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Qty</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Unit Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Total</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Show to Customer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lineItems.map((item) => (
                        <tr key={item.id} className={item.is_adder ? 'bg-green-50' : ''}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{item.name}</p>
                            <p className="text-sm text-gray-700">{item.category}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900">{item.quantity} {item.unit}</td>
                          <td className="px-4 py-3 text-right text-gray-900">${item.unit_price.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">${item.line_total.toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => toggleItemVisibility(item.id, !item.show_to_customer)}
                              disabled={savingVisibility === item.id}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                item.show_to_customer ? 'bg-indigo-600' : 'bg-gray-300'
                              } ${savingVisibility === item.id ? 'opacity-50' : ''}`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  item.show_to_customer ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Items with "Show to Customer" enabled will be itemized on the customer-facing proposal. 
                  Hidden items are still included in the total price.
                </p>
              </div>
            )}

            {/* Pricing Summary */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Investment Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-gray-900">
                  <span>Project Total</span>
                  <span>${proposal.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {proposal.discount_amount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discount</span>
                    <span>-${proposal.discount_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {proposal.tax_amount > 0 && (
                  <div className="flex justify-between text-gray-900">
                    <span>Tax ({proposal.tax_rate}%)</span>
                    <span>${proposal.tax_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
                  <span>Total Investment</span>
                  <span>${proposal.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Financing */}
            {proposal.financing_available && (
              <div className="mt-6 p-6 bg-indigo-50 rounded-xl border border-indigo-100">
                <h3 className="text-lg font-semibold text-indigo-900 mb-2">Financing Available</h3>
                <p className="text-indigo-900">
                  As low as <span className="font-bold text-2xl">${proposal.monthly_payment?.toFixed(2)}</span>/month
                </p>
                <p className="text-sm text-indigo-800 mt-1">
                  {proposal.financing_term_months} months at {proposal.financing_rate}% APR
                </p>
              </div>
            )}

            {/* Status Timeline */}
            <div className="mt-8 pt-8 border-t">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Timeline</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-gray-900">Created on {new Date(proposal.created_at).toLocaleString()}</span>
                </div>
                {proposal.sent_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-gray-900">Sent on {new Date(proposal.sent_at).toLocaleString()}</span>
                  </div>
                )}
                {proposal.viewed_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-gray-900">Viewed on {new Date(proposal.viewed_at).toLocaleString()}</span>
                  </div>
                )}
                {proposal.accepted_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-gray-900">Accepted on {new Date(proposal.accepted_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
