'use client'

import { useState, useEffect, useRef } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

interface JobFile {
  id: string
  file_type: string
  file_name: string
  file_size: number
  version: number
  is_signed: boolean
  signed_at: string | null
  notes: string | null
  created_at: string
  signed_url: string | null
  created_by_user?: { full_name: string }
  signed_by_user?: { full_name: string }
}

interface Props {
  jobId: string
  estimateId?: string
  onFileGenerated?: (file: JobFile) => void
}

const fileTypeLabels: Record<string, string> = {
  proposal: 'Proposal',
  contract: 'Contract',
  change_order: 'Change Order',
  invoice: 'Invoice',
  permit: 'Permit',
  inspection_report: 'Inspection Report',
  warranty: 'Warranty',
  other: 'Other',
}

const fileTypeIcons: Record<string, string> = {
  proposal: '📄',
  contract: '📝',
  change_order: '🔄',
  invoice: '💰',
  permit: '📋',
  inspection_report: '🔍',
  warranty: '🛡️',
  other: '📎',
}

export default function JobFilesPanel({ jobId, estimateId, onFileGenerated }: Props) {
  const [files, setFiles] = useState<JobFile[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadType, setUploadType] = useState('other')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadFiles()
  }, [jobId])

  const loadFiles = async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/files`)
      const data = await response.json()
      if (data.files) {
        setFiles(data.files)
      }
    } catch (error) {
      console.error('Error loading files:', error)
    } finally {
      setLoading(false)
    }
  }

  const generatePdf = async (type: 'proposal' | 'contract' | 'change_order') => {
    setGenerating(type)

    try {
      // Get PDF HTML from server
      const response = await fetch(`/api/jobs/${jobId}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, estimate_id: estimateId }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error)

      // Generate PDF on client using html2pdf or similar
      // For now, open HTML in new window for printing
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(data.html)
        printWindow.document.close()

        // Convert to PDF using browser print
        // In production, you'd use a library like html2pdf.js or jsPDF
        setTimeout(() => {
          printWindow.print()
        }, 500)
      }

      // Create file record (without actual PDF upload for now)
      const supabase = createClientBrowser()
      const { data: { user } } = await supabase.auth.getUser()
      const { data: profile } = await supabase
        .from('users')
        .select('org_id')
        .eq('id', user?.id)
        .single()

      if (profile) {
        // Save metadata
        const fileResponse = await fetch(`/api/jobs/${jobId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_type: type,
            file_name: data.file_name,
            storage_key: data.storage_key,
            notes: `Generated on ${new Date().toLocaleDateString()}`,
          }),
        })

        const fileData = await fileResponse.json()
        if (fileData.file) {
          setFiles([fileData.file, ...files])
          onFileGenerated?.(fileData.file)
        }
      }
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Failed to generate PDF')
    } finally {
      setGenerating(null)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('file_type', uploadType)
      formData.append('file_name', file.name)

      const response = await fetch(`/api/jobs/${jobId}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error)

      setFiles([data.file, ...files])
      setShowUploadModal(false)
      setUploadType('other')
    } catch (error) {
      console.error('Error uploading file:', error)
      alert('Failed to upload file')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const openFile = (file: JobFile) => {
    if (file.signed_url) {
      window.open(file.signed_url, '_blank')
    }
  }

  const deleteFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return

    try {
      const response = await fetch(`/api/jobs/${jobId}/files/${fileId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setFiles(files.filter(f => f.id !== fileId))
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete file')
      }
    } catch (error) {
      console.error('Error deleting file:', error)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Group files by type
  const groupedFiles = files.reduce((acc, file) => {
    if (!acc[file.file_type]) acc[file.file_type] = []
    acc[file.file_type].push(file)
    return acc
  }, {} as Record<string, JobFile[]>)

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Documents</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            Upload
          </button>
        </div>
      </div>

      {/* Quick Generate Buttons */}
      <div className="px-4 py-3 border-b bg-gray-50">
        <p className="text-xs text-gray-500 mb-2">Quick Generate</p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => generatePdf('proposal')}
            disabled={generating !== null}
            className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating === 'proposal' ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <span>📄</span>
            )}
            Proposal
          </button>
          <button
            onClick={() => generatePdf('contract')}
            disabled={generating !== null}
            className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating === 'contract' ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <span>📝</span>
            )}
            Contract
          </button>
          <button
            onClick={() => generatePdf('change_order')}
            disabled={generating !== null}
            className="px-3 py-2 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating === 'change_order' ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <span>🔄</span>
            )}
            Change Order
          </button>
        </div>
      </div>

      {/* Files List */}
      <div className="divide-y max-h-96 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <span className="text-4xl block mb-2">📁</span>
            <p>No documents yet</p>
            <p className="text-sm">Generate a proposal or upload a file to get started</p>
          </div>
        ) : (
          Object.entries(groupedFiles).map(([type, typeFiles]) => (
            <div key={type}>
              <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {fileTypeIcons[type]} {fileTypeLabels[type] || type}
              </div>
              {typeFiles.map((file) => (
                <div
                  key={file.id}
                  className="px-4 py-3 hover:bg-gray-50 flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => openFile(file)}
                        className="text-sm font-medium text-gray-900 hover:text-indigo-600 truncate block text-left"
                      >
                        {file.file_name}
                      </button>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{formatDate(file.created_at)}</span>
                        {file.file_size && (
                          <>
                            <span>•</span>
                            <span>{formatFileSize(file.file_size)}</span>
                          </>
                        )}
                        {file.version > 1 && (
                          <>
                            <span>•</span>
                            <span>v{file.version}</span>
                          </>
                        )}
                        {file.is_signed && (
                          <>
                            <span>•</span>
                            <span className="text-green-600">✓ Signed</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openFile(file)}
                      className="p-2 text-gray-400 hover:text-indigo-600 rounded"
                      title="View"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteFile(file.id)}
                      className="p-2 text-gray-400 hover:text-red-600 rounded"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">Upload Document</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Document Type
              </label>
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(fileTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileUpload}
                disabled={uploading}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Accepted formats: PDF, PNG, JPG (max 50MB)
              </p>
            </div>

            {uploading && (
              <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
                <span className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                Uploading...
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
