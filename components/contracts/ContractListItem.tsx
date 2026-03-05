'use client'

interface ContractListItemProps {
  contract: {
    id: string
    status: string
    signing_token: string
    customer_signed_at: string | null
    pdf_url: string | null
    created_at: string
  }
}

export default function ContractListItem({ contract }: ContractListItemProps) {
  const handleCopyLink = () => {
    const url = `${window.location.origin}/contracts/sign/${contract.signing_token}`
    navigator.clipboard.writeText(url)
    alert('Signing link copied to clipboard!')
  }

  const isCompleted = contract.status === 'completed'

  return (
    <div className={`p-4 border rounded-lg ${isCompleted ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
            contract.status === 'completed' ? 'bg-green-100 text-green-700' :
            contract.status === 'pending_customer' ? 'bg-amber-100 text-amber-700' :
            contract.status === 'voided' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {contract.status === 'completed' ? 'Signed' :
             contract.status === 'pending_customer' ? 'Awaiting Customer' :
             contract.status === 'voided' ? 'Voided' : contract.status}
          </span>
          <span className="text-sm text-gray-500">
            Created {new Date(contract.created_at).toLocaleDateString()}
          </span>
          {contract.customer_signed_at && (
            <span className="text-sm text-green-600">
              Signed {new Date(contract.customer_signed_at).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {contract.status === 'pending_customer' && (
            <button
              onClick={handleCopyLink}
              className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              Copy Link
            </button>
          )}
          {isCompleted && contract.pdf_url ? (
            <a
              href={contract.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Installation Agreement
            </a>
          ) : isCompleted && !contract.pdf_url ? (
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              PDF generating...
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
