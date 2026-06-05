'use client'

import { useState, useEffect } from 'react'
import SignaturePad from './SignaturePad'
import { parseDraftFloat, previewNumber } from '@/lib/numeric-input-draft'

interface ContractModalProps {
  isOpen: boolean
  onClose: () => void
  opportunityId: string
  proposalId?: string
  customerName: string
  customerEmail: string
  customerPhone: string
  projectAddress: string
  projectCost: number
  /** When set, pre-fills the finance company field for Installation Agreement. */
  defaultFinanceCompany?: string | null
  totalSquares?: number
  scopeOfWork?: string
}

interface ContractFormData {
  agreementType: 'installation' | 'contingency' | 'repair'
  customerName: string
  customerEmail: string
  customerPhone: string
  projectAddress: string
  projectCost: string
  totalSquares: number | null
  roofingMaterial: string
  scopeRoofReplacement: boolean
  scopeRoofRepair: boolean
  scopeGutters: boolean
  scopeSiding: boolean
  scopeOther: string
  paymentMethod: 'finance' | 'cash' | 'insurance' | 'other'
  financeCompany: string
  depositAmount: string
  estCompletionDate: string
  exclusions: string
  additionalProducts: string
  notes: string
  repName: string
  repTitle: string
  repSignature: string | null
}

export default function ContractModal({
  isOpen,
  onClose,
  opportunityId,
  proposalId,
  customerName,
  customerEmail,
  customerPhone,
  projectAddress,
  projectCost,
  defaultFinanceCompany,
  totalSquares,
  scopeOfWork,
}: ContractModalProps) {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [formData, setFormData] = useState<ContractFormData>({
    agreementType: 'installation',
    customerName: customerName || '',
    customerEmail: customerEmail || '',
    customerPhone: customerPhone || '',
    projectAddress: projectAddress || '',
    projectCost: projectCost ? String(projectCost) : '',
    totalSquares: totalSquares || null,
    roofingMaterial: '',
    scopeRoofReplacement: true,
    scopeRoofRepair: false,
    scopeGutters: false,
    scopeSiding: false,
    scopeOther: '',
    paymentMethod: 'cash',
    financeCompany: '',
    depositAmount: '',
    estCompletionDate: '',
    exclusions: '',
    additionalProducts: '',
    notes: '',
    repName: '',
    repTitle: 'Sales Representative',
    repSignature: null,
  })

  useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({
        ...prev,
        customerName: customerName || prev.customerName,
        customerEmail: customerEmail || prev.customerEmail,
        customerPhone: customerPhone || prev.customerPhone,
        projectAddress: projectAddress || prev.projectAddress,
        projectCost: projectCost ? String(projectCost) : prev.projectCost,
        totalSquares: totalSquares || prev.totalSquares,
        financeCompany: defaultFinanceCompany?.trim() || prev.financeCompany || '',
        paymentMethod: defaultFinanceCompany?.trim() ? 'finance' : prev.paymentMethod,
      }))
      setStep(1)
      setError(null)
      setSuccess(false)
    }
  }, [isOpen, customerName, customerEmail, customerPhone, projectAddress, projectCost, totalSquares, defaultFinanceCompany])

  const handleInputChange = (field: keyof ContractFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const validateStep = (currentStep: number): boolean => {
    switch (currentStep) {
      case 1:
        if (!formData.customerName || !formData.projectAddress) {
          setError('Please fill in customer name and project address')
          return false
        }
        if (formData.agreementType === 'installation' || formData.agreementType === 'repair') {
          if ((parseDraftFloat(formData.projectCost, { required: true }) ?? 0) <= 0) {
            setError('Please enter the project cost')
            return false
          }
        }
        break
      case 2:
        if (formData.agreementType === 'contingency') break
        if (!formData.paymentMethod) {
          setError('Please select a payment method')
          return false
        }
        if (formData.paymentMethod === 'finance' && !formData.financeCompany) {
          setError('Please enter the finance company name')
          return false
        }
        break
      case 3:
        if (!formData.repName || !formData.repSignature) {
          setError('Please enter your name and sign the contract')
          return false
        }
        break
    }
    setError(null)
    return true
  }

  const nextStep = () => {
    if (validateStep(step)) {
      setStep(prev => Math.min(prev + 1, 4))
    }
  }

  const prevStep = () => {
    setStep(prev => Math.max(prev - 1, 1))
    setError(null)
  }

  const handleSubmit = async () => {
    if (!validateStep(3)) return

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/contracts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityId,
          proposalId,
          ...formData,
          projectCost: parseDraftFloat(formData.projectCost, { required: true }) ?? 0,
          depositAmount: parseDraftFloat(formData.depositAmount) ?? 0,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create contract')
      }

      setSuccess(true)
      setTimeout(() => {
        onClose()
        window.location.reload()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contract')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        
        <div className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Send Agreement</h2>
              <p className="text-sm text-gray-500">Step {step} of 4</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex border-b">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`flex-1 py-2 text-center text-sm font-medium ${
                  s === step ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' :
                  s < step ? 'text-green-600' : 'text-gray-400'
                }`}
              >
                {s === 1 && 'Project Details'}
                {s === 2 && 'Payment & Notes'}
                {s === 3 && 'Your Signature'}
                {s === 4 && 'Review & Send'}
              </div>
            ))}
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700">
                  Agreement created and sent to customer! Redirecting...
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Agreement Type *
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => handleInputChange('agreementType', 'installation')}
                      className={`text-left border rounded-lg p-4 ${
                        formData.agreementType === 'installation'
                          ? 'border-indigo-600 bg-indigo-50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <p className="font-semibold text-gray-900">Installation Agreement</p>
                      <p className="text-sm text-gray-600 mt-1">Final signed agreement after scope and price are ready.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleInputChange('agreementType', 'repair')
                        handleInputChange('scopeRoofReplacement', false)
                      }}
                      className={`text-left border rounded-lg p-4 ${
                        formData.agreementType === 'repair'
                          ? 'border-indigo-600 bg-indigo-50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <p className="font-semibold text-gray-900">Repair Agreement</p>
                      <p className="text-sm text-gray-600 mt-1">Small jobs: roof, gutters, siding, etc.—only what you list.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInputChange('agreementType', 'contingency')}
                      className={`text-left border rounded-lg p-4 ${
                        formData.agreementType === 'contingency'
                          ? 'border-indigo-600 bg-indigo-50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <p className="font-semibold text-gray-900">Insurance Contingency</p>
                      <p className="text-sm text-gray-600 mt-1">Early claim agreement before insurance approval.</p>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Customer Name(s) *
                    </label>
                    <input
                      type="text"
                      value={formData.customerName}
                      onChange={e => handleInputChange('customerName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Project Address *
                    </label>
                    <input
                      type="text"
                      value={formData.projectAddress}
                      onChange={e => handleInputChange('projectAddress', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={formData.customerPhone}
                      onChange={e => handleInputChange('customerPhone', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formData.customerEmail}
                      onChange={e => handleInputChange('customerEmail', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Scope Of Work *
                  </label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.scopeRoofReplacement}
                        onChange={e => handleInputChange('scopeRoofReplacement', e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Roof Replacement</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.scopeRoofRepair}
                        onChange={e => handleInputChange('scopeRoofRepair', e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Roof Repair</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.scopeGutters}
                        onChange={e => handleInputChange('scopeGutters', e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Gutters</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.scopeSiding}
                        onChange={e => handleInputChange('scopeSiding', e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Siding</span>
                    </label>
                  </div>
                  <div className="mt-2">
                    <input
                      type="text"
                      placeholder="Other (specify)"
                      value={formData.scopeOther}
                      onChange={e => handleInputChange('scopeOther', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                {formData.agreementType === 'installation' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Primary Roofing System
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., Architectural Shingles"
                          value={formData.roofingMaterial}
                          onChange={e => handleInputChange('roofingMaterial', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Total Squares
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={formData.totalSquares || ''}
                          onChange={e => handleInputChange('totalSquares', e.target.value ? parseFloat(e.target.value) : null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Project Cost *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-500">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={formData.projectCost}
                            onChange={e => handleInputChange('projectCost', e.target.value)}
                            className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Est. Completion Date
                        </label>
                        <input
                          type="date"
                          value={formData.estCompletionDate}
                          onChange={e => handleInputChange('estCompletionDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Exclusions / Observations
                      </label>
                      <textarea
                        rows={3}
                        value={formData.exclusions}
                        onChange={e => handleInputChange('exclusions', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Any exclusions or observations..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Additional Products
                      </label>
                      <textarea
                        rows={2}
                        value={formData.additionalProducts}
                        onChange={e => handleInputChange('additionalProducts', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Any additional products..."
                      />
                    </div>
                  </>
                )}

                {formData.agreementType === 'repair' && (
                  <>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-sm text-slate-800">
                        Only list the work you are selling. The agreement matches what is checked and written above.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Project Cost (repair total) *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-500">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={formData.projectCost}
                            onChange={e => handleInputChange('projectCost', e.target.value)}
                            className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Est. Completion Date
                        </label>
                        <input
                          type="date"
                          value={formData.estCompletionDate}
                          onChange={e => handleInputChange('estCompletionDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Exclusions / site notes
                      </label>
                      <textarea
                        rows={3}
                        value={formData.exclusions}
                        onChange={e => handleInputChange('exclusions', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="What is not included, access notes, etc."
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                {formData.agreementType === 'contingency' && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-900">
                      This contingency agreement does not collect payment details. It authorizes ARX to help with the insurance claim and becomes active only if the claim, scope, and price are approved.
                    </p>
                  </div>
                )}
                {(formData.agreementType === 'installation' || formData.agreementType === 'repair') && (
                  <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Payment Method *
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="finance"
                        checked={formData.paymentMethod === 'finance'}
                        onChange={() => handleInputChange('paymentMethod', 'finance')}
                        className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Finance Co</span>
                    </label>
                    {formData.paymentMethod === 'finance' && (
                      <input
                        type="text"
                        placeholder="Finance company name"
                        value={formData.financeCompany}
                        onChange={e => handleInputChange('financeCompany', e.target.value)}
                        className="ml-6 w-64 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="cash"
                        checked={formData.paymentMethod === 'cash'}
                        onChange={() => handleInputChange('paymentMethod', 'cash')}
                        className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Cash</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="insurance"
                        checked={formData.paymentMethod === 'insurance'}
                        onChange={() => handleInputChange('paymentMethod', 'insurance')}
                        className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Insurance Claim</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="other"
                        checked={formData.paymentMethod === 'other'}
                        onChange={() => handleInputChange('paymentMethod', 'other')}
                        className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">Other</span>
                    </label>
                  </div>
                </div>
                  </>
                )}

                {(formData.agreementType === 'installation' || formData.agreementType === 'repair') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Deposit (Due At Signing)
                    </label>
                    <div className="relative w-48">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.depositAmount}
                        onChange={e => handleInputChange('depositAmount', e.target.value)}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    rows={4}
                    value={formData.notes}
                    onChange={e => handleInputChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="p-4 bg-indigo-50 rounded-lg">
                  <h3 className="font-medium text-indigo-900 mb-2">ARX Roofing & Exteriors Representative</h3>
                  <p className="text-sm text-indigo-700">
                    By signing below, you confirm that you have reviewed all project details and are authorized to enter into this agreement on behalf of ARX Roofing & Exteriors LLC.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Print Name *
                    </label>
                    <input
                      type="text"
                      value={formData.repName}
                      onChange={e => handleInputChange('repName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={formData.repTitle}
                      onChange={e => handleInputChange('repTitle', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Signature *
                  </label>
                  <SignaturePad
                    value={formData.repSignature}
                    onChange={sig => handleInputChange('repSignature', sig)}
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div className="p-4 bg-green-50 rounded-lg">
                  <h3 className="font-medium text-green-900 mb-2">Ready to Send</h3>
                  <p className="text-sm text-green-700">
                    Review the agreement below. Once submitted, an email will be sent to{' '}
                    <strong>{formData.customerEmail || 'the customer'}</strong> with a link to sign.
                  </p>
                </div>

                <div className="border rounded-lg divide-y">
                  <div className="p-4">
                    <h4 className="font-medium text-gray-900 mb-2">Customer & Project</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-500">Type:</span>{' '}
                        {formData.agreementType === 'contingency'
                          ? 'Insurance Contingency'
                          : formData.agreementType === 'repair'
                            ? 'Repair Agreement'
                            : 'Installation Agreement'}
                      </div>
                      <div><span className="text-gray-500">Name:</span> {formData.customerName}</div>
                      <div><span className="text-gray-500">Address:</span> {formData.projectAddress}</div>
                      <div><span className="text-gray-500">Phone:</span> {formData.customerPhone || 'N/A'}</div>
                      <div><span className="text-gray-500">Email:</span> {formData.customerEmail || 'N/A'}</div>
                    </div>
                  </div>

                  <div className="p-4">
                    <h4 className="font-medium text-gray-900 mb-2">Scope of Work</h4>
                    <div className="flex flex-wrap gap-2 text-sm">
                      {formData.scopeRoofReplacement && <span className="px-2 py-1 bg-gray-100 rounded">Roof Replacement</span>}
                      {formData.scopeRoofRepair && <span className="px-2 py-1 bg-gray-100 rounded">Roof Repair</span>}
                      {formData.scopeGutters && <span className="px-2 py-1 bg-gray-100 rounded">Gutters</span>}
                      {formData.scopeSiding && <span className="px-2 py-1 bg-gray-100 rounded">Siding</span>}
                      {formData.scopeOther && <span className="px-2 py-1 bg-gray-100 rounded">{formData.scopeOther}</span>}
                    </div>
                    {formData.agreementType === 'installation' && formData.roofingMaterial && (
                      <p className="text-sm mt-2"><span className="text-gray-500">Material:</span> {formData.roofingMaterial}</p>
                    )}
                  </div>

                  {formData.agreementType === 'installation' || formData.agreementType === 'repair' ? (
                    <div className="p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Payment</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-gray-500">Project Cost:</span> ${previewNumber(formData.projectCost).toLocaleString()}</div>
                        <div><span className="text-gray-500">Deposit:</span> ${previewNumber(formData.depositAmount).toLocaleString()}</div>
                        <div><span className="text-gray-500">Method:</span> {formData.paymentMethod}{formData.financeCompany && ` (${formData.financeCompany})`}</div>
                        {formData.estCompletionDate && (
                          <div><span className="text-gray-500">Est. Completion:</span> {formData.estCompletionDate}</div>
                        )}
                      </div>
                      {formData.agreementType === 'repair' && formData.exclusions && (
                        <p className="text-sm mt-2 text-gray-700"><span className="text-gray-500">Notes / exclusions:</span> {formData.exclusions}</p>
                      )}
                    </div>
                  ) : (
                    <div className="p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Insurance Contingency</h4>
                      <p className="text-sm text-gray-700">
                        No project price, deposit, or construction start is created from this agreement.
                      </p>
                    </div>
                  )}

                  <div className="p-4">
                    <h4 className="font-medium text-gray-900 mb-2">Representative Signature</h4>
                    <div className="flex items-center gap-4">
                      {formData.repSignature && (
                        <img src={formData.repSignature} alt="Rep signature" className="h-12 border rounded" />
                      )}
                      <div className="text-sm">
                        <div>{formData.repName}</div>
                        <div className="text-gray-500">{formData.repTitle}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {!formData.customerEmail && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-700">
                      <strong>Warning:</strong> No customer email provided. You will need to share the signing link manually.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-between">
            <button
              type="button"
              onClick={step === 1 ? onClose : prevStep}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={nextStep}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || success}
                className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Sending...
                  </>
                ) : success ? (
                  'Sent!'
                ) : (
                  'Create & Send Agreement'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
