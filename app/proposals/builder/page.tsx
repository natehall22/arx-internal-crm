'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import { createClientBrowser } from '@/lib/supabase/client'

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

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const supabase = createClientBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      router.push('/dashboard')
      return
    }

    setUserRole(profile.role)

    // Load pricebook items based on visibility
    const { data: items } = await supabase
      .from('pricebook_items')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('category')
      .order('name')

    // Filter based on visibility
    const visibleItems = (items || []).filter(item => {
      if (!item.visibility || item.visibility === 'all' || item.visibility === 'sales_reps') return true
      if (item.visibility === 'managers' && ['admin', 'regional_manager', 'sales_manager', 'manager'].includes(profile.role)) return true
      if (item.visibility === 'admin_only' && profile.role === 'admin') return true
      return false
    })

    setPricebookItems(visibleItems.filter(i => !i.is_adder))
    setAdders(visibleItems.filter(i => i.is_adder))

    // Load templates
    const { data: templateData } = await supabase
      .from('proposal_templates')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)

    setTemplates(templateData || [])
    if (templateData?.length) {
      const defaultTemplate = templateData.find(t => t.is_default) || templateData[0]
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

    // Load opportunity data if provided
    if (opportunityId) {
      const { data: opp } = await supabase
        .from('opportunities')
        .select('*, leads(*)')
        .eq('id', opportunityId)
        .single()

      if (opp) {
        setForm(prev => ({
          ...prev,
          customer_name: opp.leads?.homeowner_name || opp.leads?.first_name + ' ' + opp.leads?.last_name || '',
          customer_email: opp.leads?.email || '',
          customer_phone: opp.leads?.phone || '',
          customer_address: opp.address_text || opp.leads?.address_text || '',
        }))
      }
    } else if (urlCustomerName || urlCustomerAddress) {
      // Use URL params if no opportunity but params provided
      setForm(prev => ({
        ...prev,
        customer_name: urlCustomerName || prev.customer_name,
        customer_address: urlCustomerAddress || prev.customer_address,
      }))
    }

    // Load measurement data if provided
    if (measurementId) {
      const { data: measurement } = await supabase
        .from('roof_measurements')
        .select('*')
        .eq('id', measurementId)
        .single()

      if (measurement) {
        setMeasurementData(measurement)
        
        // Update address from measurement if not already set
        if (measurement.address_text) {
          setForm(prev => ({
            ...prev,
            customer_address: prev.customer_address || measurement.address_text,
          }))
        }

        // Auto-add roofing line items based on squares
        const squares = measurement.total_squares || parseFloat(urlSquares || '0')
        if (squares > 0) {
          autoPopulateLineItems(visibleItems.filter(i => !i.is_adder), squares)
        }
      }
    } else if (urlSquares) {
      // Use squares from URL if no measurement ID
      const squares = parseFloat(urlSquares)
      if (squares > 0) {
        autoPopulateLineItems(visibleItems.filter(i => !i.is_adder), squares)
      }
    }

    setLoading(false)
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
      newLineItems.push({
        id: crypto.randomUUID(),
        pricebook_item_id: mainProduct.id,
        category: mainProduct.category,
        name: mainProduct.name,
        description: '',
        unit: mainProduct.unit,
        quantity: squares,
        unit_price: mainProduct.unit_price,
        line_total: mainProduct.unit_price * squares,
        is_adder: false,
      })
    }

    // Add labor if available (also per square typically)
    const laborItems = items.filter(item => 
      item.category?.toLowerCase().includes('labor') ||
      item.name?.toLowerCase().includes('labor') ||
      item.name?.toLowerCase().includes('installation')
    )

    if (laborItems.length > 0) {
      const laborItem = laborItems[0]
      newLineItems.push({
        id: crypto.randomUUID(),
        pricebook_item_id: laborItem.id,
        category: laborItem.category,
        name: laborItem.name,
        description: '',
        unit: laborItem.unit,
        quantity: squares,
        unit_price: laborItem.unit_price,
        line_total: laborItem.unit_price * squares,
        is_adder: false,
      })
    }

    if (newLineItems.length > 0) {
      setLineItems(newLineItems)
    }
  }

  const addLineItem = (item: PricebookItem, quantity: number = 1) => {
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      pricebook_item_id: item.id,
      category: item.category,
      name: item.name,
      description: '',
      unit: item.unit,
      quantity,
      unit_price: item.unit_price,
      line_total: item.unit_price * quantity,
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
    const subtotal = lineItems.reduce((sum, item) => sum + item.line_total, 0)
    const discountAmount = form.discount_percent > 0 
      ? subtotal * (form.discount_percent / 100)
      : form.discount_amount
    const afterDiscount = subtotal - discountAmount
    const taxAmount = afterDiscount * (form.tax_rate / 100)
    const total = afterDiscount + taxAmount
    const monthlyPayment = form.financing_available 
      ? calculateMonthlyPayment(total, form.financing_rate, form.financing_term_months)
      : 0

    return { subtotal, discountAmount, afterDiscount, taxAmount, total, monthlyPayment }
  }

  const calculateMonthlyPayment = (principal: number, annualRate: number, months: number) => {
    const monthlyRate = annualRate / 100 / 12
    if (monthlyRate === 0) return principal / months
    return principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
  }

  const saveProposal = async (asDraft: boolean = true) => {
    setSaving(true)
    const supabase = createClientBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) return

    const totals = calculateTotals()

    // Generate proposal number
    const { data: proposalNumber } = await supabase.rpc('generate_proposal_number', {
      p_org_id: profile.org_id
    })

    const proposalData = {
      org_id: profile.org_id,
      opportunity_id: opportunityId || null,
      created_by: user.id,
      proposal_number: proposalNumber || `P${Date.now()}`,
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

    const { data: proposal, error } = await supabase
      .from('proposals')
      .insert(proposalData)
      .select()
      .single()

    if (error || !proposal) {
      console.error('Failed to save proposal:', error)
      alert('Failed to save proposal')
      setSaving(false)
      return
    }

    // Save line items
    const lineItemsData = lineItems.map((item, idx) => ({
      org_id: profile.org_id,
      proposal_id: proposal.id,
      pricebook_item_id: item.pricebook_item_id,
      category: item.category,
      name: item.name,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
      is_adder: item.is_adder,
      show_on_pdf: false,
      sort_order: idx,
    }))

    await supabase.from('proposal_line_items').insert(lineItemsData)

    setSaving(false)
    router.push(`/proposals/${proposal.id}`)
  }

  const totals = calculateTotals()

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
                { num: 2, label: 'Line Items' },
                { num: 3, label: 'Adders' },
                { num: 4, label: 'Review' },
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
              <p className="text-2xl font-bold text-gray-900">${totals.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer Name *</label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_name: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg"
                  placeholder="John Smith"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_email: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  placeholder="john@example.com"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                <input
                  type="tel"
                  value={form.customer_phone}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_phone: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  placeholder="(555) 123-4567"
                />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Property Address *</label>
                <input
                  type="text"
                  value={form.customer_address}
                  onChange={(e) => setForm(prev => ({ ...prev, customer_address: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl"
                  placeholder="123 Main St, City, State 12345"
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
                disabled={!form.customer_name || !form.customer_address}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Line Items */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Project Items</h2>
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
                        <span className="text-gray-500 text-sm w-16">{item.unit}</span>
                        {userRole === 'admin' && (
                          <span className="text-gray-900 font-medium w-24 text-right">
                            ${item.unit_price.toFixed(2)}
                          </span>
                        )}
                        <span className="text-indigo-600 font-bold w-28 text-right">
                          ${item.line_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Continue to Adders
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Adders */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Add-Ons & Upgrades</h2>
              <p className="text-gray-500 mb-6">Select additional items for this project</p>

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
                            ${item.line_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                        <p className="font-bold text-indigo-600">${adder.unit_price.toLocaleString()}</p>
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
                onClick={() => setStep(2)}
                className="px-6 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
              >
                Review Proposal
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
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

                {/* Pricing Summary (only total shown to customer) */}
                <div className="bg-gray-50 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Investment Summary</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-gray-600">
                      <span>Project Total</span>
                      <span>${totals.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {totals.discountAmount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount</span>
                        <span>-${totals.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {totals.taxAmount > 0 && (
                      <div className="flex justify-between text-gray-600">
                        <span>Tax ({form.tax_rate}%)</span>
                        <span>${totals.taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xl font-bold text-gray-900 pt-2 border-t">
                      <span>Total Investment</span>
                      <span>${totals.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
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
                        <option value={12}>12 months</option>
                        <option value={24}>24 months</option>
                        <option value={36}>36 months</option>
                        <option value={48}>48 months</option>
                        <option value={60}>60 months</option>
                        <option value={72}>72 months</option>
                        <option value={84}>84 months</option>
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
                onClick={() => setStep(3)}
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
                        {userRole === 'admin' && (
                          <p className="font-bold text-indigo-600">${item.unit_price.toLocaleString()}</p>
                        )}
                        <p className="text-xs text-gray-400">per {item.unit}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
