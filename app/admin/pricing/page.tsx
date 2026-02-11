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
}

interface CustomCategory {
  id: string
  name: string
  color?: string
}

type Tab = 'overview' | 'pricebook' | 'costs' | 'labor' | 'categories'

const defaultCategories: CustomCategory[] = [
  { id: 'roofing', name: 'Roofing', color: 'blue' },
  { id: 'siding', name: 'Siding', color: 'green' },
  { id: 'windows', name: 'Windows', color: 'purple' },
  { id: 'addons', name: 'Add-ons', color: 'orange' },
]
const itemTypeOptions = ['install', 'tearoff', 'material', 'addon', 'disposal', 'cleanup', 'dumpster', 'decking', 'flashing']
const unitOptions = ['square', 'each', 'lf', 'sheet', 'job', 'hour', 'watt']

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
  })
  
  // Categories
  const [categories, setCategories] = useState<CustomCategory[]>(defaultCategories)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<CustomCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', color: 'blue' })
  
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
        <div className="flex gap-1 mb-6 border-b">
          {[
            { id: 'overview', label: 'Pricing Overview' },
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Labor Rate ($/hour)
                    </label>
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
                        className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                        placeholder="75.00"
                      />
                    </div>
                  </div>
                </div>
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
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Cost Configuration</h2>
            
            <div className="space-y-8">
              {/* Material Costs */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                  <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </span>
                  Material Costs
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-10">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Shingles (per square)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input type="number" className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="85.00" />
                    </div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Underlayment (per roll)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input type="number" className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="45.00" />
                    </div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Ridge Cap (per bundle)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input type="number" className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="55.00" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Labor Costs */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                  <span className="w-8 h-8 bg-green-100 text-green-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </span>
                  Labor Costs (Sub Rates)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-10">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Install (per square)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input type="number" className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="65.00" />
                    </div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Tear-off (per square)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input type="number" className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="35.00" />
                    </div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Dump Run (flat)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input type="number" className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="150.00" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Overhead */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                  <span className="w-8 h-8 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </span>
                  Overhead & Operating Costs
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-10">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">OPEX per Job</label>
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
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Insurance (% of job)</label>
                    <input type="number" className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="3.5" />
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <label className="block text-sm text-gray-600 mb-1">Warranty Reserve (%)</label>
                    <input type="number" className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="2.0" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
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
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Labor Rate Configuration</h2>
            
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Standard Labor Rate ($/hour)
                  </label>
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
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg"
                      placeholder="75.00"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-sm font-medium text-gray-700 mb-4">Labor Rates by Task Type</h3>
                <div className="space-y-3">
                  {[
                    { name: 'Roof Installation', unit: 'per square', placeholder: '65.00' },
                    { name: 'Tear-off', unit: 'per square', placeholder: '35.00' },
                    { name: 'Decking Replacement', unit: 'per sheet', placeholder: '25.00' },
                    { name: 'Flashing Install', unit: 'per linear foot', placeholder: '8.00' },
                    { name: 'Skylight Install', unit: 'each', placeholder: '350.00' },
                    { name: 'Chimney Flashing', unit: 'each', placeholder: '275.00' },
                  ].map((task) => (
                    <div key={task.name} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      <span className="flex-1 text-sm text-gray-700">{task.name}</span>
                      <span className="text-xs text-gray-500 w-24">{task.unit}</span>
                      <div className="relative w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input
                          type="number"
                          className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder={task.placeholder}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={saveOrgPricing}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Labor Rates'}
                </button>
              </div>
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
                        <option key={unit} value={unit}>{unit}</option>
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
