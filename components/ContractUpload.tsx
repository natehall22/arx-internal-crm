'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface ContractUploadProps {
  opportunityId: string
}

export default function ContractUpload({ opportunityId }: ContractUploadProps) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setError('Please select a file')
      return
    }

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('signed_contract', file)

      const response = await fetch(`/api/opportunities/${opportunityId}/contract`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload contract')
      }

      setSuccess(true)
      
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      // Redirect to project if created
      if (data.projectId) {
        setTimeout(() => {
          router.push(`/projects/${data.projectId}`)
        }, 1500)
      } else {
        // Refresh the page to show updated status
        router.refresh()
      }
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload contract')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Signed Contract</h2>
      <p className="text-sm text-gray-500 mb-4">
        Upload the signed contract to convert this opportunity into a project.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">
            Contract uploaded successfully! Redirecting to project...
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <input 
          type="file" 
          ref={fileInputRef}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          required 
          disabled={uploading}
          className="text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {uploading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Uploading...
            </>
          ) : (
            'Upload Signed Contract'
          )}
        </button>
      </form>

      <div className="mt-4 pt-4 border-t">
        <p className="text-xs text-gray-400 mb-2">Or use e-signature:</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/admin/integrations#esign"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100"
          >
            <span>✍️</span>
            Connect DocuSign, PandaDoc, or Dropbox Sign
          </a>
        </div>
      </div>
    </div>
  )
}
