'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'

interface PricebookItem {
  id: string
  name: string
  category: string
  unit: string
  unit_price: number
  is_adder: boolean
  adder_category: string | null
  visibility: string
}

interface RoofingType {
  id: string
  name: string
  description: string | null
  price_per_square: number
  material_cost_per_square: number | null
  labor_cost_per_square: number | null
  labor_multiplier: number
  default_warranty_years: number
  default_warranty_text: string | null
  color: string
  is_default: boolean
}

interface RoofingType {
  id: string
  name: string
  description: string | null
  price_per_square: number
  material_cost_per_square: number | null
  labor_cost_per_square: number | null
  labor_multiplier: number
  default_warranty_years: number
  default_warranty_text: string | null
  color: string
  is_default: boolean
}

interface LineItem {
  id: string
  pricebook_item_id: string | null
  category: string
  name: string
  description: string
  unit: string
  quantity: number
  unit_price: number
  line_total: number
  is_adder: boolean
}

interface ProposalForm {
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_address: string
  title: string
  scope_of_work: string
  materials_description: string
  warranty_info: string
  discount_amount: number
  discount_percent: number
  tax_rate: number
  financing_available: boolean
  financing_term_months: number
  financing_rate: number
  accent_color: string
  roofing_type_id: string | null
}

const defaultForm: ProposalForm = {
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  customer_address: '',
  title: 'Roofing Proposal',
  scope_of_work: '',
  materials_description: '',
  warranty_info: '',
  discount_amount: 0,
  discount_percent: 0,
  tax_rate: 8.25,
  financing_available: false,
  financing_term_months: 60,
  financing_rate: 9.99,
  accent_color: '#4f46e5',
  roofing_type_id: null,
}

const adderCategories = [
  'Ventilation',
  'Gutters',
  'Skylights',
  'Chimney',
  'Decking',
  'Flashing',
  'Other',
]

export default function ProposalBuilderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const opportunityId = searchParams.get('opportunity_id') || searchParams.get('opportunity')
  const measurementId = searchParams.get('measurement_id')
  const urlSquares = searchParams.get('squares')
  const urlCustomerName = searchParams.get('customer_name')
  const urlCustomerAddress = searchParams.get('customer_address')
  
  const [loading, setLoading] = useState(true)
  const [measurementData, setMeasurementData] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<ProposalForm>(defaultForm)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [pricebookItems, setPricebookItems] = useState<PricebookItem[]>([])
  const [adders, setAdders] = useState<PricebookItem[]>([])
  const [selectedAdderCategory, setSelectedAdderCategory] = useState<string>('all')
  const [showAddItem, setShowAddItem] = useState(false)
  const [userRole, setUserRole] = useState<string>('')
  const [templates, setTemplates] = useState<any[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [roofingTypes, setRoofingTypes] = useState<RoofingType[]>([])
  const [selectedRoofingType, setSelectedRoofingType] = useState<RoofingType | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      // Build query params
      const params = new URLSearchParams()
      if (opportunityId) params.set('opportunity_id', opportunityId)
      if (measurementId) params.set('measurement_id', measurementId)

      const response = await fetch(`/api/proposals/builder?${params.toString()}`)
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        router.push('/dashboard')
        return
      }

      const data = await response.json()
      
      setUserRole(data.role)
      setPricebookItems(data.pricebookItems || [])
      setAdders(data.adders || [])
      setTemplates(data.templates || [])
      setRoofingTypes(data.roofingTypes || [])
      
      // Set default roofing type
      if (data.roofingTypes?.length) {
        const defaultType = data.roofingTypes.find((t: RoofingType) => t.is_default) || data.roofingTypes[0]
        setSelectedRoofingType(defaultType)
        setForm(prev => ({ ...prev, roofing_type_id: defaultType.id }))
      }

      // Apply template defaults
      if (data.templates?.length) {
        const defaultTemplate = data.templates.find((t: any) => t.is_default) || data.templates[0]
        setSelectedTemplate(defaultTemplate.id)
        if (defaultTemplate.default_scope_of_work) {
          setForm(prev => ({ ...prev, scope_of_work: defaultTemplate.default_scope_of_work }))
        }
        if (defaultTemplate.default_warranty_info) {
          setForm(prev => ({ ...prev, warranty_info: defaultTemplate.default_warranty_info }))
        }
        if (defaultTemplate.accent_color) {
          setForm(prev => ({ ...prev, accent_color: defaultTemplate.accent_color }))
        }
      }

      // Apply opportunity data
      if (data.opportunity) {
        const opp = data.opportunity
        setForm(prev => ({
          ...prev,
          customer_name: opp.leads?.homeowner_name || (opp.leads?.first_name + ' ' + opp.leads?.last_name) || '',
          customer_email: opp.leads?.email || '',
          customer_phone: opp.leads?.phone || '',
          customer_address: opp.address_text || opp.leads?.address_text || '',
        }))
      } else if (urlCustomerName || urlCustomerAddress) {
        setForm(prev => ({
          ...prev,
          customer_name: urlCustomerName || prev.customer_name,
          customer_address: urlCustomerAddress || prev.customer_address,
        }))
      }

      // Apply measurement data
      if (data.measurement) {
        setMeasurementData(data.measurement)
        
        if (data.measurement.address_text) {
          setForm(prev => ({
            ...prev,
            customer_address: prev.customer_address || data.measurement.address_text,
          }))
        }

        const squares = data.measurement.total_squares || parseFloat(urlSquares || '0')
        if (squares > 0) {
          autoPopulateLineItems(data.pricebookItems || [], squares)
        }
      } else if (urlSquares) {
        const squares = parseFloat(urlSquares)
        if (squares > 0) {
          autoPopulateLineItems(data.pricebookItems || [], squares)
        }
      }
    } catch (error) {
      console.error('Error loading builder data:', error)
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  // Convert quantity based on unit type
  // 1 square = 100 sq ft
  const convertQuantityForUnit = (squares: number, unit: string): number => {
    const unitLower = unit?.toLowerCase() || ''
    
    if (unitLower === 'sqft' || unitLower === 'sq ft' || unitLower === 'sf') {
      // Convert squares to square feet (1 square = 100 sq ft)
      return squares * 100
    }
    if (unitLower === 'square' || unitLower === 'sq' || unitLower === 'squares') {
      return squares
    }
    // For other units (each, lf, job, etc.), default to 1 or the squares value
    // depending on context - for now, use squares as a reasonable default
    return squares
  }

  const getUnitLabel = (unit: string): string => {
    const unitLower = unit?.toLowerCase() || ''
    switch (unitLower) {
      case 'square':
      case 'sq':
      case 'squares':
        return 'squares'
      case 'sqft':
      case 'sq ft':
      case 'sf':
        return 'sq ft'
      case 'lf':
        return 'linear ft'
      case 'each':
        return 'each'
      case 'job':
        return 'job'
      case 'hour':
        return 'hours'
      case 'watt':
        return 'watts'
      case 'bundle':
        return 'bundles'
      case 'roll':
        return 'rolls'
      case 'sheet':
        return 'sheets'
      default:
        return unit || 'units'
    }
  }

  const autoPopulateLineItems = (items: PricebookItem[], squares: number) => {
    // Find main roofing product (usually priced per square)
    const roofingItems = items.filter(item => 
      item.category?.toLowerCase().includes('roofing') || 
      item.category?.toLowerCase().includes('shingle') ||
      item.unit?.toLowerCase() === 'square' ||
      item.unit?.toLowerCase() === 'sq'
    )

    const newLineItems: LineItem[] = []

    // Add main roofing product
    if (roofingItems.length > 0) {
      const mainProduct = roofingItems[0]
      const quantity = convertQuantityForUnit(squares, mainProduct.unit)
      newLineItems.push({
        id: crypto.randomUUID(),
        pricebook_item_id: mainProduct.id,
        category: mainProduct.category,
        name: mainProduct.name,
        description: '',
        unit: mainProduct.unit,
        quantity,
        unit_price: mainProduct.unit_price,
        line_total: mainProduct.unit_price * quantity,
        is_adder: false,
      })
    }

    // Add labor if available
    const laborItems = items.filter(item => 
      item.category?.toLowerCase().includes('labor') ||
      item.name?.toLowerCase().includes('labor') ||
      item.name?.toLowerCase().includes('installation')
    )

    if (laborItems.length > 0) {
      const laborItem = laborItems[0]
      const quantity = convertQuantityForUnit(squares, laborItem.unit)
      newLineItems.push({
        id: crypto.randomUUID(),
        pricebook_item_id: laborItem.id,
        category: laborItem.category,
        name: laborItem.name,
        description: '',
        unit: laborItem.unit,
        quantity,
        unit_price: laborItem.unit_price,
        line_total: laborItem.unit_price * quantity,
        is_adder: false,
      })
    }

    if (newLineItems.length > 0) {
      setLineItems(newLineItems)
    }
  }

  const addLineItem = (item: PricebookItem, quantity?: number) => {
    // If no quantity provided, calculate based on measurement data and unit type
    let calculatedQuantity = quantity || 1
    
    if (!quantity && measurementData?.total_squares) {
      calculatedQuantity = convertQuantityForUnit(measurementData.total_squares, item.unit)
    }
    
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      pricebook_item_id: item.id,
      category: item.category,
      name: item.name,
      description: '',
      unit: item.unit,
      quantity: calculatedQuantity,
      unit_price: item.unit_price,
      line_total: item.unit_price * calculatedQuantity,
      is_adder: item.is_adder,
    }
    setLineItems(prev => [...prev, newItem])
    setShowAddItem(false)
  }

  const updateLineItem = (id: string, field: string, value: any) => {
    setLineItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        updated.line_total = updated.quantity * updated.unit_price
      }
      return updated
    }))
  }

  const removeLineItem = (id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id))
  }

  const calculateTotals = () => {
    const subtotal = lineItems.reduce((sum, item) => sum + (item.line_total || 0), 0)
    const discountAmount = form.discount_percent > 0 
      ? subtotal * (form.discount_percent / 100)
      : (form.discount_amount || 0)
    const afterDiscount = subtotal - discountAmount
    const taxAmount = afterDiscount * ((form.tax_rate || 0) / 100)
    const total = afterDiscount + taxAmount
    const monthlyPayment = form.financing_available 
      ? calculateMonthlyPayment(total, form.financing_rate || 0, form.financing_term_months || 60)
      : 0

    return { 
      subtotal: subtotal || 0, 
      discountAmount: discountAmount || 0, 
      afterDiscount: afterDiscount || 0, 
      taxAmount: taxAmount || 0, 
      total: total || 0, 
      monthlyPayment: monthlyPayment || 0 
    }
  }

  const calculateMonthlyPayment = (principal: number, annualRate: number, months: number) => {
    const monthlyRate = annualRate / 100 / 12
    if (monthlyRate === 0) return principal / months
    return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
  }

  const saveProposal = async (asDraft: boolean = true) => {
    // Validate required fields
    const missingFields: string[] = []
    if (!form.customer_name?.trim()) missingFields.push('Customer Name')
    if (!form.customer_phone?.trim()) missingFields.push('Phone Number')
    if (!form.customer_address?.trim()) missingFields.push('Address')
    if (!form.customer_email?.trim()) missingFields.push('Email')
    
    if (missingFields.length > 0) {
      alert(`Please fill in required fields: ${missingFields.join(', ')}`)
      setStep(1) // Go back to customer info step
      return
    }

    setSaving(true)

    try {
      const totals = calculateTotals()

      const proposalData = {
        opportunity_id: opportunityId || null,
        customer_name: form.customer_name,
        customer_email: form.customer_email,
        customer_phone: form.customer_phone,
        customer_address: form.customer_address,
        title: form.title,
        status: asDraft ? 'draft' : 'sent',
        subtotal: totals.subtotal,
        discount_amount: totals.discountAmount,
        discount_percent: form.discount_percent,
        tax_rate: form.tax_rate,
        tax_amount: totals.taxAmount,
        total: totals.total,
        financing_available: form.financing_available,
        financing_term_months: form.financing_term_months,
        financing_rate: form.financing_rate,
        monthly_payment: totals.monthlyPayment,
        scope_of_work: form.scope_of_work,
        materials_description: form.materials_description,
        warranty_info: form.warranty_info,
        accent_color: form.accent_color,
      }

      const lineItemsData = lineItems.map((item, idx) => ({
        pricebook_item_id: item.pricebook_item_id,
        category: item.category,
        name: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        is_adder: item.is_adder,
      }))

      const response = await fetch('/api/proposals/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal: proposalData,
          lineItems: lineItemsData,
        })
      })

      if (!response.ok) {
        const data = await response.json()
        console.error('Failed to save proposal:', data.error)
        alert(`Failed to save proposal: ${data.error || 'Unknown error'}`)
        setSaving(false)
        return
      }

      const { proposal } = await response.json()
      router.push(`/proposals/${proposal.id}`)
    } catch (error) {
      console.error('Error saving proposal:', error)
      alert(`Failed to save proposal: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  // Calculate totals with fallback for safety
  const totals = calculateTotals() || { subtotal: 0, discountAmount: 0, afterDiscount: 0, taxAmount: 0, total: 0, monthlyPayment: 0 }

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
    <div className="min-h-screen bg-gray-100">
      <Nav />
      
      {/* Progress Steps */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              {[
                { num: 1, label: 'Customer Info' },
                { num: 2, label: 'Roofing Type' },
                { num: 3, label: 'Pricing' },
                { num: 4, label: 'Adders' },
                { num: 5, label: 'Review' },
              ].map((s, idx) => (
                <button
                  key={s.num}
                  onClick={() => setStep(s.num)}
                  className={`flex items-center gap-2 ${step === s.num ? 'text-indigo-600' : 'text-gray-400'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    step === s.num ? 'bg-indigo-600 text-white' : step > s.num ? 'bg-green-500 text-white' : 'bg-gray-200'
                  }`}>
                    {step > s.num ? '✓' : s.num}
                  </div>
                  <span className="hidden sm:block font-medium">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Total</p>
              <p className="text-2xl font-bold text-gray-900">${(totals.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Back Button */}
        <div className="mb-6">
          <button
            onClick={() => {
              if (opportunityId) {
                router.push(`/opportunities/${opportunityId}`)
              } else {
                router.back()
              }
            }}
            className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {opportunityId ? 'Back to Opportunity' : 'Back'}
          </button>
        </div>

        {/* Measurement Summary Banner */}
        {measurementData && (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 mb-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-1">Roof Measurement Loaded</h3>
                <p className="text-indigo-100 text-sm">{measurementData.address_text}</p>
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <div className="text-3xl font-bold">{measurementData.total_squares?.toFixed(1) || urlSquares}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Squares</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{measurementData.total_area_sqft?.toLocaleString() || '-'}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Sq Ft</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{measurementData.predominant_pitch || '-'}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Pitch</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{measurementData.facet_count || '-'}</div>
                  <div className="text-xs text-indigo-200 uppercase tracking-wider">Sections</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Customer Info */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Customer Information</h2>
            
            <p className="text-sm text-gray-500 mb-4">Fields marked with * are required</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_name: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl text-lg ${!form.customer_name?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="John Smith"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_email: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl ${!form.customer_email?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="john@example.com"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone <span className="text-red-500">*</span></label>
                <input
                  type="tel"
                  value={form.customer_phone}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_phone: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl ${!form.customer_phone?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Property Address <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.customer_address}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_address: e.target.value }))}
                  className={`w-full px-4 py-3 border rounded-xl ${!form.customer_address?.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  placeholder="123 Main St, City, State 12345"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Proposal Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  placeholder="Roofing Proposal"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!form.customer_name?.trim() || !form.customer_address?.trim() || !form.customer_phone?.trim() || !form.customer_email?.trim()}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Roofing Type Selection */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Select Roofing Type</h2>
              <p className="text-gray-500 mb-6">Choose the type of roofing material for this project. Pricing will be calculated based on your selection.</p>

              {roofingTypes.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                  <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <p className="text-gray-500 mb-2">No roofing types configured</p>
                  <p className="text-sm text-gray-400">Ask your admin to set up roofing types in Admin → Pricing & Costs</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roofingTypes.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => {
                        setSelectedRoofingType(type)
                        setForm(prev => ({ ...prev, roofing_type_id: type.id }))
                        // Update warranty info if the type has default warranty text
                        if (type.default_warranty_text) {
                          setForm(prev => ({ ...prev, warranty_info: type.default_warranty_text || prev.warranty_info }))
                        }
                        // Auto-populate line items based on roofing type
                        const squares = measurementData?.total_squares || parseFloat(urlSquares || '0')
                        if (squares > 0) {
                          const newLineItem: LineItem = {
                            id: `roofing-${type.id}`,
                            pricebook_item_id: null,
                            category: 'Roofing',
                            name: `${type.name} Installation`,
                            description: type.description || '',
                            unit: 'square',
                            quantity: squares,
                            unit_price: type.price_per_square,
                            line_total: squares * type.price_per_square,
                            is_adder: false,
                          }
                          // Replace any existing roofing line items
                          setLineItems(prev => {
                            const nonRoofingItems = prev.filter(item => 
                              !item.name.toLowerCase().includes('roofing') && 
                              !item.name.toLowerCase().includes('installation') ||
                              item.is_adder
                            )
                            return [newLineItem, ...nonRoofingItems.filter(i => !i.is_adder)]
                          })
                        }
                      }}
                      className={`relative p-6 rounded-xl border-2 text-left transition-all ${
                        selectedRoofingType?.id === type.id
                          ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-600'
                          : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                      }`}
                    >
                      {type.is_default && (
                        <span className="absolute top-3 right-3 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                          Default
                        </span>
                      )}
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{ backgroundColor: type.color + '20' }}
                      >
                        <svg 
                          className="w-6 h-6" 
                          fill="none" 
                          stroke={type.color} 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">{type.name}</h3>
                      {type.description && (
                        <p className="text-sm text-gray-500 mb-3 line-clamp-2">{type.description}</p>
                      )}
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold" style={{ color: type.color }}>
                          ${(type.price_per_square || 0).toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-400">/square</span>
                      </div>
                      {type.default_warranty_years && (
                        <p className="text-xs text-gray-500 mt-2">
                          {type.default_warranty_years} year warranty
                        </p>
                      )}
                      {selectedRoofingType?.id === type.id && (
                        <div className="absolute top-3 left-3">
                          <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Show calculated price if roofing type selected and measurement available */}
              {selectedRoofingType && (measurementData?.total_squares || urlSquares) && (
                <div className="mt-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Estimated Base Price</p>
                      <p className="text-xs text-gray-500">
                        {measurementData?.total_squares?.toFixed(1) || urlSquares} squares × ${(selectedRoofingType?.price_per_square || 0).toLocaleString()}/sq
                      </p>
                    </div>
                    <p className="text-2xl font-bold text-indigo-600">
                      ${((measurementData?.total_squares || parseFloat(urlSquares || '0')) * (selectedRoofingType?.price_per_square || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={roofingTypes.length > 0 && !selectedRoofingType}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Pricing
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Line Items / Pricing */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Project Items</h2>

              {/* Admin/Ops view - can see and edit line items */}
              {['admin', 'operations'].includes(userRole) ? (
                <>
                  <div className="flex justify-end mb-4">
                    <button
                      onClick={() => setShowAddItem(true)}
                      className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700"
                    >
                      + Add Item
                    </button>
                  </div>

                  {lineItems.filter(i => !i.is_adder).length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                      <p className="text-gray-500 mb-4">No items added yet</p>
                      <button
                        onClick={() => setShowAddItem(true)}
                        className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700"
                      >
                        Add First Item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {lineItems.filter(i => !i.is_adder).map((item) => (
                        <div key={item.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{item.name}</p>
                            <p className="text-sm text-gray-500">{item.category}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                              className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center"
                              min="0"
                              step="0.1"
                            />
                            <span className="text-gray-500 text-sm w-20">{getUnitLabel(item.unit)}</span>
                            <span className="text-gray-900 font-medium w-24 text-right">
                              ${item.unit_price.toFixed(2)}
                            </span>
                            <span className="text-indigo-600 font-bold w-28 text-right">
                              ${(item.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <button
                              onClick={() => removeLineItem(item.id)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Sales Rep view - only sees total, not line items */
                <div className="space-y-6">
                  <div className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Base Project Price</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {measurementData ? (
                            <>Based on {measurementData.total_squares?.toFixed(1) || urlSquares} squares</>
                          ) : (
                            <>Calculated from measurement data</>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-indigo-600">
                          ${lineItems.filter(i => !i.is_adder).reduce((sum, i) => sum + (i.line_total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <strong>Note:</strong> The base price is automatically calculated from the roof measurement and your company's pricing. 
                      You can add optional upgrades on the next step.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Continue to Adders
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Adders */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Add-Ons & Upgrades</h2>
              <p className="text-gray-500 mb-4">Select additional items for this project</p>
              
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> Add-on pricing is visible to you while building. The customer proposal will only show the <strong>final total price</strong> - individual add-ons will not be itemized.
                </p>
              </div>

              {/* Category filter */}
              <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                <button
                  onClick={() => setSelectedAdderCategory('all')}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                    selectedAdderCategory === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All
                </button>
                {adderCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedAdderCategory(cat)}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                      selectedAdderCategory === cat ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Selected adders */}
              {lineItems.filter(i => i.is_adder).length > 0 && (
                <div className="mb-6 p-4 bg-green-50 rounded-xl border border-green-200">
                  <h3 className="font-medium text-green-800 mb-3">Selected Add-Ons</h3>
                  <div className="space-y-2">
                    {lineItems.filter(i => i.is_adder).map((item) => (
                      <div key={item.id} className="flex items-center justify-between">
                        <span className="text-green-700">{item.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-green-800">
                            ${(item.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            onClick={() => removeLineItem(item.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Available adders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {adders
                  .filter(a => selectedAdderCategory === 'all' || a.adder_category === selectedAdderCategory)
                  .filter(a => !lineItems.find(li => li.pricebook_item_id === a.id))
                  .map((adder) => (
                    <button
                      key={adder.id}
                      onClick={() => addLineItem(adder)}
                      className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{adder.name}</p>
                        <p className="text-sm text-gray-500">{adder.adder_category || adder.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-indigo-600">${(adder.unit_price || 0).toLocaleString()}</p>
                        <p className="text-xs text-gray-400">per {adder.unit}</p>
                      </div>
                    </button>
                  ))}
              </div>

              {adders.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No add-ons available. Contact admin to add items.
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(5)}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Review Proposal
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div className="space-y-6">
            {/* Preview Card */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              {/* Header */}
              <div 
                className="p-8 text-white"
                style={{ backgroundColor: form.accent_color }}
              >
                <h1 className="text-3xl font-bold mb-2">{form.title}</h1>
                <p className="text-white/80">Prepared for {form.customer_name}</p>
              </div>

              {/* Content */}
              <div className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Customer</h3>
                    <p className="font-medium text-gray-900">{form.customer_name}</p>
                    <p className="text-gray-600">{form.customer_address}</p>
                    {form.customer_phone && <p className="text-gray-600">{form.customer_phone}</p>}
                    {form.customer_email && <p className="text-gray-600">{form.customer_email}</p>}
                  </div>
                  <div className="text-right">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">Project Total</h3>
                    <p className="text-4xl font-bold" style={{ color: form.accent_color }}>
                      ${totals.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    {form.financing_available && (
                      <p className="text-gray-500 mt-1">
                        or ${totals.monthlyPayment.toFixed(2)}/mo for {form.financing_term_months} months
                      </p>
                    )}
                  </div>
                </div>

                {/* Scope of Work */}
                {form.scope_of_work && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Scope of Work</h3>
                    <p className="text-gray-600 whitespace-pre-wrap">{form.scope_of_work}</p>
                  </div>
                )}

                {/* Customer-Facing Pricing Summary - ONLY shows total */}
                <div className="bg-gray-50 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Investment Summary</h3>
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">Customer View</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-gray-600">
                      <span>Project Total</span>
                      <span>${(totals.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {totals.discountAmount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount</span>
                        <span>-${(totals.discountAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {totals.taxAmount > 0 && (
                      <div className="flex justify-between text-gray-600">
                        <span>Tax ({form.tax_rate}%)</span>
                        <span>${(totals.taxAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
                      <span>Total Investment</span>
                      <span>${totals.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-4 pt-3 border-t">
                    Note: Customer will only see the total investment amount. Line items and adders are not shown on the customer proposal.
                  </p>
                </div>

                {/* Financing */}
                {form.financing_available && (
                  <div className="mt-6 p-6 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h3 className="text-lg font-semibold text-indigo-900 mb-2">Financing Available</h3>
                    <p className="text-indigo-700">
                      As low as <span className="font-bold text-2xl">${totals.monthlyPayment.toFixed(2)}</span>/month
                    </p>
                    <p className="text-sm text-indigo-600 mt-1">
                      {form.financing_term_months} months at {form.financing_rate}% APR
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Internal Breakdown - NOT shown to customer */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 md:p-8">
              <div className="flex items-center gap-3 mb-4">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <h3 className="text-lg font-semibold text-amber-900">Internal Breakdown</h3>
                <span className="px-2 py-1 bg-amber-200 text-amber-800 text-xs font-medium rounded">Not shown to customer</span>
              </div>
              
              <div className="space-y-3">
                {/* Base Price */}
                <div className="flex justify-between py-2 border-b border-amber-200">
                  <span className="text-amber-900">Base Project Price</span>
                  <span className="font-medium text-amber-900">
                    ${lineItems.filter(i => !i.is_adder).reduce((sum, i) => sum + (i.line_total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Adders breakdown */}
                {lineItems.filter(i => i.is_adder).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-800">Add-Ons Included:</p>
                    {lineItems.filter(i => i.is_adder).map((item) => (
                      <div key={item.id} className="flex justify-between text-sm pl-4">
                        <span className="text-amber-700">{item.name} {item.quantity > 1 && `(×${item.quantity})`}</span>
                        <span className="text-amber-700">${(item.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 border-t border-amber-200">
                      <span className="text-amber-900">Total Add-Ons</span>
                      <span className="font-medium text-amber-900">
                        ${lineItems.filter(i => i.is_adder).reduce((sum, i) => sum + (i.line_total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Additional Options */}
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Proposal Options</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Discount</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={form.discount_amount}
                      onChange={(e) => setForm(prev => ({ ...prev, discount_amount: parseFloat(e.target.value) || 0, discount_percent: 0 }))}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="$ Amount"
                    />
                    <span className="flex items-center text-gray-400">or</span>
                    <input
                      type="number"
                      value={form.discount_percent}
                      onChange={(e) => setForm(prev => ({ ...prev, discount_percent: parseFloat(e.target.value) || 0, discount_amount: 0 }))}
                      className="w-24 px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="%"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.tax_rate}
                    onChange={(e) => setForm(prev => ({ ...prev, tax_rate: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={form.financing_available}
                      onChange={(e) => setForm(prev => ({ ...prev, financing_available: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="font-medium text-gray-900">Offer Financing Option</span>
                  </label>
                </div>

                {form.financing_available && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Term (months)</label>
                      <select
                        value={form.financing_term_months}
                        onChange={(e) => setForm(prev => ({ ...prev, financing_term_months: parseInt(e.target.value) }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value={12}>12 months (1 year)</option>
                        <option value={24}>24 months (2 years)</option>
                        <option value={36}>36 months (3 years)</option>
                        <option value={48}>48 months (4 years)</option>
                        <option value={60}>60 months (5 years)</option>
                        <option value={72}>72 months (6 years)</option>
                        <option value={84}>84 months (7 years)</option>
                        <option value={120}>120 months (10 years)</option>
                        <option value={144}>144 months (12 years)</option>
                        <option value={180}>180 months (15 years)</option>
                        <option value={240}>240 months (20 years)</option>
                        <option value={300}>300 months (25 years)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">APR (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={form.financing_rate}
                        onChange={(e) => setForm(prev => ({ ...prev, financing_rate: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </>
                )}

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Scope of Work</label>
                  <textarea
                    value={form.scope_of_work}
                    onChange={(e) => setForm(prev => ({ ...prev, scope_of_work: e.target.value }))}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                    placeholder="Describe the work to be performed..."
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Accent Color</label>
                  <div className="flex gap-3">
                    {['#4f46e5', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#ea580c'].map((color) => (
                      <button
                        key={color}
                        onClick={() => setForm(prev => ({ ...prev, accent_color: color }))}
                        className={`w-10 h-10 rounded-full border-2 ${form.accent_color === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              <button
                onClick={() => setStep(4)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => saveProposal(true)}
                  disabled={saving}
                  className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  onClick={() => saveProposal(false)}
                  disabled={saving}
                  className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Create Proposal'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Item Modal */}
        {showAddItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
              <div className="p-6 border-b flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Add Item</h2>
                <button
                  onClick={() => setShowAddItem(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {pricebookItems.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Pricebook Items</h3>
                    <p className="text-gray-500 mb-4">
                      No items have been added to your pricebook yet.
                    </p>
                    <p className="text-sm text-gray-400">
                      Go to <span className="font-medium">Admin → Pricing & Costs → Pricebook Items</span> to add items.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pricebookItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => addLineItem(item)}
                        className="w-full flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left"
                      >
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-sm text-gray-500">{item.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-indigo-600">${(item.unit_price || 0).toLocaleString()}</p>
                          <p className="text-xs text-gray-400">per {getUnitLabel(item.unit)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
