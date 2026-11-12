'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { clientLinkBase } from '@/lib/app-url'
import { toast } from '@/components/ui/toast'
import { filesDocHref } from '@/lib/files/files-object'
import SigningStatus from '@/components/signing/SigningStatus'

interface ContractListItemProps {
  contract: {
    id: string
    status: string
    /** Old links keep their plaintext token here; links made since hashing have none (see /api/signing-link). */
    signing_token?: string | null
    customer_signed_at: string | null
    pdf_url: string | null
    created_at: string
    agreement_type?: 'installation' | 'contingency' | 'repair' | null
  }
}

export default function ContractListItem({ contract }: ContractListItemProps) {
  const router = useRouter()
  const [pdfBusy, setPdfBusy] = useState(false)

  // A signed contract whose PDF was never stored: make it now from the signature already on file.
  const handleGeneratePdf = async () => {
    setPdfBusy(true)
    try {
      const res = await fetch(`/api/contracts/${contract.id}/regenerate-pdf`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to generate PDF')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate PDF')
    } finally {
      setPdfBusy(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      let path = contract.signing_token ? `/contracts/sign/${contract.signing_token}` : null
      if (!path) {
        const res = await fetch(`/api/signing-link/contract/${contract.id}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok || typeof data.path !== 'string') throw new Error('This link is no longer available')
        path = data.path
      }
      await navigator.clipboard.writeText(`${clientLinkBase()}${path}`)
      toast.success('Signing link copied to clipboard!')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not copy the link')
    }
  }

  const isCompleted = contract.status === 'completed'
  const pdfHref = filesDocHref(null, contract.pdf_url) ?? undefined
  const label =
    contract.agreement_type === 'contingency'
      ? 'Insurance Contingency'
      : contract.agreement_type === 'repair'
        ? 'Repair Agreement'
        : 'Installation Agreement'

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
            {label} created {new Date(contract.created_at).toLocaleDateString()}
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
              href={pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View {label}
            </a>
          ) : contract.status === 'voided' && contract.customer_signed_at && contract.pdf_url ? (
            // Superseded by a later signature — kept (never deleted) so the executed copy stays retrievable.
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#2c2c2a] underline hover:no-underline"
            >
              View signed copy (superseded)
            </a>
          ) : isCompleted && !contract.pdf_url ? (
            <button
              type="button"
              onClick={handleGeneratePdf}
              disabled={pdfBusy}
              className="inline-flex min-h-[44px] items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60"
            >
              {pdfBusy ? 'Generating…' : 'Generate PDF'}
            </button>
          ) : null}
        </div>
      </div>
      {contract.status !== 'draft' && <SigningStatus kind="contract" id={contract.id} />}
    </div>
  )
}
