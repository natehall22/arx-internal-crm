'use client'

interface InstallationAgreementLinkProps {
  pdfUrl: string | null
  status: string
  className?: string
}

export default function InstallationAgreementLink({ 
  pdfUrl, 
  status,
  className = ''
}: InstallationAgreementLinkProps) {
  if (status !== 'completed') {
    return null
  }

  if (!pdfUrl) {
    return (
      <div className={`flex items-center gap-2 text-sm text-gray-500 ${className}`}>
        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        PDF generating...
      </div>
    )
  }

  return (
    <a
      href={pdfUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      View Installation Agreement
    </a>
  )
}
