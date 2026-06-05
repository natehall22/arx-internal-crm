'use client'

import { useState, useEffect } from 'react'
import SignaturePad from '@/components/contracts/SignaturePad'
import { parseDraftFloat, previewNumber } from '@/lib/numeric-input-draft'

interface ChangeOrderModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectAddress: string
  customerName: string
  customerEmail: string | null
  originalContractAmount: number
  originalContractDate: string | null
  originalContractId: string | null
  paymentMethod: string | null
  amountCollected: number
  jobId: string | null
  repName: string
  nextCoNumber: string
  onSuccess: () => void
}

export default function ChangeOrderModal({
  isOpen,
  onClose,
  projectId,
  projectAddress,
  customerName,
  customerEmail,
  originalContractAmount,
  originalContractDate,
  originalContractId,
  paymentMethod,
  amountCollected,
  jobId,
  repName,
  nextCoNumber,
  onSuccess,
}: ChangeOrderModalProps) {
  const [description, setDescription] = useState('')
  const [updatedTotal, setUpdatedTotal] = useState(String(originalContractAmount))
  const [updatedRemaining, setUpdatedRemaining] = useState('0')
  const updatedTotalNum = previewNumber(updatedTotal)
  const updatedRemainingNum = previewNumber(updatedRemaining)
  
  const [customerPrintName, setCustomerPrintName] = useState('')
  const [customerSignature, setCustomerSignature] = useState<string | null>(null)
  const [repPrintName, setRepPrintName] = useState(repName)
  const [repSignature, setRepSignature] = useState<string | null>(null)
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [signingUrl, setSigningUrl] = useState<string | null>(null)

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const isInsurance = paymentMethod === 'insurance'

  useEffect(() => {
    if (!isInsurance) {
      setUpdatedRemaining(String(Math.max(0, updatedTotalNum - amountCollected)))
    }
  }, [updatedTotalNum, amountCollected, isInsurance])

  useEffect(() => {
    if (isOpen) {
      setDescription('')
      setUpdatedTotal(String(originalContractAmount))
      setUpdatedRemaining(isInsurance ? '0' : String(Math.max(0, originalContractAmount - amountCollected)))
      setCustomerPrintName('')
      setCustomerSignature(null)
      setRepPrintName(repName)
      setRepSignature(null)
      setError(null)
      setSuccess(false)
      setPdfUrl(null)
      setSigningUrl(null)
    }
  }, [isOpen, originalContractAmount, amountCollected, repName, isInsurance])

  const handleSubmit = async (mode: 'in_person' | 'send_to_customer') => {
    setError(null)

    if (!description.trim()) {
      setError('Description of change is required')
      return
    }
    const updatedTotalValue = parseDraftFloat(updatedTotal, { required: true }) ?? 0
    if (updatedTotalValue <= 0) {
      setError('Updated total project cost is required')
      return
    }
    const updatedRemainingValue = isInsurance ? parseDraftFloat(updatedRemaining) : updatedTotalValue - amountCollected
    if (isInsurance && updatedRemainingValue === null) {
      setError('Updated remaining balance is required for insurance jobs')
      return
    }
    if (!customerPrintName.trim()) {
      setError('Customer print name is required')
      return
    }
    if (mode === 'in_person' && !customerSignature) {
      setError('Customer signature is required')
      return
    }
    if (mode === 'send_to_customer' && !customerEmail?.trim()) {
      setError('Customer email is required to send for signature')
      return
    }
    if (!repPrintName.trim()) {
      setError('Rep print name is required')
      return
    }
    if (!repSignature) {
      setError('Rep signature is required')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/change-orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          jobId,
          coNumber: nextCoNumber,
          description: description.trim(),
          originalAmount: originalContractAmount,
          updatedTotal: updatedTotalValue,
          updatedRemaining: updatedRemainingValue,
          customerPrintName: customerPrintName.trim(),
          customerSignature,
          repName: repPrintName.trim(),
          repSignature,
          originalContractId,
          originalContractDate,
          paymentMethod,
          customerName,
          customerEmail,
          projectAddress,
          signingMode: mode,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create change order')
      }

      setSuccess(true)
      setPdfUrl(data.pdfUrl)
      setSigningUrl(data.signingUrl || null)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create change order')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
        <div 
          className="fixed inset-0 bg-black/50 transition-opacity" 
          onClick={onClose}
        />
        
        <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl my-4 sm:my-8">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white border-b px-4 py-4 sm:px-6 rounded-t-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">
                New Change Order
              </h2>
              <button
                onClick={onClose}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-4 py-4 sm:px-6 sm:py-6 space-y-5">
            {success ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Change Order Created!</h3>
                <p className="text-gray-600 mb-6">
                  {signingUrl
                    ? `${nextCoNumber} was sent to the customer for signature.`
                    : `${nextCoNumber} has been saved successfully.`}
                </p>
                {signingUrl && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Customer signing link generated and emailed.
                  </div>
                )}
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 min-h-[48px]"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    View PDF
                  </a>
                )}
                <button
                  onClick={onClose}
                  className="block w-full mt-4 px-6 py-3 text-gray-600 font-medium hover:text-gray-800 min-h-[48px]"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-base">
                    {error}
                  </div>
                )}

                {/* Read-only fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Change Order #
                    </label>
                    <div className="px-3 py-3 bg-gray-100 rounded-lg text-base font-medium text-gray-900">
                      {nextCoNumber}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Date
                    </label>
                    <div className="px-3 py-3 bg-gray-100 rounded-lg text-base text-gray-900">
                      {today}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Job Address
                  </label>
                  <div className="px-3 py-3 bg-gray-100 rounded-lg text-base text-gray-900">
                    {projectAddress}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Customer Name
                  </label>
                  <div className="px-3 py-3 bg-gray-100 rounded-lg text-base text-gray-900">
                    {customerName}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Original Contract Amount
                  </label>
                  <div className="px-3 py-3 bg-gray-100 rounded-lg text-base font-medium text-gray-900">
                    ${originalContractAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description of Change <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base text-black bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Describe the changes to the scope of work..."
                    style={{ color: '#000000', backgroundColor: '#ffffff' }}
                  />
                </div>

                {/* Updated Total */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Updated Total Project Cost <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                    <input
                      type="number"
                      value={updatedTotal}
                      onChange={(e) => setUpdatedTotal(e.target.value)}
                      className="w-full pl-8 pr-3 py-3 border border-gray-300 rounded-lg text-base text-black bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      style={{ color: '#000000', backgroundColor: '#ffffff' }}
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>

                {/* Updated Remaining Balance */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Updated Remaining Balance
                    {isInsurance && <span className="text-red-500"> *</span>}
                  </label>
                  {isInsurance ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                      <input
                        type="number"
                        value={updatedRemaining}
                        onChange={(e) => setUpdatedRemaining(e.target.value)}
                        className="w-full pl-8 pr-3 py-3 border border-gray-300 rounded-lg text-base text-black bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        style={{ color: '#000000', backgroundColor: '#ffffff' }}
                        step="0.01"
                        min="0"
                      />
                    </div>
                  ) : (
                    <div className="px-3 py-3 bg-gray-100 rounded-lg">
                      <span className="text-base font-medium text-gray-900">
                        ${(updatedTotalNum - amountCollected).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-sm text-gray-600 ml-2">
                        (${updatedTotalNum.toLocaleString()} - ${amountCollected.toLocaleString()} collected)
                      </span>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-gray-200 pt-5">
                  <h3 className="text-base font-semibold text-gray-900 mb-4">Signatures</h3>
                </div>

                {/* Customer Signature */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Customer</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Print Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={customerPrintName}
                        onChange={(e) => setCustomerPrintName(e.target.value)}
                        className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base text-black bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        style={{ color: '#000000', backgroundColor: '#ffffff' }}
                        placeholder="Customer's full name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Signature <span className="text-red-500">*</span>
                      </label>
                      <SignaturePad
                        onChange={setCustomerSignature}
                        value={customerSignature}
                        width={350}
                        height={120}
                      />
                    </div>
                  </div>
                </div>

                {/* Rep Signature */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">ARX Representative</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Print Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={repPrintName}
                        onChange={(e) => setRepPrintName(e.target.value)}
                        className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base text-black bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        style={{ color: '#000000', backgroundColor: '#ffffff' }}
                        placeholder="Rep's full name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Signature <span className="text-red-500">*</span>
                      </label>
                      <SignaturePad
                        onChange={setRepSignature}
                        value={repSignature}
                        width={350}
                        height={120}
                      />
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="space-y-2">
                  <button
                    onClick={() => handleSubmit('in_person')}
                    disabled={isSubmitting}
                    className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed min-h-[52px] text-base"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating...
                      </span>
                    ) : (
                      'Generate & Save Change Order'
                    )}
                  </button>
                  <button
                    onClick={() => handleSubmit('send_to_customer')}
                    disabled={isSubmitting}
                    className="w-full py-3 border border-indigo-600 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-50 disabled:opacity-60 disabled:cursor-not-allowed min-h-[48px] text-base"
                  >
                    {isSubmitting ? 'Sending...' : 'Email to Customer for Signature'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
