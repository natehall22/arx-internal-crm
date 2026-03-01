'use client'

import { useState } from 'react'
import Link from 'next/link'
import LinkCreateCustomerModal from './LinkCreateCustomerModal'

interface Props {
  sourceType: 'opportunity' | 'project' | 'job'
  sourceId: string
  className?: string
  currentCustomerId?: string | null
  currentCustomerName?: string | null
}

export default function LinkCustomerButton({ 
  sourceType, 
  sourceId, 
  className = '',
  currentCustomerId,
  currentCustomerName,
}: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // If customer is already linked, show the linked customer with change option
  if (currentCustomerId) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Link
          href={`/customers/${currentCustomerId}`}
          className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
        >
          {currentCustomerName || 'View customer'}
        </Link>
        <button
          onClick={() => setIsModalOpen(true)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          (change)
        </button>
        <LinkCreateCustomerModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          preselectedSource={{ type: sourceType, id: sourceId }}
        />
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`text-sm text-indigo-600 hover:text-indigo-800 font-medium ${className}`}
      >
        Link Customer
      </button>

      <LinkCreateCustomerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        preselectedSource={{ type: sourceType, id: sourceId }}
      />
    </>
  )
}
