'use client'

import { useState } from 'react'
import LinkCreateCustomerModal from './LinkCreateCustomerModal'

interface Props {
  sourceType: 'opportunity' | 'project' | 'job'
  sourceId: string
  className?: string
}

export default function LinkCustomerButton({ sourceType, sourceId, className = '' }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false)

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
