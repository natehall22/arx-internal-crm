'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'
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
}

export default function ProposalDetailPage() {
  const router = useRouter()
  const params = useParams()
  const proposalId = params.id as string
  
  const [loading, setLoading] = useState(true)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [userRole, setUserRole] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [measurement, setMeasurement] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [rep, setRep] = useState<any>(null)

  const supabase = createClientBrowser()

  useEffect(() => {
    loadProposal()
  }, [proposalId])

  const loadProposal = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    setUserRole(profile?.role || '')

    const { data: proposalData } = await supabase
      .from('proposals')
      .select('*, users:created_by(full_name, email, phone)')
      .eq('id', proposalId)
      .single()

    if (!proposalData) {
      router.push('/proposals')
      return
    }

    setProposal(proposalData)
    setRep(proposalData.users)

    // Load company info
    const { data: profileData } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (profileData?.org_id) {
      const { data: orgData } = await supabase
        .from('orgs')
        .select('name, logo_url, phone, email, address, website')
        .eq('id', profileData.org_id)
        .single()
      setCompany(orgData)
    }

    const { data: items } = await supabase
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', proposalId)
      .order('sort_order')

    setLineItems(items || [])

    // Load measurement data
    if (proposalData.opportunity_id) {
      const { data: measurementData } = await supabase
        .from('roof_measurements')
        .select('*')
        .eq('opportunity_id', proposalData.opportunity_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (measurementData) {
        setMeasurement(measurementData)
      }
    }

    setLoading(false)
  }

  const sendProposal = async () => {
    if (!proposal) return
    setSending(true)

    // Update status to sent
    await supabase
      .from('proposals')
      .update({ 
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', proposalId)

    // In a real app, this would send an email with the proposal link
    alert(`Proposal would be sent to ${proposal.customer_email || 'customer'}`)
    
    await loadProposal()
    setSending(false)
  }

  const generatePDF = async () => {
    if (!proposal) return
    setGenerating(true)

    try {
      // Prepare data for PDF
      const pdfData = {
        proposal: {
          ...proposal,
          accent_color: proposal.accent_color || '#4f46e5',
        },
        lineItems,
        measurement,
        company,
        rep,
      }

      // Generate PDF blob
      const blob = await pdf(<ProposalPDF data={pdfData} />).toBlob()
      
      // Create filename
      const filename = `${proposal.proposal_number}_${proposal.customer_name.replace(/\s+/g, '_')}.pdf`
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('proposals')
        .upload(`pdfs/${proposal.id}/${filename}`, blob, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        // If storage bucket doesn't exist, just download locally
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        
        alert('PDF downloaded! (Storage bucket not configured for cloud storage)')
        setGenerating(false)
        return
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('proposals')
        .getPublicUrl(`pdfs/${proposal.id}/${filename}`)

      // Update proposal with PDF URL
      await supabase
        .from('proposals')
        .update({
          pdf_url: urlData.publicUrl,
          pdf_generated_at: new Date().toISOString(),
        })
        .eq('id', proposal.id)

      // Download the file
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      // Reload to show updated PDF info
      await loadProposal()
      
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Failed to generate PDF. Please try again.')
    }

    setGenerating(false)
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
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Customer</h3>
                <p className="font-medium text-gray-900">{proposal.customer_name}</p>
                <p className="text-gray-600">{proposal.customer_address}</p>
                {proposal.customer_phone && <p className="text-gray-600">{proposal.customer_phone}</p>}
                {proposal.customer_email && <p className="text-gray-600">{proposal.customer_email}</p>}
              </div>
              <div className="text-right">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Project Total</h3>
                <p className="text-4xl font-bold" style={{ color: proposal.accent_color || '#4f46e5' }}>
                  ${proposal.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                {proposal.financing_available && proposal.monthly_payment && (
                  <p className="text-gray-500 mt-1">
                    or ${proposal.monthly_payment.toFixed(2)}/mo for {proposal.financing_term_months} months
                  </p>
                )}
              </div>
            </div>

            {/* Measurement Summary */}
            {measurement && (
              <div className="mb-8 p-6 bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl text-white">
                <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wider mb-4">Roof Measurements</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-400">{measurement.total_squares?.toFixed(1) || '-'}</div>
                    <div className="text-xs text-slate-400 uppercase">Squares</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-400">{measurement.total_area_sqft?.toLocaleString() || '-'}</div>
                    <div className="text-xs text-slate-400 uppercase">Sq Ft</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-400">{measurement.predominant_pitch || '-'}</div>
                    <div className="text-xs text-slate-400 uppercase">Pitch</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-400">{measurement.facet_count || '-'}</div>
                    <div className="text-xs text-slate-400 uppercase">Sections</div>
                  </div>
                </div>
                {(measurement.ridges_lf || measurement.eaves_lf || measurement.valleys_lf) && (
                  <div className="mt-4 pt-4 border-t border-slate-600 grid grid-cols-3 gap-4 text-center">
                    {measurement.ridges_lf && (
                      <div>
                        <div className="text-lg font-semibold">{measurement.ridges_lf} LF</div>
                        <div className="text-xs text-slate-400">Ridges</div>
                      </div>
                    )}
                    {measurement.eaves_lf && (
                      <div>
                        <div className="text-lg font-semibold">{measurement.eaves_lf} LF</div>
                        <div className="text-xs text-slate-400">Eaves</div>
                      </div>
                    )}
                    {measurement.valleys_lf && (
                      <div>
                        <div className="text-lg font-semibold">{measurement.valleys_lf} LF</div>
                        <div className="text-xs text-slate-400">Valleys</div>
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
                <p className="text-gray-600 whitespace-pre-wrap">{proposal.scope_of_work}</p>
              </div>
            )}

            {/* Line Items (Admin Only) */}
            {userRole === 'admin' && lineItems.length > 0 && (
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Line Items (Admin View)</h3>
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lineItems.map((item) => (
                        <tr key={item.id} className={item.is_adder ? 'bg-green-50' : ''}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{item.name}</p>
                            <p className="text-sm text-gray-500">{item.category}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">{item.quantity} {item.unit}</td>
                          <td className="px-4 py-3 text-right text-gray-600">${item.unit_price.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">${item.line_total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pricing Summary */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Investment Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-gray-600">
                  <span>Project Total</span>
                  <span>${proposal.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {proposal.discount_amount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-${proposal.discount_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {proposal.tax_amount > 0 && (
                  <div className="flex justify-between text-gray-600">
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
                <p className="text-indigo-700">
                  As low as <span className="font-bold text-2xl">${proposal.monthly_payment?.toFixed(2)}</span>/month
                </p>
                <p className="text-sm text-indigo-600 mt-1">
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
                  <span className="text-gray-600">Created on {new Date(proposal.created_at).toLocaleString()}</span>
                </div>
                {proposal.sent_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-gray-600">Sent on {new Date(proposal.sent_at).toLocaleString()}</span>
                  </div>
                )}
                {proposal.viewed_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-gray-600">Viewed on {new Date(proposal.viewed_at).toLocaleString()}</span>
                  </div>
                )}
                {proposal.accepted_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-gray-600">Accepted on {new Date(proposal.accepted_at).toLocaleString()}</span>
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
