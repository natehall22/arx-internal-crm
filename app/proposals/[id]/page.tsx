'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { pdf } from '@react-pdf/renderer'
import ProposalPDFv2 from '@/components/ProposalPDFv2'
import SatelliteImageEditor from '@/components/SatelliteImageEditor'
import { userCanDeleteProposal } from '@/lib/proposal-delete-access'
import CreateContractButton from '@/components/contracts/CreateContractButton'

interface Proposal {
  id: string
  created_by?: string | null
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
  financing_program_id?: string | null
  financing_lender_name?: string | null
  financed_contract_total?: number | null
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
  project_id: string | null
  cover_image_url: string | null
  users?: { full_name: string; email?: string; phone?: string }
  // Signature fields
  customer_signature_type?: string
  customer_signature_data?: string
  customer_signature_typed?: string
  customer_signed_name?: string
  customer_signed_at?: string
  rep_signature_type?: string
  rep_signature_data?: string
  rep_signature_typed?: string
  rep_signed_name?: string
  rep_signed_at?: string
  declined_at?: string
  declined_reason?: string
  inspection_notes?: string[]
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

const toCents = (value: number) => Math.round((Number(value) || 0) * 100)
const fromCents = (cents: number) => cents / 100

function getDisplayPricing(proposal: Proposal) {
  const subtotalCents = toCents(proposal.subtotal || 0)
  let discountCents = proposal.discount_percent > 0
    ? Math.round(subtotalCents * ((proposal.discount_percent || 0) / 100))
    : toCents(proposal.discount_amount || 0)
  discountCents = Math.min(Math.max(discountCents, 0), subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const taxCents = Math.round(afterDiscountCents * ((proposal.tax_rate || 0) / 100))
  const totalCents = afterDiscountCents + taxCents

  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    taxAmount: fromCents(taxCents),
    total: fromCents(totalCents),
  }
}

/** Single quote total: financed contract amount when financing applies (includes lender gross-up), else tax-included total. */
function getQuotedTotal(proposal: Proposal, taxIncludedTotal: number): number {
  if (
    proposal.financing_available &&
    proposal.financed_contract_total != null &&
    proposal.financed_contract_total > 0
  ) {
    return proposal.financed_contract_total
  }
  return taxIncludedTotal
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
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showImageModal, setShowImageModal] = useState(false)
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [showSatelliteEditor, setShowSatelliteEditor] = useState(false)
  const [hasCompletedInstallationContract, setHasCompletedInstallationContract] = useState(false)
  
  // PDF options
  const [showPdfOptions, setShowPdfOptions] = useState(false)
  const [pdfTheme, setPdfTheme] = useState<'dark' | 'print'>('print')
  
  // Financing options
  const [financingType, setFinancingType] = useState<'cash' | 'financed'>('cash')
  const [financingTermMonths, setFinancingTermMonths] = useState(60)
  const [financingInterestRate, setFinancingInterestRate] = useState(9.99)
  
  // Inspection photos
  const [inspectionPhotos, setInspectionPhotos] = useState<string[]>([])
  const [uploadingInspectionPhoto, setUploadingInspectionPhoto] = useState(false)
  
  // Inspection notes
  const [inspectionNotes, setInspectionNotes] = useState<string[]>([])
  const [newInspectionNote, setNewInspectionNote] = useState('')
  
  // Decline state
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [deletingProposal, setDeletingProposal] = useState(false)

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
      setHasCompletedInstallationContract(Boolean(data.has_completed_installation_contract))
      setUserRole(data.role || '')
      setCurrentUserId(typeof data.current_user_id === 'string' ? data.current_user_id : '')
      // Restore inspection notes from proposal (persisted in DB)
      const notes = data.proposal?.inspection_notes
      setInspectionNotes(Array.isArray(notes) ? notes : [])
    } catch (err) {
      console.error('Error loading proposal:', err)
      setError('Failed to load proposal')
    } finally {
      setLoading(false)
    }
  }

  const saveInspectionNotes = async (notes: string[]) => {
    if (!proposalId) return
    try {
      await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspection_notes: notes }),
      })
    } catch (err) {
      console.error('Failed to save inspection notes:', err)
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

  // Helper to convert image URL to base64 for PDF rendering
  const imageUrlToBase64 = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.error('Failed to fetch image:', response.status)
        return null
      }
      const blob = await response.blob()
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch (error) {
      console.error('Error converting image to base64:', error)
      return null
    }
  }

  const generatePDF = async () => {
    if (!proposal) return
    setGenerating(true)

    try {
      // Use custom cover image if set, otherwise fall back to satellite image
      let propertyImageUrl = proposal.cover_image_url || undefined
      
      if (!propertyImageUrl) {
        // Generate satellite image URL as fallback
        const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
        propertyImageUrl = proposal.customer_address && googleMapsApiKey
          ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(proposal.customer_address)}&zoom=19&size=800x400&maptype=satellite&key=${googleMapsApiKey}`
          : undefined
      }

      // Convert property image to base64 for reliable PDF embedding
      let imageForPdf: string | undefined = undefined
      if (propertyImageUrl) {
        const base64Image = await imageUrlToBase64(propertyImageUrl)
        if (base64Image) {
          imageForPdf = base64Image
        } else {
          console.warn('Could not load property image for PDF, skipping image')
        }
      }

      // Convert company logo to base64 if it exists
      console.log('PDF Generation - Company data:', company)
      let companyForPdf = company ? { ...company } : undefined
      if (company?.logo_url) {
        console.log('PDF Generation - Fetching logo from:', company.logo_url)
        const logoBase64 = await imageUrlToBase64(company.logo_url)
        if (logoBase64 && companyForPdf) {
          console.log('PDF Generation - Logo converted to base64 successfully')
          companyForPdf.logo_url = logoBase64
        } else {
          console.log('PDF Generation - Failed to convert logo to base64')
        }
      }
      console.log('PDF Generation - Company for PDF:', companyForPdf)

      const displayForPdf = getDisplayPricing(proposal)
      const quoteTotalForPdf = getQuotedTotal(proposal, displayForPdf.total)

      // Calculate monthly payment if financing (principal = quoted total when financed program applies)
      let monthlyPayment: number | undefined
      if (financingType === 'financed' && financingTermMonths > 0) {
        const principal = quoteTotalForPdf
        const monthlyRate = financingInterestRate / 100 / 12
        if (monthlyRate > 0) {
          monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, financingTermMonths)) / (Math.pow(1 + monthlyRate, financingTermMonths) - 1)
        } else {
          monthlyPayment = principal / financingTermMonths
        }
      }

      // Convert inspection photos to base64
      const inspectionPhotosBase64: string[] = []
      for (const photoUrl of inspectionPhotos) {
        const base64 = await imageUrlToBase64(photoUrl)
        if (base64) inspectionPhotosBase64.push(base64)
      }

      const pdfDataV2 = {
        proposal: {
          id: proposal.id,
          proposal_number: proposal.proposal_number,
          customer_name: proposal.customer_name,
          customer_email: proposal.customer_email,
          customer_phone: proposal.customer_phone,
          customer_address: proposal.customer_address,
          title: proposal.title,
          status: proposal.status,
          subtotal: proposal.subtotal,
          discount_amount: proposal.discount_amount,
          discount_percent: proposal.discount_percent,
          tax_rate: proposal.tax_rate,
          tax_amount: proposal.tax_amount,
          total: quoteTotalForPdf,
          scope_of_work: proposal.scope_of_work,
          created_at: proposal.created_at,
        },
        lineItems,
        measurement,
        company: companyForPdf,
        rep,
        financing: {
          enabled: financingType === 'financed',
          type: financingType,
          term_months: financingTermMonths,
          interest_rate: financingInterestRate,
          monthly_payment: monthlyPayment,
        },
        photos: {
          property: imageForPdf,
          inspection: inspectionPhotosBase64.length > 0 ? inspectionPhotosBase64 : undefined,
        },
        inspectionNotes: inspectionNotes.length > 0 ? inspectionNotes : undefined,
      }
      const blob = await pdf(<ProposalPDFv2 data={pdfDataV2} theme={pdfTheme} />).toBlob()
      
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

      // Update proposal with PDF generated timestamp and inspection notes via API
      await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdf_generated_at: new Date().toISOString(),
          inspection_notes: inspectionNotes,
        })
      })

      // Reload to show updated PDF info (inspection notes will be restored from API)
      await loadProposal()
      
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Failed to generate PDF. Please try again.')
    }

    setGenerating(false)
  }

  const handleImageUpload = async (file: File) => {
    if (!proposal) return
    setUploadingImage(true)

    try {
      const formData = new FormData()
      formData.append('image', file)

      const response = await fetch(`/api/proposals/${proposalId}/image`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to upload image: ${data.error}`)
        return
      }

      const { cover_image_url } = await response.json()
      // Add cache-busting parameter to force browser to load new image
      const cacheBustedUrl = `${cover_image_url}?t=${Date.now()}`
      setProposal(prev => prev ? { ...prev, cover_image_url: cacheBustedUrl } : null)
      setShowImageModal(false)
    } catch (err) {
      console.error('Error uploading image:', err)
      alert('Failed to upload image')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleImageUrlSave = async () => {
    if (!proposal || !imageUrlInput.trim()) return
    setUploadingImage(true)

    try {
      const response = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_image_url: imageUrlInput.trim() })
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to save image URL: ${data.error}`)
        return
      }

      setProposal(prev => prev ? { ...prev, cover_image_url: imageUrlInput.trim() } : null)
      setShowImageModal(false)
      setImageUrlInput('')
    } catch (err) {
      console.error('Error saving image URL:', err)
      alert('Failed to save image URL')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleSatelliteEditorSave = async (imageBlob: Blob) => {
    if (!proposal) return
    setUploadingImage(true)

    try {
      const formData = new FormData()
      formData.append('image', imageBlob, 'satellite-crop.jpg')

      const response = await fetch(`/api/proposals/${proposalId}/image`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to save image: ${data.error}`)
        return
      }

      const { cover_image_url } = await response.json()
      setProposal(prev => prev ? { ...prev, cover_image_url } : null)
      setShowSatelliteEditor(false)
      setShowImageModal(false)
    } catch (err) {
      console.error('Error saving satellite image:', err)
      alert('Failed to save image')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleRemoveImage = async () => {
    if (!proposal) return
    if (!confirm('Remove the property image?')) return
    setUploadingImage(true)

    try {
      const response = await fetch(`/api/proposals/${proposalId}/image`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to remove image: ${data.error}`)
        return
      }

      setProposal(prev => prev ? { ...prev, cover_image_url: null } : null)
    } catch (err) {
      console.error('Error removing image:', err)
      alert('Failed to remove image')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleDeleteProposal = async () => {
    if (!proposal) return
    if (!confirm(`Delete ${proposal.proposal_number}? This cannot be undone.`)) return
    setDeletingProposal(true)
    try {
      const response = await fetch(`/api/proposals/${proposalId}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to delete proposal')
        return
      }
      router.push('/proposals')
    } catch {
      alert('Failed to delete proposal')
    } finally {
      setDeletingProposal(false)
    }
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

  const displayPricing = getDisplayPricing(proposal)
  const quotedTotal = getQuotedTotal(proposal, displayPricing.total)
  const canEditProposal = !['accepted', 'declined'].includes(proposal.status) && !hasCompletedInstallationContract
  const canDeleteProposal =
    !!currentUserId &&
    userCanDeleteProposal({
      status: proposal.status,
      createdBy: proposal.created_by,
      currentUserId,
      role: userRole,
    })
  const proposalBuilderHref = `/proposals/builder?proposal_id=${encodeURIComponent(proposal.id)}${
    proposal.opportunity_id ? `&opportunity_id=${encodeURIComponent(proposal.opportunity_id)}` : ''
  }`

  return (
    <div className="min-h-screen bg-gray-100">
      <Nav />
      
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href={proposal.opportunity_id ? `/opportunities/${proposal.opportunity_id}` : '/proposals'}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium mb-2 inline-block"
            >
              {proposal.opportunity_id ? '← Back to Opportunity' : '← Back to Proposals'}
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
            {canEditProposal && (
              <Link
                href={proposalBuilderHref}
                className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 flex items-center gap-2 text-gray-800"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Edit proposal
              </Link>
            )}
            {canDeleteProposal && (
              <button
                type="button"
                onClick={handleDeleteProposal}
                disabled={deletingProposal}
                className="px-4 py-2 border border-red-200 text-red-700 rounded-lg font-medium hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
              >
                {deletingProposal ? (
                  <span className="inline-block w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
                Delete
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setShowPdfOptions(!showPdfOptions)}
                className="px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                PDF Options
                <svg className={`w-4 h-4 transition-transform ${showPdfOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* PDF Options Dropdown */}
              {showPdfOptions && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">PDF Generation Options</h4>
                  
                  {/* Theme Toggle */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPdfTheme('print')}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                          pdfTheme === 'print' 
                            ? 'bg-gray-900 text-white' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Print (Light)
                      </button>
                      <button
                        onClick={() => setPdfTheme('dark')}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                          pdfTheme === 'dark' 
                            ? 'bg-gray-900 text-white' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Dark (iPad)
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {pdfTheme === 'print' ? 'Ink-friendly for printing' : 'Luxury dark theme for presentations'}
                    </p>
                  </div>
                  
                  {/* Financing Options */}
                  <div className="mb-4 pt-3 border-t">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Payment Type</label>
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() => setFinancingType('cash')}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                          financingType === 'cash' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Cash
                      </button>
                      <button
                        onClick={() => setFinancingType('financed')}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                          financingType === 'financed' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Financed
                      </button>
                    </div>
                    
                    {financingType === 'financed' && (
                      <div className="space-y-2 mt-3 p-3 bg-blue-50 rounded-lg">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-xs text-gray-600 mb-1">Term (months)</label>
                            <select
                              value={financingTermMonths}
                              onChange={(e) => setFinancingTermMonths(Number(e.target.value))}
                              className="w-full px-2 py-1.5 border rounded text-sm"
                            >
                              <option value={36}>36 months</option>
                              <option value={48}>48 months</option>
                              <option value={60}>60 months</option>
                              <option value={72}>72 months</option>
                              <option value={84}>84 months</option>
                              <option value={120}>120 months</option>
                              <option value={144}>144 months</option>
                              <option value={180}>180 months</option>
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs text-gray-600 mb-1">APR %</label>
                            <input
                              type="number"
                              step="0.01"
                              value={financingInterestRate}
                              onChange={(e) => setFinancingInterestRate(Number(e.target.value))}
                              className="w-full px-2 py-1.5 border rounded text-sm"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-blue-700">
                          Est. ${(() => {
                          const principal = quotedTotal
                            const monthlyRate = financingInterestRate / 100 / 12
                            if (monthlyRate > 0) {
                              return (principal * (monthlyRate * Math.pow(1 + monthlyRate, financingTermMonths)) / (Math.pow(1 + monthlyRate, financingTermMonths) - 1)).toFixed(2)
                            }
                            return (principal / financingTermMonths).toFixed(2)
                          })()}/month
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <button
                    onClick={() => {
                      setShowPdfOptions(false)
                      generatePDF()
                    }}
                    disabled={generating}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-indigo-500 disabled:text-white disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {generating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Generate PDF
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
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
                  ${quotedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                {proposal.financing_available && proposal.monthly_payment && (
                  <p className="text-gray-900 mt-1">
                    or ${proposal.monthly_payment.toFixed(2)}/mo for {proposal.financing_term_months} months
                  </p>
                )}
              </div>
            </div>

            {/* Property Image */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Property Image</h3>
                <button
                  onClick={() => setShowImageModal(true)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  {proposal.cover_image_url ? 'Change Image' : 'Add Image'}
                </button>
              </div>
              <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm relative group">
                {proposal.cover_image_url ? (
                  <>
                    <img
                      key={proposal.cover_image_url}
                      src={proposal.cover_image_url}
                      alt={`Property at ${proposal.customer_address}`}
                      className="w-full h-64 object-cover"
                      onError={(e) => {
                        // Fall back to satellite view if custom image fails
                        const target = e.target as HTMLImageElement
                        const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
                        if (googleMapsApiKey && proposal.customer_address) {
                          target.src = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(proposal.customer_address)}&zoom=19&size=800x400&maptype=satellite&key=${googleMapsApiKey}`
                        }
                      }}
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <button
                        onClick={() => setShowImageModal(true)}
                        className="px-4 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100"
                      >
                        Change
                      </button>
                      <button
                        onClick={handleRemoveImage}
                        disabled={uploadingImage}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="absolute top-2 right-2 px-2 py-1 bg-green-600 text-white text-xs font-medium rounded">
                      Custom Image
                    </div>
                  </>
                ) : proposal.customer_address ? (
                  <>
                    <img
                      src={`https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(proposal.customer_address)}&zoom=19&size=800x400&maptype=satellite&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}`}
                      alt={`Satellite view of ${proposal.customer_address}`}
                      className="w-full h-64 object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).parentElement!.style.display = 'none'
                      }}
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={() => setShowImageModal(true)}
                        className="px-4 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100"
                      >
                        Upload Custom Image
                      </button>
                    </div>
                    <div className="absolute top-2 right-2 px-2 py-1 bg-gray-600 text-white text-xs font-medium rounded">
                      Auto (Satellite)
                    </div>
                  </>
                ) : (
                  <div className="w-full h-64 bg-gray-100 flex flex-col items-center justify-center">
                    <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500 text-sm mb-2">No property image</p>
                    <button
                      onClick={() => setShowImageModal(true)}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                    >
                      Add Image
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                This image will appear on the PDF proposal. Upload a photo of the property for a professional touch.
              </p>
            </div>

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

            {/* Inspection Notes */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900">Inspection Notes</h3>
                <span className="text-sm text-gray-500">{inspectionNotes.length} note{inspectionNotes.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="border rounded-xl p-4 bg-gray-50">
                {inspectionNotes.length > 0 && (
                  <ul className="space-y-2 mb-4">
                    {inspectionNotes.map((note, index) => (
                      <li key={index} className="flex items-start gap-2 bg-white p-3 rounded-lg border">
                        <span className="text-amber-500 mt-0.5">•</span>
                        <span className="flex-1 text-gray-700">{note}</span>
                        <button
                          onClick={() => {
                            const next = inspectionNotes.filter((_, i) => i !== index)
                            setInspectionNotes(next)
                            saveInspectionNotes(next)
                          }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newInspectionNote}
                    onChange={(e) => setNewInspectionNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newInspectionNote.trim()) {
                        const next = [...inspectionNotes, newInspectionNote.trim()]
                        setInspectionNotes(next)
                        setNewInspectionNote('')
                        saveInspectionNotes(next)
                      }
                    }}
                    placeholder="Add inspection finding (e.g., 'Missing shingles on north slope')"
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  />
                  <button
                    onClick={() => {
                      if (newInspectionNote.trim()) {
                        const next = [...inspectionNotes, newInspectionNote.trim()]
                        setInspectionNotes(next)
                        setNewInspectionNote('')
                        saveInspectionNotes(next)
                      }
                    }}
                    disabled={!newInspectionNote.trim()}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  These notes will appear in the "Inspection Findings" section of the PDF.
                </p>
              </div>
            </div>

            {/* Inspection Photos */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900">Inspection Photos</h3>
                <span className="text-sm text-gray-500">{inspectionPhotos.length}/6 photos</span>
              </div>
              <div className="border rounded-xl p-4 bg-gray-50">
                {inspectionPhotos.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {inspectionPhotos.map((photo, index) => (
                      <div key={index} className="relative group aspect-video rounded-lg overflow-hidden border">
                        <img src={photo} alt={`Inspection photo ${index + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={() => setInspectionPhotos(prev => prev.filter((_, i) => i !== index))}
                            className="px-3 py-1 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/50 text-white text-xs rounded">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-500">
                    <svg className="w-10 h-10 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">No inspection photos added yet</p>
                  </div>
                )}
                
                {inspectionPhotos.length < 6 && (
                  <div className="flex items-center gap-2">
                    <label className="flex-1">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingInspectionPhoto}
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          
                          setUploadingInspectionPhoto(true)
                          try {
                            const formData = new FormData()
                            formData.append('file', file)
                            formData.append('type', 'inspection')
                            formData.append('index', String(inspectionPhotos.length))
                            
                            const response = await fetch(`/api/proposals/${proposalId}/image`, {
                              method: 'POST',
                              body: formData,
                            })
                            
                            if (response.ok) {
                              const data = await response.json()
                              setInspectionPhotos(prev => [...prev, data.url])
                            } else {
                              alert('Failed to upload photo')
                            }
                          } catch (err) {
                            console.error('Upload error:', err)
                            alert('Failed to upload photo')
                          }
                          setUploadingInspectionPhoto(false)
                          e.target.value = ''
                        }}
                      />
                      <div className={`flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition ${uploadingInspectionPhoto ? 'opacity-50 cursor-wait' : ''}`}>
                        {uploadingInspectionPhoto ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
                            <span className="text-sm text-gray-600">Uploading...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-sm text-gray-600">Add Photo</span>
                          </>
                        )}
                      </div>
                    </label>
                  </div>
                )}
                
                <p className="text-xs text-gray-500 mt-2">
                  Add up to 6 inspection photos. These will appear on a dedicated page in the PDF if any are added.
                </p>
              </div>
            </div>

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
                    <span>
                      {hasCompletedInstallationContract
                        ? 'Locked after signed sale agreement'
                        : 'Toggle visibility for customer proposal'}
                    </span>
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
                              disabled={savingVisibility === item.id || hasCompletedInstallationContract}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                item.show_to_customer ? 'bg-indigo-600' : 'bg-gray-300'
                              } ${savingVisibility === item.id || hasCompletedInstallationContract ? 'opacity-50' : ''}`}
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
                  <span>Subtotal</span>
                  <span>${displayPricing.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {displayPricing.discountAmount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discount</span>
                    <span>-${displayPricing.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-900">
                  <span>Tax ({proposal.tax_rate}%)</span>
                  <span>${displayPricing.taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
                  <span>Total Investment</span>
                  <span>${quotedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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
                {proposal.declined_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-gray-900">Declined on {new Date(proposal.declined_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Proposals do not collect rep/customer signatures here — binding signature is on the order form / contract. */}
            <div className="mt-8 pt-8 border-t">
              <p className="text-sm text-gray-600">
                Binding customer signature is captured on the <strong className="font-medium text-gray-800">order form / contract</strong>, not on this proposal screen.
              </p>
              {(proposal.rep_signed_at || proposal.customer_signed_at) && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  <p className="font-medium text-gray-800 mb-1">Legacy on-file signatures</p>
                  <p>
                    {proposal.rep_signed_at && (
                      <>Rep: {proposal.rep_signed_name || '—'} · {new Date(proposal.rep_signed_at).toLocaleString()}</>
                    )}
                    {proposal.rep_signed_at && proposal.customer_signed_at && <br />}
                    {proposal.customer_signed_at && (
                      <>Customer: {proposal.customer_signed_name || '—'} · {new Date(proposal.customer_signed_at).toLocaleString()}</>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Create Contract / Decline */}
            {proposal.status !== 'declined' && (
              <div className="mt-8 pt-8 border-t">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Next Step</h3>
                <div className="flex gap-4 items-center">
                  {proposal.opportunity_id ? (
                    <CreateContractButton
                      opportunityId={proposal.opportunity_id}
                      proposalId={proposal.id}
                      customerName={proposal.customer_name}
                      customerEmail={proposal.customer_email}
                      customerPhone={proposal.customer_phone}
                      projectAddress={proposal.customer_address}
                      projectCost={
                        proposal.financed_contract_total != null && proposal.financed_contract_total > 0
                          ? proposal.financed_contract_total
                          : proposal.total
                      }
                      defaultFinanceCompany={proposal.financing_lender_name}
                      scopeOfWork={proposal.scope_of_work}
                    />
                  ) : (
                    <Link
                      href={`/opportunities`}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700"
                    >
                      Create Contract
                    </Link>
                  )}
                  <button
                    onClick={async () => {
                      const reason = prompt('Reason for declining (optional):')
                      if (reason === null) return
                      try {
                        const response = await fetch(`/api/proposals/${proposalId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            status: 'declined',
                            declined_at: new Date().toISOString(),
                            declined_reason: reason || null,
                          }),
                        })
                        if (response.ok) {
                          await loadProposal()
                        } else {
                          alert('Failed to decline proposal')
                        }
                      } catch (err) {
                        console.error('Error declining proposal:', err)
                        alert('Failed to decline proposal')
                      }
                    }}
                    className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50"
                  >
                    Decline Proposal
                  </button>
                </div>
              </div>
            )}

            {/* Accepted/Declined Status */}
            {proposal.status === 'accepted' && (
              <div className="mt-8 p-6 bg-green-100 border border-green-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-xl font-bold text-green-800">Proposal Accepted</p>
                      <p className="text-green-700">Accepted on {proposal.accepted_at ? new Date(proposal.accepted_at).toLocaleString() : 'N/A'}</p>
                    </div>
                  </div>
                  
                  {/* Project link or create button */}
                  {proposal.project_id ? (
                    <Link
                      href={`/projects/${proposal.project_id}`}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      View Project
                    </Link>
                  ) : (
                    <button
                      onClick={async () => {
                        if (!confirm('Create a project from this accepted proposal?')) return
                        try {
                          const response = await fetch(`/api/proposals/${proposalId}/create-project`, {
                            method: 'POST',
                          })
                          if (response.ok) {
                            const data = await response.json()
                            alert('Project created successfully!')
                            await loadProposal()
                          } else {
                            const error = await response.json()
                            alert(error.error || 'Failed to create project')
                          }
                        } catch (err) {
                          console.error('Error creating project:', err)
                          alert('Failed to create project')
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create Project
                    </button>
                  )}
                </div>
              </div>
            )}

            {proposal.status === 'declined' && (
              <div className="mt-8 p-6 bg-red-100 border border-red-200 rounded-xl">
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-xl font-bold text-red-800">Proposal Declined</p>
                    <p className="text-red-700">Declined on {proposal.declined_at ? new Date(proposal.declined_at).toLocaleString() : 'N/A'}</p>
                    {proposal.declined_reason && (
                      <p className="text-red-600 mt-1">Reason: {proposal.declined_reason}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Upload Modal */}
      {showImageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-8">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {showSatelliteEditor ? 'Adjust Satellite View' : 'Property Image'}
              </h2>
              <button
                onClick={() => { 
                  setShowImageModal(false)
                  setImageUrlInput('')
                  setShowSatelliteEditor(false)
                }}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {showSatelliteEditor ? (
                <SatelliteImageEditor
                  address={proposal.customer_address}
                  apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
                  onSave={handleSatelliteEditorSave}
                  onCancel={() => setShowSatelliteEditor(false)}
                />
              ) : (
                <>
                  <p className="text-gray-600 mb-6">
                    Choose how to set the property image for this proposal.
                  </p>

                  {/* Satellite Editor Option */}
                  {proposal.customer_address && (
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Adjust Satellite View</label>
                      <button
                        onClick={() => setShowSatelliteEditor(true)}
                        className="w-full border-2 border-dashed border-indigo-300 rounded-xl p-6 text-center hover:border-indigo-500 hover:bg-indigo-50 transition-colors group"
                      >
                        <svg className="w-10 h-10 text-indigo-400 mx-auto mb-2 group-hover:text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                        <p className="text-indigo-600 font-medium group-hover:text-indigo-700">Pan & Zoom Satellite Image</p>
                        <p className="text-xs text-gray-500 mt-1">Adjust the view to show the correct building</p>
                      </button>
                    </div>
                  )}

                  {/* Divider */}
                  <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-300" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-white text-gray-500">or upload your own</span>
                    </div>
                  </div>

                  {/* File Upload */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Upload Image</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-indigo-400 transition-colors">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleImageUpload(file)
                        }}
                        className="hidden"
                        id="property-image-upload"
                        disabled={uploadingImage}
                      />
                      <label
                        htmlFor="property-image-upload"
                        className="cursor-pointer"
                      >
                        {uploadingImage ? (
                          <div className="flex flex-col items-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2" />
                            <span className="text-gray-500">Uploading...</span>
                          </div>
                        ) : (
                          <>
                            <svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p className="text-indigo-600 font-medium">Click to upload</p>
                            <p className="text-xs text-gray-500 mt-1">PNG, JPG, WEBP up to 5MB</p>
                          </>
                        )}
                      </label>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-300" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-white text-gray-500">or paste URL</span>
                    </div>
                  </div>

                  {/* URL Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Image URL</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={imageUrlInput}
                        onChange={(e) => setImageUrlInput(e.target.value)}
                        placeholder="https://example.com/property-photo.jpg"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        disabled={uploadingImage}
                      />
                      <button
                        onClick={handleImageUrlSave}
                        disabled={!imageUrlInput.trim() || uploadingImage}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Paste a direct link to an image (must be publicly accessible)
                    </p>
                  </div>

                  {/* Current Image Preview */}
                  {proposal.cover_image_url && (
                    <div className="mt-6 pt-6 border-t">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Current Image</label>
                      <div className="rounded-lg overflow-hidden border border-gray-200">
                        <img
                          src={proposal.cover_image_url}
                          alt="Current property"
                          className="w-full h-40 object-cover"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {!showSatelliteEditor && (
              <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end gap-3">
                <button
                  onClick={() => { setShowImageModal(false); setImageUrlInput(''); }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
