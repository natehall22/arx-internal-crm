'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface Pricebook {
  id: string
  name: string
  is_default: boolean
  created_at: string
}

interface PricebookItem {
  id: string
  pricebook_id: string
  category: string
  item_type: string
  name: string
  unit: string
  unit_price: number
  cost_price: number | null
  is_labor: boolean
  is_taxable: boolean
  active: boolean
}

interface OrgPricing {
  price_per_square_installed: number | null
  price_per_watt: number | null
  dump_cost_per_square: number | null
  opex_per_job: number | null
  default_tax_rate: number | null
  default_markup_percent: number | null
  labor_rate_per_hour: number | null
  // New fields for flexible labor rate
  labor_rate_type: 'hour' | 'square' | 'kw' | null
  labor_rate_value: number | null
  // Separated costs - Sub rates
  material_cost_per_square: number | null
  labor_cost_per_square: number | null
  material_cost_per_watt: number | null
  labor_cost_per_watt: number | null
  // Sub-contractor rates by task
  sub_install_per_square: number | null
  sub_tearoff_per_square: number | null
  sub_dump_run_flat: number | null
  // In-house labor settings
  inhouse_enabled: boolean
  inhouse_install_per_square: number | null
  inhouse_tearoff_per_square: number | null
  inhouse_hourly_rate: number | null
  inhouse_solar_per_watt: number | null
}

interface CustomCategory {
  id: string
  name: string
  color?: string
}

type Tab = 'overview' | 'roofing-types' | 'pricebook' | 'costs' | 'labor' | 'categories'

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
  sort_order: number
  is_default: boolean
  active: boolean
}

const defaultCategories: CustomCategory[] = [
  { id: 'roofing', name: 'Roofing', color: 'blue' },
  { id: 'siding', name: 'Siding', color: 'green' },
  { id: 'windows', name: 'Windows', color: 'purple' },
  { id: 'addons', name: 'Add-ons', color: 'orange' },
]
const itemTypeOptions = ['install', 'tearoff', 'material', 'addon', 'disposal', 'cleanup', 'dumpster', 'decking', 'flashing']
const unitOptions = [
  { value: 'square', label: 'Square (100 sq ft)', description: 'Roofing standard' },
  { value: 'sqft', label: 'Sq Ft', description: 'Per square foot' },
  { value: 'each', label: 'Each', description: 'Per unit' },
  { value: 'lf', label: 'Linear Ft', description: 'Per linear foot' },
  { value: 'sheet', label: 'Sheet', description: 'Per sheet' },
  { value: 'job', label: 'Job', description: 'Flat rate per job' },
  { value: 'hour', label: 'Hour', description: 'Per hour' },
  { value: 'watt', label: 'Watt', description: 'Per watt (solar)' },
  { value: 'bundle', label: 'Bundle', description: 'Per bundle' },
  { value: 'roll', label: 'Roll', description: 'Per roll' },
]

export default function AdminPricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [orgId, setOrgId] = useState('')
  
  // Data
  const [pricebooks, setPricebooks] = useState<Pricebook[]>([])
  const [selectedPricebook, setSelectedPricebook] = useState<string>('')
  const [items, setItems] = useState<PricebookItem[]>([])
  const [orgPricing, setOrgPricing] = useState<OrgPricing>({
    price_per_square_installed: null,
    price_per_watt: null,
    dump_cost_per_square: null,
    opex_per_job: null,
    default_tax_rate: null,
    default_markup_percent: null,
    labor_rate_per_hour: null,
    labor_rate_type: 'hour',
    labor_rate_value: null,
    material_cost_per_square: null,
    labor_cost_per_square: null,
    material_cost_per_watt: null,
    labor_cost_per_watt: null,
    // Sub rates
    sub_install_per_square: null,
    sub_tearoff_per_square: null,
    sub_dump_run_flat: null,
    // In-house rates
    inhouse_enabled: false,
    inhouse_install_per_square: null,
    inhouse_tearoff_per_square: null,
    inhouse_hourly_rate: null,
    inhouse_solar_per_watt: null,
  })
  
  // Categories
  const [categories, setCategories] = useState<CustomCategory[]>(defaultCategories)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<CustomCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', color: 'blue' })
  
  // Roofing Types
  const [roofingTypes, setRoofingTypes] = useState<RoofingType[]>([])
  const [showRoofingTypeModal, setShowRoofingTypeModal] = useState(false)
  const [editingRoofingType, setEditingRoofingType] = useState<RoofingType | null>(null)
  const [roofingTypeForm, setRoofingTypeForm] = useState({
    name: '',
    description: '',
    price_per_square: '',
    material_cost_per_square: '',
    labor_cost_per_square: '',
    labor_multiplier: '1.00',
    default_warranty_years: '25',
    default_warranty_text: '',
    color: '#4f46e5',
    is_default: false,
  })
  
  // Modal states
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState<PricebookItem | null>(null)
  const [showPricebookModal, setShowPricebookModal] = useState(false)
  
  // Form states
  const [itemForm, setItemForm] = useState({
    category: '',
    item_type: 'install',
    name: '',
    unit: 'square',
    unit_price: '',
    cost_price: '',
    is_labor: false,
    is_taxable: true,
  })
  const [pricebookName, setPricebookName] = useState('')
  
  // Filter
  const [filterCategory, setFilterCategory] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async (pricebookId?: string) => {
    try {
      const url = pricebookId 
        ? `/api/admin/pricing?pricebook_id=${pricebookId}`
        : '/api/admin/pricing'
      
      const response = await fetch(url)
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        alert('Access denied. Only admins and operations managers can access pricing and cost data.')
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        console.error('Failed to load pricing data')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      
      setOrgId(data.orgId)
      setPricebooks(data.pricebooks || [])
      setItems(data.items || [])
      
      // Select default pricebook if not already selected
      if (!pricebookId && data.pricebooks?.length > 0) {
        const defaultPb = data.pricebooks.find((p: any) => p.is_default) || data.pricebooks[0]
        setSelectedPricebook(defaultPb.id)
      }
      
      // Load org pricing settings
      if (data.orgSettings?.pricing) {
        setOrgPricing(prev => ({ ...prev, ...data.orgSettings.pricing }))
      }
      
      // Load custom categories or use defaults
      if (data.orgSettings?.categories && data.orgSettings.categories.length > 0) {
        setCategories(data.orgSettings.categories)
      } else {
        setCategories(defaultCategories)
      }
      
      // Load roofing types
      try {
        const rtResponse = await fetch('/api/admin/roofing-types')
        if (rtResponse.ok) {
          const rtData = await rtResponse.json()
          setRoofingTypes(rtData.roofingTypes || [])
        }
      } catch (err) {
        console.error('Error loading roofing types:', err)
      }
      
      setLoading(false)
    } catch (error) {
      console.error('Error loading pricing data:', error)
      setLoading(false)
    }
  }

  const loadItems = async (pricebookId: string) => {
    try {
      const response = await fetch(`/api/admin/pricing?pricebook_id=${pricebookId}`)
      if (response.ok) {
        const data = await response.json()
        setItems(data.items || [])
      }
    } catch (error) {
      console.error('Error loading items:', error)
    }
  }

  const saveOrgPricing = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'org_settings',
          pricing: orgPricing
        })
      })
      
      if (response.ok) {
        alert('Pricing settings saved!')
      } else {
        const data = await response.json()
        alert(`Failed to save: ${data.error}`)
      }
    } catch (error) {
      alert('Failed to save pricing settings')
    }
    setSaving(false)
  }

  const saveCategories = async (newCategories: CustomCategory[]) => {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'org_settings',
          categories: newCategories
        })
      })
      
      if (response.ok) {
        setCategories(newCategories)
      }
    } catch (error) {
      console.error('Failed to save categories:', error)
    }
    setSaving(false)
  }

  const openCategoryModal = (category?: CustomCategory) => {
    if (category) {
      setEditingCategory(category)
      setCategoryForm({ name: category.name, color: category.color || 'blue' })
    } else {
      setEditingCategory(null)
      setCategoryForm({ name: '', color: 'blue' })
    }
    setShowCategoryModal(true)
  }

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) {
      alert('Category name is required')
      return
    }

    let newCategories: CustomCategory[]
    
    if (editingCategory) {
      // Update existing
      newCategories = categories.map(c => 
        c.id === editingCategory.id 
          ? { ...c, name: categoryForm.name.trim(), color: categoryForm.color }
          : c
      )
    } else {
      // Add new
      const newId = categoryForm.name.trim().toLowerCase().replace(/\s+/g, '_')
      // Check for duplicate
      if (categories.some(c => c.id === newId)) {
        alert('A category with this name already exists')
        return
      }
      newCategories = [...categories, { 
        id: newId, 
        name: categoryForm.name.trim(), 
        color: categoryForm.color 
      }]
    }

    await saveCategories(newCategories)
    setShowCategoryModal(false)
  }

  const deleteCategory = async (categoryId: string) => {
    // Check if any items use this category
    const itemsUsingCategory = items.filter(i => i.category === categoryId)
    if (itemsUsingCategory.length > 0) {
      alert(`Cannot delete this category. ${itemsUsingCategory.length} item(s) are using it. Please reassign them first.`)
      return
    }

    if (!confirm('Are you sure you want to delete this category?')) return

    const newCategories = categories.filter(c => c.id !== categoryId)
    await saveCategories(newCategories)
  }

  const createPricebook = async () => {
    if (!pricebookName.trim()) return

    setSaving(true)
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pricebook',
          name: pricebookName.trim()
        })
      })
      
      if (response.ok) {
        setShowPricebookModal(false)
        setPricebookName('')
        await loadData()
      }
    } catch (error) {
      console.error('Failed to create pricebook:', error)
    }
    setSaving(false)
  }

  const setDefaultPricebook = async (id: string) => {
    setSaving(true)
    try {
      await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pricebook_default',
          id
        })
      })
      await loadData()
    } catch (error) {
      console.error('Failed to set default pricebook:', error)
    }
    setSaving(false)
  }

  const deletePricebook = async (id: string) => {
    if (!confirm('Delete this pricebook and all its items?')) return
    try {
      await fetch(`/api/admin/pricing?type=pricebook&id=${id}`, {
        method: 'DELETE'
      })
      await loadData()
    } catch (error) {
      console.error('Failed to delete pricebook:', error)
    }
  }

  const openItemModal = (item?: PricebookItem) => {
    if (item) {
      setEditingItem(item)
      setItemForm({
        category: item.category,
        item_type: item.item_type,
        name: item.name,
        unit: item.unit,
        unit_price: item.unit_price.toString(),
        cost_price: item.cost_price?.toString() || '',
        is_labor: item.is_labor,
        is_taxable: item.is_taxable,
      })
    } else {
      setEditingItem(null)
      setItemForm({
        category: categories[0]?.id || 'general',
        item_type: 'install',
        name: '',
        unit: 'square',
        unit_price: '',
        cost_price: '',
        is_labor: false,
        is_taxable: true,
      })
    }
    setShowItemModal(true)
  }

  const saveItem = async () => {
    if (!itemForm.name || !itemForm.unit_price) {
      alert('Name and price are required')
      return
    }

    if (!selectedPricebook) {
      alert('Please select or create a pricebook first')
      return
    }

    setSaving(true)

    const itemData = {
      pricebook_id: selectedPricebook,
      category: itemForm.category,
      item_type: itemForm.item_type,
      name: itemForm.name,
      unit: itemForm.unit,
      unit_price: parseFloat(itemForm.unit_price),
      cost_price: itemForm.cost_price ? parseFloat(itemForm.cost_price) : null,
      is_labor: itemForm.is_labor,
      is_taxable: itemForm.is_taxable,
    }

    try {
      if (editingItem) {
        const response = await fetch('/api/admin/pricing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'item',
            id: editingItem.id,
            ...itemData
          })
        })
        
        if (!response.ok) {
          const data = await response.json()
          alert(`Failed to update item: ${data.error}`)
          setSaving(false)
          return
        }
      } else {
        const response = await fetch('/api/admin/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'item',
            ...itemData
          })
        })
        
        if (!response.ok) {
          const data = await response.json()
          alert(`Failed to add item: ${data.error}`)
          setSaving(false)
          return
        }
      }

      setShowItemModal(false)
      await loadItems(selectedPricebook)
    } catch (error) {
      alert('Failed to save item')
    }
    setSaving(false)
  }

  const toggleItemActive = async (item: PricebookItem) => {
    try {
      await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'item',
          id: item.id,
          active: !item.active
        })
      })
      await loadItems(selectedPricebook)
    } catch (error) {
      console.error('Failed to toggle item:', error)
    }
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return
    try {
      await fetch(`/api/admin/pricing?type=item&id=${id}`, {
        method: 'DELETE'
      })
      await loadItems(selectedPricebook)
    } catch (error) {
      console.error('Failed to delete item:', error)
    }
  }

  const filteredItems = filterCategory 
    ? items.filter(i => i.category === filterCategory)
    : items

  const getMargin = (price: number, cost: number | null) => {
    if (!cost || cost === 0) return null
    return ((price - cost) / price * 100).toFixed(1)
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

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Pricing & Costs</h1>
            <p className="text-gray-500 mt-1">Manage your pricing, costs, and pricebook items</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b overflow-x-auto">
          {[
            { id: 'overview', label: 'Pricing Overview' },
            { id: 'roofing-types', label: 'Roofing Types' },
            { id: 'pricebook', label: 'Pricebook Items' },
            { id: 'categories', label: 'Categories' },
            { id: 'costs', label: 'Cost Settings' },
            { id: 'labor', label: 'Labor Rates' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`px-6 py-3 font-medium text-sm border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Pricing Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Pricing Metrics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Price Per Square (Installed)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.price_per_square_installed || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        price_per_square_installed: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="350.00"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Contracted price per square installed</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Price Per Watt (PPW)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.price_per_watt || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        price_per_watt: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="3.50"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">For solar installations</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Dump Cost Per Square
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.dump_cost_per_square || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        dump_cost_per_square: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="25.00"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Disposal/dumpster cost per square</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    OPEX Per Job
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.opex_per_job || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        opex_per_job: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="500.00"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Operating expenses per job</p>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Default Tax Rate (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.default_tax_rate || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        default_tax_rate: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="8.25"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Default Markup (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.default_markup_percent || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        default_markup_percent: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="35"
                    />
                  </div>
                </div>
              </div>

              {/* Labor Rate with Unit Selection */}
              <div className="mt-6 pt-6 border-t">
                <h3 className="text-md font-semibold text-gray-900 mb-4">Default Labor Rate</h3>
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Rate Type
                    </label>
                    <select
                      value={orgPricing.labor_rate_type || 'hour'}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        labor_rate_type: e.target.value as 'hour' | 'square' | 'kw'
                      }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                    >
                      <option value="hour">Per Hour</option>
                      <option value="square">Per Square (100 sq ft)</option>
                      <option value="kw">Per kW</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Rate Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={orgPricing.labor_rate_value || ''}
                        onChange={(e) => setOrgPricing(prev => ({ 
                          ...prev, 
                          labor_rate_value: e.target.value ? parseFloat(e.target.value) : null 
                        }))}
                        className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                        placeholder={
                          orgPricing.labor_rate_type === 'hour' ? '75.00' :
                          orgPricing.labor_rate_type === 'square' ? '65.00' :
                          '0.15'
                        }
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {orgPricing.labor_rate_type === 'hour' && 'Standard hourly labor rate for time-based work'}
                  {orgPricing.labor_rate_type === 'square' && 'Labor rate per roofing square (100 sq ft) for roofing jobs'}
                  {orgPricing.labor_rate_type === 'kw' && 'Labor rate per kilowatt for solar installations'}
                </p>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={saveOrgPricing}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Pricing Settings'}
                </button>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-1">Total Pricebook Items</h3>
                <p className="text-3xl font-bold text-gray-900">{items.length}</p>
                <p className="text-sm text-gray-500 mt-1">{items.filter(i => i.active).length} active</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-1">Pricebooks</h3>
                <p className="text-3xl font-bold text-gray-900">{pricebooks.length}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {pricebooks.find(p => p.is_default)?.name || 'No default set'}
                </p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-1">Avg. Margin</h3>
                <p className="text-3xl font-bold text-green-600">
                  {items.filter(i => i.cost_price).length > 0
                    ? (items
                        .filter(i => i.cost_price)
                        .reduce((acc, i) => acc + ((i.unit_price - (i.cost_price || 0)) / i.unit_price * 100), 0) / 
                        items.filter(i => i.cost_price).length
                      ).toFixed(1) + '%'
                    : 'N/A'}
                </p>
                <p className="text-sm text-gray-500 mt-1">On items with cost data</p>
              </div>
            </div>
          </div>
        )}

        {/* Roofing Types Tab */}
        {activeTab === 'roofing-types' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Roofing Material Types</h2>
                  <p className="text-sm text-gray-500">Configure different roofing materials with their own pricing. Sales reps will select the roofing type when building proposals.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingRoofingType(null)
                    setRoofingTypeForm({
                      name: '',
                      description: '',
                      price_per_square: '',
                      material_cost_per_square: '',
                      labor_cost_per_square: '',
                      labor_multiplier: '1.00',
                      default_warranty_years: '25',
                      default_warranty_text: '',
                      color: '#4f46e5',
                      is_default: false,
                    })
                    setShowRoofingTypeModal(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                >
                  + Add Roofing Type
                </button>
              </div>

              {roofingTypes.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                  <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <p className="text-gray-500 mb-2">No roofing types configured</p>
                  <p className="text-sm text-gray-400 mb-4">Add roofing types like Asphalt Shingles, Metal, Tile, etc.</p>
                  <button
                    onClick={() => {
                      setShowRoofingTypeModal(true)
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                  >
                    Add First Roofing Type
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roofingTypes.map((type) => (
                    <div
                      key={type.id}
                      className="relative border rounded-xl p-5 hover:border-indigo-200 transition-colors"
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
                      <div className="flex items-baseline gap-1 mb-3">
                        <span className="text-2xl font-bold" style={{ color: type.color }}>
                          ${type.price_per_square.toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-400">/square</span>
                      </div>
                      <div className="text-xs text-gray-500 space-y-1 mb-4">
                        {type.material_cost_per_square && (
                          <p>Material: ${type.material_cost_per_square}/sq</p>
                        )}
                        {type.labor_cost_per_square && (
                          <p>Labor: ${type.labor_cost_per_square}/sq</p>
                        )}
                        {type.labor_multiplier !== 1 && (
                          <p>Labor multiplier: {type.labor_multiplier}x</p>
                        )}
                        <p>Warranty: {type.default_warranty_years} years</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingRoofingType(type)
                            setRoofingTypeForm({
                              name: type.name,
                              description: type.description || '',
                              price_per_square: type.price_per_square.toString(),
                              material_cost_per_square: type.material_cost_per_square?.toString() || '',
                              labor_cost_per_square: type.labor_cost_per_square?.toString() || '',
                              labor_multiplier: type.labor_multiplier.toString(),
                              default_warranty_years: type.default_warranty_years.toString(),
                              default_warranty_text: type.default_warranty_text || '',
                              color: type.color,
                              is_default: type.is_default,
                            })
                            setShowRoofingTypeModal(true)
                          }}
                          className="flex-1 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete "${type.name}"?`)) return
                            try {
                              await fetch(`/api/admin/roofing-types?id=${type.id}`, { method: 'DELETE' })
                              setRoofingTypes(prev => prev.filter(t => t.id !== type.id))
                            } catch (err) {
                              console.error('Error deleting roofing type:', err)
                            }
                          }}
                          className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Roofing Type Modal */}
        {showRoofingTypeModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingRoofingType ? 'Edit Roofing Type' : 'Add Roofing Type'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                  <input
                    type="text"
                    value={roofingTypeForm.name}
                    onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Asphalt Shingles"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <textarea
                    value={roofingTypeForm.description}
                    onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    rows={2}
                    placeholder="3-tab or architectural asphalt shingles"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Price Per Square *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={roofingTypeForm.price_per_square}
                      onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, price_per_square: e.target.value }))}
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="350.00"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">The price charged to customers per square (100 sq ft)</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Material Cost/Sq</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={roofingTypeForm.material_cost_per_square}
                        onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, material_cost_per_square: e.target.value }))}
                        className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                        placeholder="125.00"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Labor Cost/Sq</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={roofingTypeForm.labor_cost_per_square}
                        onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, labor_cost_per_square: e.target.value }))}
                        className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                        placeholder="145.00"
                      />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Labor Multiplier</label>
                    <input
                      type="number"
                      step="0.01"
                      value={roofingTypeForm.labor_multiplier}
                      onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, labor_multiplier: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="1.00"
                    />
                    <p className="text-xs text-gray-500 mt-1">1.5 = 50% more labor time</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Warranty Years</label>
                    <input
                      type="number"
                      value={roofingTypeForm.default_warranty_years}
                      onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, default_warranty_years: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      placeholder="25"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                  <div className="flex gap-2">
                    {['#4f46e5', '#64748b', '#dc2626', '#0891b2', '#a16207', '#1e293b', '#059669', '#7c3aed'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setRoofingTypeForm(prev => ({ ...prev, color }))}
                        className={`w-8 h-8 rounded-full border-2 ${roofingTypeForm.color === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={roofingTypeForm.is_default}
                    onChange={(e) => setRoofingTypeForm(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">Set as default roofing type</span>
                </label>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowRoofingTypeModal(false)
                    setEditingRoofingType(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      const method = editingRoofingType ? 'PATCH' : 'POST'
                      const body = editingRoofingType 
                        ? { id: editingRoofingType.id, ...roofingTypeForm }
                        : roofingTypeForm
                      
                      const response = await fetch('/api/admin/roofing-types', {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                      })
                      
                      if (response.ok) {
                        const data = await response.json()
                        if (editingRoofingType) {
                          setRoofingTypes(prev => prev.map(t => 
                            t.id === editingRoofingType.id ? data.roofingType : t
                          ))
                        } else {
                          setRoofingTypes(prev => [...prev, data.roofingType])
                        }
                        // If set as default, update others
                        if (roofingTypeForm.is_default) {
                          setRoofingTypes(prev => prev.map(t => ({
                            ...t,
                            is_default: t.id === (data.roofingType?.id || editingRoofingType?.id)
                          })))
                        }
                        setShowRoofingTypeModal(false)
                        setEditingRoofingType(null)
                      }
                    } catch (err) {
                      console.error('Error saving roofing type:', err)
                    }
                    setSaving(false)
                  }}
                  disabled={saving || !roofingTypeForm.name || !roofingTypeForm.price_per_square}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingRoofingType ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pricebook Items Tab */}
        {activeTab === 'pricebook' && (
          <div>
            {/* Pricebook selector */}
            <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-gray-700">Pricebook:</label>
                  <select
                    value={selectedPricebook}
                    onChange={(e) => {
                      setSelectedPricebook(e.target.value)
                      loadItems(e.target.value)
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg bg-white"
                  >
                    {pricebooks.map(pb => (
                      <option key={pb.id} value={pb.id}>
                        {pb.name} {pb.is_default ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowPricebookModal(true)}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    + New Pricebook
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                  >
                    <option value="">All Categories</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => openItemModal()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                  >
                    + Add Item
                  </button>
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        No items in this pricebook yet.{' '}
                        <button onClick={() => openItemModal()} className="text-indigo-600 hover:underline">
                          Add your first item
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id} className={!item.active ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-gray-900">{item.name}</p>
                            <p className="text-xs text-gray-500">per {item.unit}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded ${
                            (() => {
                              const cat = categories.find(c => c.id === item.category)
                              const color = cat?.color || 'gray'
                              return color === 'blue' ? 'bg-blue-100 text-blue-700' :
                                color === 'green' ? 'bg-green-100 text-green-700' :
                                color === 'purple' ? 'bg-purple-100 text-purple-700' :
                                color === 'orange' ? 'bg-orange-100 text-orange-700' :
                                color === 'red' ? 'bg-red-100 text-red-700' :
                                color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                                color === 'pink' ? 'bg-pink-100 text-pink-700' :
                                color === 'teal' ? 'bg-teal-100 text-teal-700' :
                                'bg-gray-100 text-gray-700'
                            })()
                          }`}>
                            {categories.find(c => c.id === item.category)?.name || item.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 capitalize">{item.item_type}</td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900">
                          ${item.unit_price.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-right text-gray-600">
                          {item.cost_price ? `$${item.cost_price.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {item.cost_price ? (
                            <span className={`font-medium ${
                              parseFloat(getMargin(item.unit_price, item.cost_price) || '0') > 30 
                                ? 'text-green-600' 
                                : parseFloat(getMargin(item.unit_price, item.cost_price) || '0') > 15
                                  ? 'text-yellow-600'
                                  : 'text-red-600'
                            }`}>
                              {getMargin(item.unit_price, item.cost_price)}%
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => toggleItemActive(item)}
                            className={`px-2 py-1 text-xs rounded font-medium ${
                              item.active 
                                ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {item.active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => openItemModal(item)}
                              className="text-indigo-600 hover:text-indigo-800 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteItem(item.id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <div className="bg-white rounded-xl shadow-sm border">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Item Categories</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Customize categories to match your industry (roofing, solar, electrical, etc.)
                  </p>
                </div>
                <button
                  onClick={() => openCategoryModal()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  + Add Category
                </button>
              </div>
            </div>
            
            <div className="divide-y">
              {categories.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  No categories defined.{' '}
                  <button onClick={() => openCategoryModal()} className="text-indigo-600 hover:underline">
                    Add your first category
                  </button>
                </div>
              ) : (
                categories.map((category, index) => (
                  <div key={category.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center gap-4">
                      <div className={`w-3 h-3 rounded-full ${
                        category.color === 'blue' ? 'bg-blue-500' :
                        category.color === 'green' ? 'bg-green-500' :
                        category.color === 'purple' ? 'bg-purple-500' :
                        category.color === 'orange' ? 'bg-orange-500' :
                        category.color === 'red' ? 'bg-red-500' :
                        category.color === 'yellow' ? 'bg-yellow-500' :
                        category.color === 'pink' ? 'bg-pink-500' :
                        category.color === 'teal' ? 'bg-teal-500' :
                        'bg-gray-500'
                      }`} />
                      <div>
                        <p className="font-medium text-gray-900">{category.name}</p>
                        <p className="text-sm text-gray-500">ID: {category.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400 mr-4">
                        {items.filter(i => i.category === category.id).length} items
                      </span>
                      <button
                        onClick={() => openCategoryModal(category)}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteCategory(category.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t">
              <p className="text-xs text-gray-500">
                <strong>Tip:</strong> Categories help organize your pricebook items. Common examples include: Roofing, Siding, Windows, Solar Panels, Electrical, HVAC, Gutters, etc.
              </p>
            </div>
          </div>
        )}

        {/* Cost Settings Tab */}
        {activeTab === 'costs' && (
          <div className="space-y-6">
            {/* Material Costs */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Material / Product Costs</h2>
              <p className="text-sm text-gray-500 mb-6">Your cost for materials before labor</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-semibold text-gray-900">Roofing Materials</h3>
                      <p className="text-xs text-gray-500">Shingles, underlayment, nails, etc.</p>
                    </div>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.material_cost_per_square || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        material_cost_per_square: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-16 py-3 border border-gray-300 rounded-lg text-lg font-medium"
                      placeholder="85.00"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">/square</span>
                  </div>
                </div>

                <div className="p-5 bg-yellow-50 rounded-xl border border-yellow-100">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-10 h-10 bg-yellow-100 text-yellow-600 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-semibold text-gray-900">Solar Equipment</h3>
                      <p className="text-xs text-gray-500">Panels, inverters, racking</p>
                    </div>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.material_cost_per_watt || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        material_cost_per_watt: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-12 py-3 border border-gray-300 rounded-lg text-lg font-medium"
                      placeholder="1.50"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">/watt</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-Contractor Labor Rates */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center gap-3 mb-6">
                <span className="w-10 h-10 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Sub-Contractor Labor Rates</h2>
                  <p className="text-sm text-gray-500">What you pay sub-contractors for labor</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Install (per square)</label>
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
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                      placeholder="145.00" 
                    />
                  </div>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tear-off (per square)</label>
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
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                      placeholder="75.00" 
                    />
                  </div>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Dump Run (flat)</label>
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
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                      placeholder="150.00" 
                    />
                  </div>
                </div>
              </div>

              {/* Sub total cost calculation */}
              {(orgPricing.material_cost_per_square && orgPricing.sub_install_per_square) && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Total Sub Cost per Square (Material + Install):</span>
                    <span className="text-lg font-bold text-gray-900">
                      ${((orgPricing.material_cost_per_square || 0) + (orgPricing.sub_install_per_square || 0)).toFixed(2)}
                    </span>
                  </div>
                  {orgPricing.price_per_square_installed && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t">
                      <span className="text-sm font-medium text-gray-700">Gross Margin (Sub):</span>
                      <span className="text-lg font-bold text-green-600">
                        ${(orgPricing.price_per_square_installed - (orgPricing.material_cost_per_square || 0) - (orgPricing.sub_install_per_square || 0)).toFixed(2)}
                        <span className="text-sm font-normal text-gray-500 ml-2">
                          ({(((orgPricing.price_per_square_installed - (orgPricing.material_cost_per_square || 0) - (orgPricing.sub_install_per_square || 0)) / orgPricing.price_per_square_installed) * 100).toFixed(1)}%)
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* In-House Labor Rates */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 bg-green-100 text-green-600 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">In-House Labor Rates</h2>
                    <p className="text-sm text-gray-500">Your internal crew labor costs</p>
                  </div>
                </div>
                
                {/* Toggle for In-House */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <span className={`text-sm font-medium ${orgPricing.inhouse_enabled ? 'text-green-600' : 'text-gray-500'}`}>
                    {orgPricing.inhouse_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={orgPricing.inhouse_enabled || false}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        inhouse_enabled: e.target.checked 
                      }))}
                      className="sr-only"
                    />
                    <div className={`w-14 h-7 rounded-full transition-colors ${orgPricing.inhouse_enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`w-6 h-6 bg-white rounded-full shadow-md transform transition-transform mt-0.5 ${orgPricing.inhouse_enabled ? 'translate-x-7' : 'translate-x-0.5'}`} />
                    </div>
                  </div>
                </label>
              </div>

              {!orgPricing.inhouse_enabled ? (
                <div className="p-8 bg-gray-50 rounded-lg text-center">
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  <p className="text-gray-500 font-medium">In-House Labor is Disabled</p>
                  <p className="text-sm text-gray-400 mt-1">Enable to set rates for your internal installation crews</p>
                </div>
              ) : (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                    <p className="text-sm text-amber-800">
                      <strong>Important:</strong> Sub and in-house rates cannot be combined on the same work item. 
                      Use sub rates for subcontracted work (e.g., roofing) and in-house rates for internal crew work (e.g., siding).
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Install (per square)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input 
                          type="number"
                          step="0.01"
                          value={orgPricing.inhouse_install_per_square || ''}
                          onChange={(e) => setOrgPricing(prev => ({ 
                            ...prev, 
                            inhouse_install_per_square: e.target.value ? parseFloat(e.target.value) : null 
                          }))}
                          className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                          placeholder="95.00" 
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Per roofing square</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Tear-off (per square)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input 
                          type="number"
                          step="0.01"
                          value={orgPricing.inhouse_tearoff_per_square || ''}
                          onChange={(e) => setOrgPricing(prev => ({ 
                            ...prev, 
                            inhouse_tearoff_per_square: e.target.value ? parseFloat(e.target.value) : null 
                          }))}
                          className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                          placeholder="50.00" 
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Per roofing square</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hourly Rate</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input 
                          type="number"
                          step="0.01"
                          value={orgPricing.inhouse_hourly_rate || ''}
                          onChange={(e) => setOrgPricing(prev => ({ 
                            ...prev, 
                            inhouse_hourly_rate: e.target.value ? parseFloat(e.target.value) : null 
                          }))}
                          className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                          placeholder="45.00" 
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Per labor hour</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Solar (per watt)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input 
                          type="number"
                          step="0.01"
                          value={orgPricing.inhouse_solar_per_watt || ''}
                          onChange={(e) => setOrgPricing(prev => ({ 
                            ...prev, 
                            inhouse_solar_per_watt: e.target.value ? parseFloat(e.target.value) : null 
                          }))}
                          className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                          placeholder="0.35" 
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Per watt installed</p>
                    </div>
                  </div>

                  {/* In-house total cost calculation */}
                  {(orgPricing.material_cost_per_square && orgPricing.inhouse_install_per_square) && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Total In-House Cost per Square (Material + Install):</span>
                        <span className="text-lg font-bold text-gray-900">
                          ${((orgPricing.material_cost_per_square || 0) + (orgPricing.inhouse_install_per_square || 0)).toFixed(2)}
                        </span>
                      </div>
                      {orgPricing.price_per_square_installed && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t">
                          <span className="text-sm font-medium text-gray-700">Gross Margin (In-House):</span>
                          <span className="text-lg font-bold text-green-600">
                            ${(orgPricing.price_per_square_installed - (orgPricing.material_cost_per_square || 0) - (orgPricing.inhouse_install_per_square || 0)).toFixed(2)}
                            <span className="text-sm font-normal text-gray-500 ml-2">
                              ({(((orgPricing.price_per_square_installed - (orgPricing.material_cost_per_square || 0) - (orgPricing.inhouse_install_per_square || 0)) / orgPricing.price_per_square_installed) * 100).toFixed(1)}%)
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Comparison if both sub and in-house are set */}
                  {orgPricing.sub_install_per_square && orgPricing.inhouse_install_per_square && (
                    <div className="mt-4 p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                      <h4 className="text-sm font-semibold text-indigo-900 mb-2">Sub vs In-House Comparison (Install per Square)</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Sub Rate:</span>
                          <span className="font-bold text-gray-900 ml-2">${orgPricing.sub_install_per_square.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">In-House Rate:</span>
                          <span className="font-bold text-gray-900 ml-2">${orgPricing.inhouse_install_per_square.toFixed(2)}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-gray-600">Difference:</span>
                          <span className={`font-bold ml-2 ${orgPricing.sub_install_per_square > orgPricing.inhouse_install_per_square ? 'text-green-600' : 'text-red-600'}`}>
                            ${Math.abs(orgPricing.sub_install_per_square - orgPricing.inhouse_install_per_square).toFixed(2)} 
                            {orgPricing.sub_install_per_square > orgPricing.inhouse_install_per_square ? ' saved with in-house' : ' more with in-house'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Overhead & Operating Costs */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Overhead & Operating Costs</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">OPEX per Job</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input 
                      type="number" 
                      value={orgPricing.opex_per_job || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        opex_per_job: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                      placeholder="500.00" 
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Fixed overhead per job</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Dump Cost per Square</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input 
                      type="number" 
                      value={orgPricing.dump_cost_per_square || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        dump_cost_per_square: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" 
                      placeholder="25.00" 
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Disposal/dumpster cost</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Default Markup (%)</label>
                  <input 
                    type="number" 
                    value={orgPricing.default_markup_percent || ''}
                    onChange={(e) => setOrgPricing(prev => ({ 
                      ...prev, 
                      default_markup_percent: e.target.value ? parseFloat(e.target.value) : null 
                    }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg" 
                    placeholder="35" 
                  />
                  <p className="text-xs text-gray-500 mt-1">Applied to cost calculations</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveOrgPricing}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Cost Settings'}
              </button>
            </div>
          </div>
        )}

        {/* Labor Rates Tab */}
        {activeTab === 'labor' && (
          <div className="space-y-6">
            {/* Default Labor Rate with Unit Selection */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Default Labor Rate</h2>
              <p className="text-sm text-gray-500 mb-6">Set your primary labor rate and choose how it's calculated</p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Rate Type Selection */}
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rate Type
                  </label>
                  <div className="space-y-2">
                    {[
                      { value: 'hour', label: 'Per Hour', description: 'Time-based billing', icon: '⏱️' },
                      { value: 'square', label: 'Per Square', description: 'Roofing (100 sq ft)', icon: '🏠' },
                      { value: 'kw', label: 'Per kW', description: 'Solar installations', icon: '☀️' },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          orgPricing.labor_rate_type === option.value
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="labor_rate_type"
                          value={option.value}
                          checked={orgPricing.labor_rate_type === option.value}
                          onChange={(e) => setOrgPricing(prev => ({ 
                            ...prev, 
                            labor_rate_type: e.target.value as 'hour' | 'square' | 'kw'
                          }))}
                          className="sr-only"
                        />
                        <span className="text-xl">{option.icon}</span>
                        <div>
                          <p className="font-medium text-gray-900">{option.label}</p>
                          <p className="text-xs text-gray-500">{option.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Rate Value */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rate Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={orgPricing.labor_rate_value || ''}
                      onChange={(e) => setOrgPricing(prev => ({ 
                        ...prev, 
                        labor_rate_value: e.target.value ? parseFloat(e.target.value) : null 
                      }))}
                      className="w-full pl-10 pr-20 py-4 border border-gray-300 rounded-lg text-2xl font-medium"
                      placeholder={
                        orgPricing.labor_rate_type === 'hour' ? '75.00' :
                        orgPricing.labor_rate_type === 'square' ? '65.00' :
                        '0.15'
                      }
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                      {orgPricing.labor_rate_type === 'hour' && '/hour'}
                      {orgPricing.labor_rate_type === 'square' && '/square'}
                      {orgPricing.labor_rate_type === 'kw' && '/kW'}
                    </span>
                  </div>
                  
                  {/* Example calculations */}
                  {orgPricing.labor_rate_value && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-2">Example Calculations:</p>
                      {orgPricing.labor_rate_type === 'hour' && (
                        <div className="space-y-1 text-sm text-gray-600">
                          <p>8-hour day: <span className="font-medium text-gray-900">${(orgPricing.labor_rate_value * 8).toFixed(2)}</span></p>
                          <p>40-hour week: <span className="font-medium text-gray-900">${(orgPricing.labor_rate_value * 40).toFixed(2)}</span></p>
                        </div>
                      )}
                      {orgPricing.labor_rate_type === 'square' && (
                        <div className="space-y-1 text-sm text-gray-600">
                          <p>20-square job: <span className="font-medium text-gray-900">${(orgPricing.labor_rate_value * 20).toFixed(2)}</span></p>
                          <p>35-square job: <span className="font-medium text-gray-900">${(orgPricing.labor_rate_value * 35).toFixed(2)}</span></p>
                        </div>
                      )}
                      {orgPricing.labor_rate_type === 'kw' && (
                        <div className="space-y-1 text-sm text-gray-600">
                          <p>8 kW system: <span className="font-medium text-gray-900">${(orgPricing.labor_rate_value * 8000).toFixed(2)}</span></p>
                          <p>12 kW system: <span className="font-medium text-gray-900">${(orgPricing.labor_rate_value * 12000).toFixed(2)}</span></p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Task-Specific Labor Rates */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Task-Specific Labor Rates</h2>
              <p className="text-sm text-gray-500 mb-6">Override the default rate for specific task types</p>
              
              <div className="space-y-3">
                {[
                  { name: 'Roof Installation', unit: 'per square', placeholder: '65.00', unitType: 'square' },
                  { name: 'Tear-off', unit: 'per square', placeholder: '35.00', unitType: 'square' },
                  { name: 'Decking Replacement', unit: 'per sheet', placeholder: '25.00', unitType: 'each' },
                  { name: 'Flashing Install', unit: 'per linear foot', placeholder: '8.00', unitType: 'lf' },
                  { name: 'Skylight Install', unit: 'each', placeholder: '350.00', unitType: 'each' },
                  { name: 'Chimney Flashing', unit: 'each', placeholder: '275.00', unitType: 'each' },
                  { name: 'Solar Panel Install', unit: 'per kW', placeholder: '150.00', unitType: 'kw' },
                  { name: 'Electrical Work', unit: 'per hour', placeholder: '85.00', unitType: 'hour' },
                ].map((task) => (
                  <div key={task.name} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <span className="flex-1 text-sm font-medium text-gray-700">{task.name}</span>
                    <span className="text-xs text-gray-500 w-28 text-right">{task.unit}</span>
                    <div className="relative w-36">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder={task.placeholder}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Legacy Hourly Rate (for backward compatibility) */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Legacy Hourly Rate</h2>
              <p className="text-sm text-gray-500 mb-4">Standard hourly rate for miscellaneous work</p>
              
              <div className="max-w-xs">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={orgPricing.labor_rate_per_hour || ''}
                    onChange={(e) => setOrgPricing(prev => ({ 
                      ...prev, 
                      labor_rate_per_hour: e.target.value ? parseFloat(e.target.value) : null 
                    }))}
                    className="w-full pl-8 pr-16 py-3 border border-gray-300 rounded-lg"
                    placeholder="75.00"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">/hour</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveOrgPricing}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Labor Rates'}
              </button>
            </div>
          </div>
        )}

        {/* Item Modal */}
        {showItemModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingItem ? 'Edit Item' : 'Add Pricebook Item'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Item Name *</label>
                  <input
                    type="text"
                    value={itemForm.name}
                    onChange={(e) => setItemForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="e.g., Architectural Shingles Install"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                    <select
                      value={itemForm.category}
                      onChange={(e) => setItemForm(prev => ({ ...prev, category: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
                    >
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                    <select
                      value={itemForm.item_type}
                      onChange={(e) => setItemForm(prev => ({ ...prev, item_type: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
                    >
                      {itemTypeOptions.map(type => (
                        <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Unit</label>
                    <select
                      value={itemForm.unit}
                      onChange={(e) => setItemForm(prev => ({ ...prev, unit: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
                    >
                      {unitOptions.map(unit => (
                        <option key={unit.value} value={unit.value}>{unit.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Price *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={itemForm.unit_price}
                        onChange={(e) => setItemForm(prev => ({ ...prev, unit_price: e.target.value }))}
                        className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Cost</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={itemForm.cost_price}
                        onChange={(e) => setItemForm(prev => ({ ...prev, cost_price: e.target.value }))}
                        className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={itemForm.is_labor}
                      onChange={(e) => setItemForm(prev => ({ ...prev, is_labor: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Labor Item</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={itemForm.is_taxable}
                      onChange={(e) => setItemForm(prev => ({ ...prev, is_taxable: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Taxable</span>
                  </label>
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveItem}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pricebook Modal */}
        {showPricebookModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">Create Pricebook</h2>
              </div>
              <div className="p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Pricebook Name</label>
                <input
                  type="text"
                  value={pricebookName}
                  onChange={(e) => setPricebookName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="e.g., 2024 Standard Pricing"
                />
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowPricebookModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={createPricebook}
                  disabled={saving || !pricebookName.trim()}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Category Modal */}
        {showCategoryModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingCategory ? 'Edit Category' : 'Add Category'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Category Name</label>
                  <input
                    type="text"
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="e.g., Solar Panels, HVAC, Gutters"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {['blue', 'green', 'purple', 'orange', 'red', 'yellow', 'pink', 'teal', 'gray'].map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setCategoryForm(prev => ({ ...prev, color }))}
                        className={`w-8 h-8 rounded-full border-2 ${
                          categoryForm.color === color ? 'border-gray-900 ring-2 ring-offset-2 ring-gray-400' : 'border-transparent'
                        } ${
                          color === 'blue' ? 'bg-blue-500' :
                          color === 'green' ? 'bg-green-500' :
                          color === 'purple' ? 'bg-purple-500' :
                          color === 'orange' ? 'bg-orange-500' :
                          color === 'red' ? 'bg-red-500' :
                          color === 'yellow' ? 'bg-yellow-500' :
                          color === 'pink' ? 'bg-pink-500' :
                          color === 'teal' ? 'bg-teal-500' :
                          'bg-gray-500'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowCategoryModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCategory}
                  disabled={saving || !categoryForm.name.trim()}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingCategory ? 'Update' : 'Add Category'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
