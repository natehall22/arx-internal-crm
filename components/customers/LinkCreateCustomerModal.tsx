'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Customer {
  id: string
  name: string
  email?: string
  phone?: string
  address_text?: string
}

interface SourceRecord {
  id: string
  source_type: 'opportunity' | 'project' | 'job'
  display_name: string
  customer_name?: string
  customer_email?: string
  customer_phone?: string
  customer_address?: string
  status?: string
  job_number?: string
  created_at?: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  preselectedSource?: {
    type: 'opportunity' | 'project' | 'job'
    id: string
  }
}

export default function LinkCreateCustomerModal({ isOpen, onClose, preselectedSource }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<'search' | 'create_from_source' | 'manual'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Customer[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // Source selection
  const [sourceType, setSourceType] = useState<'opportunity' | 'project' | 'job'>('opportunity')
  const [showAllSources, setShowAllSources] = useState(false)
  const [sources, setSources] = useState<{
    opportunities: SourceRecord[]
    projects: SourceRecord[]
    jobs: SourceRecord[]
  }>({ opportunities: [], projects: [], jobs: [] })
  const [selectedSource, setSelectedSource] = useState<SourceRecord | null>(null)
  const [isLoadingSources, setIsLoadingSources] = useState(false)
  
  // Manual create fields
  const [manualName, setManualName] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [manualAddress, setManualAddress] = useState('')
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search customers
  const searchCustomers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setSearchResults(data.customers || [])
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        searchCustomers(searchQuery)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchCustomers])

  // Load source records
  const loadSources = useCallback(async () => {
    setIsLoadingSources(true)
    try {
      const res = await fetch(`/api/customers/sources?type=${sourceType}&show_all=${showAllSources}`)
      const data = await res.json()
      setSources(data)
    } catch (err) {
      console.error('Load sources error:', err)
    } finally {
      setIsLoadingSources(false)
    }
  }, [sourceType, showAllSources])

  useEffect(() => {
    if (step === 'create_from_source') {
      loadSources()
    }
  }, [step, sourceType, showAllSources, loadSources])

  // Handle preselected source
  useEffect(() => {
    if (preselectedSource && isOpen) {
      setStep('create_from_source')
      setSourceType(preselectedSource.type)
    }
  }, [preselectedSource, isOpen])

  // Link existing customer to source
  const handleLinkCustomer = async (customer: Customer) => {
    if (!preselectedSource) {
      // Just close modal if no source to link
      onClose()
      router.push(`/customers/${customer.id}`)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/customers/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link',
          customer_id: customer.id,
          source_type: preselectedSource.type,
          source_id: preselectedSource.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to link customer')
      }

      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Create customer from source record
  const handleCreateFromSource = async () => {
    if (!selectedSource) return

    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/customers/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_from_source',
          source_type: selectedSource.source_type,
          source_id: selectedSource.id,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create customer')
      }

      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Manual create
  const handleManualCreate = async () => {
    if (!manualName.trim()) {
      setError('Name is required')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/customers/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_manual',
          source_type: preselectedSource?.type,
          source_id: preselectedSource?.id,
          customer_data: {
            name: manualName.trim(),
            email: manualEmail.trim() || null,
            phone: manualPhone.trim() || null,
            address_text: manualAddress.trim() || null,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create customer')
      }

      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetModal = () => {
    setStep('search')
    setSearchQuery('')
    setSearchResults([])
    setSelectedSource(null)
    setManualName('')
    setManualEmail('')
    setManualPhone('')
    setManualAddress('')
    setError(null)
    setShowAdvanced(false)
  }

  const handleClose = () => {
    resetModal()
    onClose()
  }

  if (!isOpen) return null

  const currentSources = sourceType === 'opportunity' 
    ? sources.opportunities 
    : sourceType === 'project' 
      ? sources.projects 
      : sources.jobs

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Link / Create Customer</h2>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Step tabs */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setStep('search')}
              className={`px-3 py-1.5 text-sm rounded-md ${
                step === 'search' 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Search Existing
            </button>
            <button
              onClick={() => setStep('create_from_source')}
              className={`px-3 py-1.5 text-sm rounded-md ${
                step === 'create_from_source' 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Create from Source
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Step A: Search existing customers */}
          {step === 'search' && (
            <div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Search by name, phone, or email
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter customer name, phone, or email..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>

              {isSearching && (
                <div className="text-center py-4 text-gray-500">Searching...</div>
              )}

              {!isSearching && searchResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 mb-2">
                    {searchResults.length} customer{searchResults.length !== 1 ? 's' : ''} found
                  </p>
                  {searchResults.map((customer) => (
                    <div
                      key={customer.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{customer.name}</p>
                        <p className="text-sm text-gray-500">
                          {[customer.email, customer.phone].filter(Boolean).join(' • ')}
                        </p>
                        {customer.address_text && (
                          <p className="text-sm text-gray-400">{customer.address_text}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleLinkCustomer(customer)}
                        disabled={isSubmitting}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {preselectedSource ? 'Link' : 'View'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>No customers found matching "{searchQuery}"</p>
                  <button
                    onClick={() => setStep('create_from_source')}
                    className="mt-2 text-blue-600 hover:text-blue-700 text-sm"
                  >
                    Create from source record →
                  </button>
                </div>
              )}

              {!isSearching && searchQuery.length < 2 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Enter at least 2 characters to search
                </div>
              )}
            </div>
          )}

          {/* Step B: Create from source record */}
          {step === 'create_from_source' && (
            <div>
              {/* Source type selector */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select source type
                </label>
                <div className="flex gap-2">
                  {(['opportunity', 'project', 'job'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setSourceType(type)
                        setSelectedSource(null)
                      }}
                      className={`px-3 py-1.5 text-sm rounded-md capitalize ${
                        sourceType === type
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {type === 'job' ? 'Job' : type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Show all toggle for opportunities */}
              {sourceType === 'opportunity' && (
                <label className="flex items-center gap-2 mb-4 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={showAllSources}
                    onChange={(e) => setShowAllSources(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Show all (including lost/closed)
                </label>
              )}

              {/* Source records list */}
              {isLoadingSources ? (
                <div className="text-center py-4 text-gray-500">Loading...</div>
              ) : currentSources.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No {sourceType}s without a linked customer</p>
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-gray-600">
                    {currentSources.length} record{currentSources.length !== 1 ? 's' : ''} without customer
                  </p>
                  {currentSources.map((source) => (
                    <div
                      key={source.id}
                      onClick={() => setSelectedSource(source)}
                      className={`p-3 border rounded-md cursor-pointer transition-colors ${
                        selectedSource?.id === source.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <p className="font-medium text-gray-900">{source.display_name}</p>
                      {source.customer_name && (
                        <p className="text-sm text-gray-600">Contact: {source.customer_name}</p>
                      )}
                      <p className="text-sm text-gray-500">
                        {[source.customer_email, source.customer_phone].filter(Boolean).join(' • ')}
                      </p>
                      {source.customer_address && (
                        <p className="text-sm text-gray-400">{source.customer_address}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Preview selected source */}
              {selectedSource && (
                <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-2">Customer will be created with:</p>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-gray-500">Name:</span> {selectedSource.customer_name || '—'}</p>
                    <p><span className="text-gray-500">Email:</span> {selectedSource.customer_email || '—'}</p>
                    <p><span className="text-gray-500">Phone:</span> {selectedSource.customer_phone || '—'}</p>
                    <p><span className="text-gray-500">Address:</span> {selectedSource.customer_address || '—'}</p>
                  </div>
                </div>
              )}

              {/* Advanced: Manual create */}
              <div className="mt-6 border-t border-gray-200 pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Advanced: Manual Create
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                      Prefer creating from source records to avoid duplicates
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={manualName}
                        onChange={(e) => setManualName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                          type="email"
                          value={manualEmail}
                          onChange={(e) => setManualEmail(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input
                          type="tel"
                          value={manualPhone}
                          onChange={(e) => setManualPhone(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                      <input
                        type="text"
                        value={manualAddress}
                        onChange={(e) => setManualAddress(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          
          {step === 'create_from_source' && (
            <>
              {showAdvanced && manualName.trim() ? (
                <button
                  onClick={handleManualCreate}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create Customer (Manual)'}
                </button>
              ) : selectedSource ? (
                <button
                  onClick={handleCreateFromSource}
                  disabled={isSubmitting || !selectedSource.customer_name}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create & Link Customer'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
