'use client'

import { useState } from 'react'
import ContractModal from './ContractModal'

interface CreateContractButtonProps {
  opportunityId: string
  proposalId?: string
  customerName: string
  customerEmail: string
  customerPhone: string
  projectAddress: string
  projectCost: number
  totalSquares?: number
  scopeOfWork?: string
}

export default function CreateContractButton({
  opportunityId,
  proposalId,
  customerName,
  customerEmail,
  customerPhone,
  projectAddress,
  projectCost,
  totalSquares,
  scopeOfWork,
}: CreateContractButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Create Contract
      </button>

      <ContractModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        opportunityId={opportunityId}
        proposalId={proposalId}
        customerName={customerName}
        customerEmail={customerEmail}
        customerPhone={customerPhone}
        projectAddress={projectAddress}
        projectCost={projectCost}
        totalSquares={totalSquares}
        scopeOfWork={scopeOfWork}
      />
    </>
  )
}
