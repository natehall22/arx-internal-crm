'use client'

import EditCustomerButton from '@/components/customers/EditCustomerSheet'
import PhoneLink from '@/components/PhoneLink'

interface Customer {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  address_text: string | null
}

interface CustomerInfoCardProps {
  customer: Customer
  /** Show the Edit button. The API still decides (PATCH /api/customers/[id]); the Customer File hides it for people who may not edit. */
  canEdit?: boolean
  /** Call / Text / Email buttons under the details (the Customer File passes them when there is no deal header to carry them). */
  actions?: React.ReactNode
}

export default function CustomerInfoCard({ customer, canEdit = true, actions }: CustomerInfoCardProps) {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {customer.name || 'Unnamed customer'}
        </h2>
        {canEdit && <EditCustomerButton customer={customer} className="inline-flex min-h-tap items-center text-sm text-indigo-600 hover:text-indigo-800 font-medium" />}
      </div>
      
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
        <div>
          <span className="font-medium">Email:</span>{' '}
          {customer.email && customer.email !== 'none@none.com' ? (
            <a href={`mailto:${customer.email}`} className="inline-flex min-h-tap items-center text-indigo-600 hover:text-indigo-800">
              {customer.email}
            </a>
          ) : (
            <span className="text-gray-600">No email</span>
          )}
        </div>
        <div>
          <span className="font-medium">Phone:</span>{' '}
          {customer.phone ? (
            <PhoneLink value={customer.phone} className="inline-flex min-h-tap items-center text-indigo-600 hover:text-indigo-800" />
          ) : (
            <span className="text-gray-600">No phone</span>
          )}
        </div>
        <div className="md:col-span-2">
          <span className="font-medium">Address:</span>{' '}
          {customer.address_text || <span className="text-gray-600">No address</span>}
        </div>
      </div>
      {actions ? <div className="mt-4">{actions}</div> : null}
    </div>
  )
}
