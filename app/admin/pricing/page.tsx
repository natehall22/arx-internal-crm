'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface RoofingType {
  id: string
  name: string
  description: string | null
  pricing_unit: 'square' | 'sqft' | 'lf'
  unit_price: number
  material_cost: number | null
  labor_cost: number | null
  default_warranty_years: number
  color: string
  is_default: boolean
}

interface OrgPricing {
  default_tax_rate: number | null
  sub_install_per_square: number | null
  sub_tearoff_per_square: number | null
  sub_dump_run_flat: number | null
}

const UNIT_LABELS: Record<string, string> = {
  'square': 'per square (100 sq ft)',
  'sqft': 'per sq ft',
  'lf': 'per linear ft',
}

const UNIT_SHORT: Record<string, string> = {
  'square': '/sq',
  'sqft': '/sf',
  'lf': '/lf',
}

export default function AdminPricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Simple state
  const [roofingTypes, setRoofingTypes] = useState<RoofingType[]>([])
  const [orgPricing, setOrgPricing] = useState<OrgPricing>({
    default_tax_rate: 8.25,
    sub_install_per_square: null,
    sub_tearoff_per_square: null,
    sub_dump_run_flat: null,
  })
  
  // Modal state
  const [showAddType, setShowAddType] = useState(false)
  const [editingType, setEditingType] = useState<RoofingType | null>(null)
  const [typeForm, setTypeForm] = useState({
    name: '',
    pricing_unit: 'square' as 'square' | 'sqft' | 'lf',
    unit_price: '',
    material_cost: '',
    labor_cost: '',
    warranty_years: '25',
    color: '#4f46e5',
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      // Load roofing types
      const rtResponse = await fetch('/api/admin/roofing-types')
      if (rtResponse.status === 401) {
        router.push('/login')
        return
      }
      if (rtResponse.status === 403) {
        alert('Access denied. Only admins and operations managers can access pricing.')
        router.push('/dashboard')
        return
      }
      if (rtResponse.ok) {
        const rtData = await rtResponse.json()
        setRoofingTypes(rtData.roofingTypes || [])
      }

      // Load org settings
      const settingsResponse = await fetch('/api/admin/pricing')
      if (settingsResponse.ok) {
        const data = await settingsResponse.json()
        if (data.orgSettings?.pricing) {
          setOrgPricing(prev => ({ ...prev, ...data.orgSettings.pricing }))
        }
      }

      setLoading(false)
    } catch (error) {
      console.error('Error loading data:', error)
      setLoading(false)
    }
  }

  const saveRoofingType = async () => {
    if (!typeForm.name || !typeForm.unit_price) {
      alert('Please enter a name and price')
      return
    }

    setSaving(true)
    try {
      const method = editingType ? 'PATCH' : 'POST'
      const body = {
        ...(editingType && { id: editingType.id }),
        name: typeForm.name,
        pricing_unit: typeForm.pricing_unit,
        unit_price: typeForm.unit_price,
        material_cost: typeForm.material_cost || null,
        labor_cost: typeForm.labor_cost || null,
        default_warranty_years: typeForm.warranty_years || '25',
        color: typeForm.color,
        is_default: roofingTypes.length === 0, // First one is default
      }

      const response = await fetch('/api/admin/roofing-types', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        await loadData()
        closeModal()
      }
    } catch (err) {
      console.error('Error saving:', err)
    }
    setSaving(false)
  }

  const deleteRoofingType = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    
    try {
      await fetch(`/api/admin/roofing-types?id=${id}`, { method: 'DELETE' })
      setRoofingTypes(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      console.error('Error deleting:', err)
    }
  }

  const setAsDefault = async (id: string) => {
    try {
      await fetch('/api/admin/roofing-types', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_default: true }),
      })
      setRoofingTypes(prev => prev.map(t => ({ ...t, is_default: t.id === id })))
    } catch (err) {
      console.error('Error setting default:', err)
    }
  }

  const saveSubRates = async () => {
    setSaving(true)
    try {
      await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'org_settings',
          pricing: orgPricing,
        }),
      })
    } catch (err) {
      console.error('Error saving:', err)
    }
    setSaving(false)
  }

  const openAddModal = () => {
    setEditingType(null)
    setTypeForm({
      name: '',
      pricing_unit: 'square',
      unit_price: '',
      material_cost: '',
      labor_cost: '',
      warranty_years: '25',
      color: '#4f46e5',
    })
    setShowAddType(true)
  }

  const openEditModal = (type: RoofingType) => {
    setEditingType(type)
    setTypeForm({
      name: type.name,
      pricing_unit: type.pricing_unit || 'square',
      unit_price: type.unit_price.toString(),
      material_cost: type.material_cost?.toString() || '',
      labor_cost: type.labor_cost?.toString() || '',
      warranty_years: type.default_warranty_years.toString(),
      color: type.color,
    })
    setShowAddType(true)
  }

  const closeModal = () => {
    setShowAddType(false)
    setEditingType(null)
  }

  // Calculate profit margin
  const calculateMargin = (price: number, material: number | null, labor: number | null) => {
    const cost = (material || 0) + (labor || 0)
    if (cost === 0) return null
    return ((price - cost) / price * 100).toFixed(0)
  }

  // Get placeholder based on unit
  const getPricePlaceholder = (unit: string) => {
    switch (unit) {
      case 'sqft': return '3.50'
      case 'lf': return '12.00'
      default: return '350'
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
      
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/admin" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Admin
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Pricing Setup</h1>
          <p className="text-gray-500 mt-1">Set your prices for different job types. Reps will select from these when building proposals.</p>
        </div>

        {/* Quick Start Guide - only show if no roofing types */}
        {roofingTypes.length === 0 && (
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-8 text-white mb-8">
            <h2 className="text-2xl font-bold mb-2">Welcome! Let's set up your pricing.</h2>
            <p className="text-indigo-100 mb-6">
              Add your first service type to get started. You can price by square (100 sq ft), per sq ft, or per linear foot.
            </p>
            <button
              onClick={openAddModal}
              className="px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50"
            >
              + Add Your First Service Type
            </button>
          </div>
        )}

        {/* Service Types Section */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Service Types & Prices</h2>
              <p className="text-sm text-gray-500">What you charge customers for each type of work</p>
            </div>
            {roofingTypes.length > 0 && (
              <button
                onClick={openAddModal}
                className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700"
              >
                + Add Type
              </button>
            )}
          </div>

          {roofingTypes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No service types yet. Add one to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {roofingTypes.map((type) => {
                const margin = calculateMargin(type.unit_price, type.material_cost, type.labor_cost)
                return (
                  <div
                    key={type.id}
                    className={`flex items-center justify-between p-4 rounded-xl border-2 ${
                      type.is_default ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div 
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: type.color + '20' }}
                      >
                        <svg className="w-6 h-6" fill="none" stroke={type.color} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{type.name}</h3>
                          {type.is_default && (
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {type.default_warranty_years} year warranty
                          {margin && <span className="ml-2 text-green-600">• {margin}% margin</span>}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-2xl font-bold" style={{ color: type.color }}>
                          ${type.unit_price.toLocaleString(undefined, { minimumFractionDigits: type.pricing_unit === 'square' ? 0 : 2 })}
                        </p>
                        <p className="text-xs text-gray-400">{UNIT_LABELS[type.pricing_unit] || 'per square'}</p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {!type.is_default && (
                          <button
                            onClick={() => setAsDefault(type.id)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                            title="Set as default"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(type)}
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteRoofingType(type.id, type.name)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Sub-Contractor Costs - Simple Section */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-8">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Your Costs (Optional)</h2>
            <p className="text-sm text-gray-500">What you pay sub-contractors. Used to calculate profit margins.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Install Labor</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={orgPricing.sub_install_per_square || ''}
                  onChange={(e) => setOrgPricing(prev => ({ 
                    ...prev, 
                    sub_install_per_square: e.target.value ? parseFloat(e.target.value) : null 
                  }))}
                  className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                  placeholder="145"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Per square</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tear-off Labor</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={orgPricing.sub_tearoff_per_square || ''}
                  onChange={(e) => setOrgPricing(prev => ({ 
                    ...prev, 
                    sub_tearoff_per_square: e.target.value ? parseFloat(e.target.value) : null 
                  }))}
                  className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                  placeholder="75"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Per square</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Dump Run</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={orgPricing.sub_dump_run_flat || ''}
                  onChange={(e) => setOrgPricing(prev => ({ 
                    ...prev, 
                    sub_dump_run_flat: e.target.value ? parseFloat(e.target.value) : null 
                  }))}
                  className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                  placeholder="150"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Flat rate per job</p>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">Default Tax Rate</label>
                <p className="text-xs text-gray-500">Applied to proposals by default</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={orgPricing.default_tax_rate || ''}
                  onChange={(e) => setOrgPricing(prev => ({ 
                    ...prev, 
                    default_tax_rate: e.target.value ? parseFloat(e.target.value) : null 
                  }))}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-right"
                  placeholder="8.25"
                />
                <span className="text-gray-500">%</span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={saveSubRates}
              disabled={saving}
              className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Costs'}
            </button>
          </div>
        </div>

        {/* Quick Links */}
        <div className="bg-gray-100 rounded-xl p-6">
          <h3 className="font-medium text-gray-900 mb-4">Related Settings</h3>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/proposals"
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
            >
              Manage Add-ons →
            </Link>
            <Link
              href="/proposals/builder"
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
            >
              Preview Proposal Builder →
            </Link>
          </div>
        </div>
      </div>

      {/* Add/Edit Service Type Modal */}
      {showAddType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">
                {editingType ? 'Edit Service Type' : 'Add Service Type'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Set the price you charge customers for this type of work.
              </p>
            </div>
            
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Service Name *
                </label>
                <input
                  type="text"
                  value={typeForm.name}
                  onChange={(e) => setTypeForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                  placeholder="e.g., Asphalt Shingles, Gutters, Siding"
                  autoFocus
                />
              </div>

              {/* Pricing Unit Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How do you price this?
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'square', label: 'Per Square', desc: '100 sq ft' },
                    { value: 'sqft', label: 'Per Sq Ft', desc: 'square foot' },
                    { value: 'lf', label: 'Per Linear Ft', desc: 'linear foot' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTypeForm(prev => ({ ...prev, pricing_unit: option.value as any }))}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        typeForm.pricing_unit === option.value
                          ? 'border-indigo-600 bg-indigo-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className={`font-medium text-sm ${typeForm.pricing_unit === option.value ? 'text-indigo-700' : 'text-gray-900'}`}>
                        {option.label}
                      </p>
                      <p className="text-xs text-gray-500">{option.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Price {UNIT_SHORT[typeForm.pricing_unit]} *
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={typeForm.unit_price}
                    onChange={(e) => setTypeForm(prev => ({ ...prev, unit_price: e.target.value }))}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-lg font-semibold"
                    placeholder={getPricePlaceholder(typeForm.pricing_unit)}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  This is what you charge customers {UNIT_LABELS[typeForm.pricing_unit]}.
                </p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700 mb-3">Your Costs (optional - for margin tracking)</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Material Cost</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={typeForm.material_cost}
                        onChange={(e) => setTypeForm(prev => ({ ...prev, material_cost: e.target.value }))}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder={typeForm.pricing_unit === 'square' ? '125' : '1.50'}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Labor Cost</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={typeForm.labor_cost}
                        onChange={(e) => setTypeForm(prev => ({ ...prev, labor_cost: e.target.value }))}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder={typeForm.pricing_unit === 'square' ? '145' : '1.75'}
                      />
                    </div>
                  </div>
                </div>
                {typeForm.unit_price && (typeForm.material_cost || typeForm.labor_cost) && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Your margin:</span>
                      <span className="font-semibold text-green-600">
                        {calculateMargin(
                          parseFloat(typeForm.unit_price) || 0,
                          parseFloat(typeForm.material_cost) || null,
                          parseFloat(typeForm.labor_cost) || null
                        )}%
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Warranty</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={typeForm.warranty_years}
                      onChange={(e) => setTypeForm(prev => ({ ...prev, warranty_years: e.target.value }))}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-lg"
                      placeholder="25"
                    />
                    <span className="text-gray-500">years</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                  <div className="flex gap-1">
                    {['#4f46e5', '#64748b', '#dc2626', '#059669', '#0891b2', '#a16207'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setTypeForm(prev => ({ ...prev, color }))}
                        className={`w-7 h-7 rounded-full border-2 ${typeForm.color === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-5 py-2.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={saveRoofingType}
                disabled={saving || !typeForm.name || !typeForm.unit_price}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingType ? 'Save Changes' : 'Add Service Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
