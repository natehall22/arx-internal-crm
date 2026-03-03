'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Customer {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  address_text: string | null
}

interface CustomerInfoCardProps {
  customer: Customer
}

export default function CustomerInfoCard({ customer }: CustomerInfoCardProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    name: customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    address_text: customer.address_text || '',
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        setEditing(false)
        router.refresh()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to save customer')
      }
    } catch (error) {
      console.error('Error saving customer:', error)
      alert('Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      address_text: customer.address_text || '',
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit Customer Info</h2>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              placeholder="Customer name"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                placeholder="email@example.com"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address_text}
              onChange={(e) => setFormData(prev => ({ ...prev, address_text: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              placeholder="123 Main St, City, State ZIP"
            />
          </div>
          
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {customer.name || 'Unnamed customer'}
        </h2>
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
        >
          Edit
        </button>
      </div>
      
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
        <div>
          <span className="font-medium">Email:</span>{' '}
          {customer.email && customer.email !== 'none@none.com' ? (
            <a href={`mailto:${customer.email}`} className="text-indigo-600 hover:text-indigo-800">
              {customer.email}
            </a>
          ) : (
            <span className="text-gray-400">No email</span>
          )}
        </div>
        <div>
          <span className="font-medium">Phone:</span>{' '}
          {customer.phone ? (
            <a href={`tel:${customer.phone}`} className="text-indigo-600 hover:text-indigo-800">
              {customer.phone}
            </a>
          ) : (
            <span className="text-gray-400">No phone</span>
          )}
        </div>
        <div className="md:col-span-2">
          <span className="font-medium">Address:</span>{' '}
          {customer.address_text || <span className="text-gray-400">No address</span>}
        </div>
      </div>
    </div>
  )
}
