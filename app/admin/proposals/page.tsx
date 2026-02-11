'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface PricebookItem {
  id: string
  name: string
  category: string
  unit: string
  unit_price: number
  visibility: string
  is_adder: boolean
  adder_category: string | null
  price_type: 'fixed' | 'percentage' | null
  is_commissionable: boolean
  commission_percent: number | null  // What % of the adder is commissionable (0-100)
  commission_cap: number | null      // Max commissionable amount per instance
  active: boolean
}

interface ProposalTemplate {
  id: string
  name: string
  description: string
  is_default: boolean
  accent_color: string
  active: boolean
}

type Tab = 'pricing' | 'adders' | 'templates'

const visibilityOptions = [
  { value: 'admin_only', label: 'Admin Only', description: 'Only admins can see pricing' },
  { value: 'managers', label: 'Managers', description: 'Admins and managers' },
  { value: 'sales_reps', label: 'Sales Reps', description: 'All sales roles' },
  { value: 'all', label: 'Everyone', description: 'All users' },
]

const adderCategories = [
  'Ventilation',
  'Gutters',
  'Skylights',
  'Chimney',
  'Decking',
  'Flashing',
  'Other',
]

export default function AdminProposalsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('pricing')
  const [pricebookItems, setPricebookItems] = useState<PricebookItem[]>([])
  const [templates, setTemplates] = useState<ProposalTemplate[]>([])
  const [saving, setSaving] = useState(false)
  
  // Modal states
  const [showAddAdder, setShowAddAdder] = useState(false)
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ProposalTemplate | null>(null)
  
  // Form states
  const [adderForm, setAdderForm] = useState({
    name: '',
    category: 'Other',
    unit: 'each',
    unit_price: '',
    adder_category: 'Other',
    price_type: 'fixed' as 'fixed' | 'percentage',
    is_commissionable: false,
    commission_percent: '100',  // Default 100% if commissionable
    commission_cap: '',         // No cap by default
  })
  
  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
    accent_color: '#4f46e5',
    default_scope_of_work: '',
    default_warranty_info: '',
    default_terms_conditions: '',
    is_default: false,
  })

  const supabase = createClientBrowser()

  useEffect(() => {
    checkAccess()
  }, [])

  const checkAccess = async () => {
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

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      router.push('/dashboard')
      return
    }

    await loadData(profile.org_id)
    setLoading(false)
  }

  const loadData = async (orgId: string) => {
    // Load pricebook items
    const { data: items } = await supabase
      .from('pricebook_items')
      .select('*')
      .eq('org_id', orgId)
      .order('category')
      .order('name')

    setPricebookItems(items || [])

    // Load templates
    const { data: templateData } = await supabase
      .from('proposal_templates')
      .select('*')
      .eq('org_id', orgId)
      .order('name')

    setTemplates(templateData || [])
  }

  const updateItemVisibility = async (itemId: string, visibility: string) => {
    setSaving(true)
    await supabase
      .from('pricebook_items')
      .update({ visibility })
      .eq('id', itemId)

    setPricebookItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, visibility } : item
    ))
    setSaving(false)
  }

  const toggleAdder = async (itemId: string, isAdder: boolean) => {
    setSaving(true)
    await supabase
      .from('pricebook_items')
      .update({ is_adder: isAdder })
      .eq('id', itemId)

    setPricebookItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, is_adder: isAdder } : item
    ))
    setSaving(false)
  }

  const saveAdder = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) return

    setSaving(true)

    // Get default pricebook
    const { data: pricebook } = await supabase
      .from('pricebooks')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('is_default', true)
      .single()

    await supabase.from('pricebook_items').insert({
      org_id: profile.org_id,
      pricebook_id: pricebook?.id,
      name: adderForm.name,
      category: adderForm.category,
      unit: adderForm.price_type === 'percentage' ? 'percent' : adderForm.unit,
      unit_price: parseFloat(adderForm.unit_price) || 0,
      is_adder: true,
      adder_category: adderForm.adder_category,
      price_type: adderForm.price_type,
      is_commissionable: adderForm.is_commissionable,
      commission_percent: adderForm.is_commissionable ? (parseFloat(adderForm.commission_percent) || 100) : null,
      commission_cap: adderForm.is_commissionable && adderForm.commission_cap ? parseFloat(adderForm.commission_cap) : null,
      visibility: 'sales_reps',
      active: true,
    })

    setShowAddAdder(false)
    setAdderForm({
      name: '',
      category: 'Other',
      unit: 'each',
      unit_price: '',
      adder_category: 'Other',
      price_type: 'fixed',
      is_commissionable: false,
      commission_percent: '100',
      commission_cap: '',
    })
    
    await loadData(profile.org_id)
    setSaving(false)
  }

  const saveTemplate = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) return

    setSaving(true)

    const templateData = {
      org_id: profile.org_id,
      name: templateForm.name,
      description: templateForm.description,
      accent_color: templateForm.accent_color,
      default_scope_of_work: templateForm.default_scope_of_work,
      default_warranty_info: templateForm.default_warranty_info,
      default_terms_conditions: templateForm.default_terms_conditions,
      is_default: templateForm.is_default,
      active: true,
    }

    if (editingTemplate) {
      await supabase
        .from('proposal_templates')
        .update(templateData)
        .eq('id', editingTemplate.id)
    } else {
      await supabase.from('proposal_templates').insert(templateData)
    }

    // If setting as default, unset others
    if (templateForm.is_default) {
      await supabase
        .from('proposal_templates')
        .update({ is_default: false })
        .eq('org_id', profile.org_id)
        .neq('id', editingTemplate?.id || '')
    }

    setShowAddTemplate(false)
    setEditingTemplate(null)
    setTemplateForm({
      name: '',
      description: '',
      accent_color: '#4f46e5',
      default_scope_of_work: '',
      default_warranty_info: '',
      default_terms_conditions: '',
      is_default: false,
    })

    await loadData(profile.org_id)
    setSaving(false)
  }

  const deleteAdder = async (id: string) => {
    if (!confirm('Delete this adder?')) return
    
    await supabase.from('pricebook_items').delete().eq('id', id)
    setPricebookItems(prev => prev.filter(item => item.id !== id))
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return
    
    await supabase.from('proposal_templates').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const openEditTemplate = (template: ProposalTemplate) => {
    setEditingTemplate(template)
    setTemplateForm({
      name: template.name,
      description: template.description || '',
      accent_color: template.accent_color || '#4f46e5',
      default_scope_of_work: '',
      default_warranty_info: '',
      default_terms_conditions: '',
      is_default: template.is_default,
    })
    setShowAddTemplate(true)
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
            <h1 className="text-3xl font-bold text-gray-900">Proposal Settings</h1>
            <p className="text-gray-500 mt-1">Manage pricing visibility, adders, and templates</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b">
          {[
            { id: 'pricing', label: 'Pricing Visibility' },
            { id: 'adders', label: 'Adders' },
            { id: 'templates', label: 'PDF Templates' },
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

        {/* Pricing Visibility Tab */}
        {activeTab === 'pricing' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 bg-amber-50 border-b border-amber-100">
              <p className="text-sm text-amber-800">
                <strong>Note:</strong> Control which roles can see pricing details. Customer-facing proposals only show the total, never line item pricing.
              </p>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visibility</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Is Adder</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pricebookItems.filter(i => i.active).map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4 text-gray-500">{item.category}</td>
                    <td className="px-6 py-4 text-right text-gray-900">${item.unit_price.toFixed(2)}/{item.unit}</td>
                    <td className="px-6 py-4">
                      <select
                        value={item.visibility || 'sales_reps'}
                        onChange={(e) => updateItemVisibility(item.id, e.target.value)}
                        className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
                      >
                        {visibilityOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={item.is_adder}
                        onChange={(e) => toggleAdder(item.id, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Adders Tab */}
        {activeTab === 'adders' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowAddAdder(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
              >
                + Add New Adder
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="p-4 bg-blue-50 border-b border-blue-100">
                <p className="text-sm text-blue-800">
                  Adders are add-on items that sales reps can quickly add to proposals. They appear in a separate section for easy selection.
                </p>
              </div>
              
              {pricebookItems.filter(i => i.is_adder && i.active).length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-gray-500 mb-4">No adders configured yet</p>
                  <button
                    onClick={() => setShowAddAdder(true)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                  >
                    Create First Adder
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
                  {pricebookItems.filter(i => i.is_adder && i.active).map((item) => (
                    <div key={item.id} className="border rounded-xl p-4 hover:border-indigo-200">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium text-gray-900">{item.name}</h3>
                          <p className="text-sm text-gray-500">{item.adder_category || item.category}</p>
                        </div>
                        <button
                          onClick={() => deleteAdder(item.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      {item.price_type === 'percentage' ? (
                        <p className="text-lg font-bold text-indigo-600 mt-2">
                          {item.unit_price}% <span className="text-sm font-normal text-gray-400">of total</span>
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-indigo-600 mt-2">
                          ${item.unit_price.toFixed(2)} <span className="text-sm font-normal text-gray-400">per {item.unit}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.price_type === 'percentage' && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                            Percentage-based
                          </span>
                        )}
                        {item.is_commissionable ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                            Commissionable
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">
                            Non-commissionable
                          </span>
                        )}
                      </div>
                      {/* Commission Details */}
                      {item.is_commissionable && (item.commission_percent !== 100 || item.commission_cap) && (
                        <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-600">
                          {item.commission_percent !== null && item.commission_percent !== 100 && (
                            <p>Rep earns on {item.commission_percent}% of value</p>
                          )}
                          {item.commission_cap && (
                            <p>Max commissionable: ${item.commission_cap.toLocaleString()}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => {
                  setEditingTemplate(null)
                  setTemplateForm({
                    name: '',
                    description: '',
                    accent_color: '#4f46e5',
                    default_scope_of_work: '',
                    default_warranty_info: '',
                    default_terms_conditions: '',
                    is_default: false,
                  })
                  setShowAddTemplate(true)
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
              >
                + Create Template
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {templates.map((template) => (
                <div key={template.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div 
                    className="h-24 flex items-center justify-center text-white font-bold text-xl"
                    style={{ backgroundColor: template.accent_color || '#4f46e5' }}
                  >
                    {template.name}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-gray-900">{template.name}</h3>
                      {template.is_default && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Default</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mb-4">{template.description || 'No description'}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditTemplate(template)}
                        className="flex-1 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteTemplate(template.id)}
                        className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {templates.length === 0 && (
                <div className="col-span-full bg-white rounded-xl shadow-sm border p-12 text-center">
                  <p className="text-gray-500 mb-4">No templates created yet</p>
                  <button
                    onClick={() => setShowAddTemplate(true)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                  >
                    Create First Template
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add Adder Modal */}
        {showAddAdder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">Add New Adder</h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                  <input
                    type="text"
                    value={adderForm.name}
                    onChange={(e) => setAdderForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Ridge Vent Installation"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                  <select
                    value={adderForm.adder_category}
                    onChange={(e) => setAdderForm(prev => ({ ...prev, adder_category: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    {adderCategories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {/* Price Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Price Type</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="price_type"
                        value="fixed"
                        checked={adderForm.price_type === 'fixed'}
                        onChange={() => setAdderForm(prev => ({ ...prev, price_type: 'fixed' }))}
                        className="w-4 h-4 text-indigo-600 border-gray-300"
                      />
                      <span className="text-sm text-gray-700">Fixed Amount ($)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="price_type"
                        value="percentage"
                        checked={adderForm.price_type === 'percentage'}
                        onChange={() => setAdderForm(prev => ({ ...prev, price_type: 'percentage' }))}
                        className="w-4 h-4 text-indigo-600 border-gray-300"
                      />
                      <span className="text-sm text-gray-700">% of Total Price</span>
                    </label>
                  </div>
                </div>

                {adderForm.price_type === 'fixed' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Price ($)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={adderForm.unit_price}
                          onChange={(e) => setAdderForm(prev => ({ ...prev, unit_price: e.target.value }))}
                          className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                          placeholder="250.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Unit</label>
                      <select
                        value={adderForm.unit}
                        onChange={(e) => setAdderForm(prev => ({ ...prev, unit: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="each">Each</option>
                        <option value="lf">Linear Foot</option>
                        <option value="square">Square</option>
                        <option value="job">Per Job</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Percentage of Total (%)</label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={adderForm.unit_price}
                        onChange={(e) => setAdderForm(prev => ({ ...prev, unit_price: e.target.value }))}
                        className="w-full px-4 py-2 pr-8 border border-gray-300 rounded-lg"
                        placeholder="5"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      This adder will be calculated as a percentage of the proposal subtotal
                    </p>
                  </div>
                )}

                {/* Commissionable Toggle */}
                <div className="pt-2 border-t">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adderForm.is_commissionable}
                      onChange={(e) => setAdderForm(prev => ({ ...prev, is_commissionable: e.target.checked }))}
                      className="w-4 h-4 mt-0.5 rounded border-gray-300 text-indigo-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Commissionable</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Include this adder in commission calculations. Leave unchecked for cost-only items like dumpsters, permits, etc.
                      </p>
                    </div>
                  </label>

                  {/* Commission Settings - shown when commissionable */}
                  {adderForm.is_commissionable && (
                    <div className="mt-4 ml-7 p-4 bg-green-50 rounded-lg space-y-4">
                      <h4 className="text-sm font-medium text-green-800">Commission Settings</h4>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Commission Percentage
                        </label>
                        <div className="relative w-32">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={adderForm.commission_percent}
                            onChange={(e) => setAdderForm(prev => ({ ...prev, commission_percent: e.target.value }))}
                            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm"
                            placeholder="100"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          What percentage of this adder counts toward commission (e.g., 50% means rep earns on half the value)
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Commission Cap (Optional)
                        </label>
                        <div className="relative w-40">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={adderForm.commission_cap}
                            onChange={(e) => setAdderForm(prev => ({ ...prev, commission_cap: e.target.value }))}
                            className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                            placeholder="No cap"
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Maximum amount of this adder that counts toward commission. Leave empty for no cap.
                        </p>
                      </div>

                      {/* Example calculation */}
                      {(adderForm.unit_price && (adderForm.commission_percent !== '100' || adderForm.commission_cap)) && (
                        <div className="p-3 bg-white rounded-lg border border-green-200">
                          <p className="text-xs font-medium text-gray-700 mb-1">Example:</p>
                          <p className="text-xs text-gray-600">
                            {(() => {
                              const price = parseFloat(adderForm.unit_price) || 0
                              const percent = parseFloat(adderForm.commission_percent) || 100
                              const cap = adderForm.commission_cap ? parseFloat(adderForm.commission_cap) : null
                              
                              let commissionable = price * (percent / 100)
                              if (cap && commissionable > cap) {
                                commissionable = cap
                              }
                              
                              return (
                                <>
                                  If rep adds ${price.toLocaleString()}: 
                                  {cap && price * (percent / 100) > cap ? (
                                    <> min(${(price * percent / 100).toLocaleString()}, ${cap.toLocaleString()}) = </>
                                  ) : (
                                    <> ${price.toLocaleString()} × {percent}% = </>
                                  )}
                                  <span className="font-medium text-green-700">
                                    ${commissionable.toLocaleString()} commissionable
                                  </span>
                                </>
                              )
                            })()}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowAddAdder(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAdder}
                  disabled={saving || !adderForm.name || !adderForm.unit_price}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Add Adder'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add/Edit Template Modal */}
        {showAddTemplate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingTemplate ? 'Edit Template' : 'Create Template'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Template Name</label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Standard Proposal"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Default template for residential roofing"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Accent Color</label>
                  <div className="flex gap-3">
                    {['#4f46e5', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#000000'].map((color) => (
                      <button
                        key={color}
                        onClick={() => setTemplateForm(prev => ({ ...prev, accent_color: color }))}
                        className={`w-10 h-10 rounded-full border-2 ${templateForm.accent_color === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Default Scope of Work</label>
                  <textarea
                    value={templateForm.default_scope_of_work}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, default_scope_of_work: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="Complete tear-off and replacement of existing roofing system..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Default Warranty Info</label>
                  <textarea
                    value={templateForm.default_warranty_info}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, default_warranty_info: e.target.value }))}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="10-year workmanship warranty..."
                  />
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={templateForm.is_default}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">Set as default template</span>
                </label>
              </div>
              <div className="p-6 border-t flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowAddTemplate(false)
                    setEditingTemplate(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTemplate}
                  disabled={saving || !templateForm.name}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
