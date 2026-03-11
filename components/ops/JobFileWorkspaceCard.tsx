'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

type PhotoRow = {
  id: string
  photo_tag: string | null
  filename: string
  created_at: string
  uploaded_by: string | null
}

type DocumentRow = {
  id: string
  title: string | null
  filename: string
  category: string
  document_role: string | null
  version: number
  status: string
  is_protected: boolean
  created_at: string
  updated_at: string
}

type CostLineRow = {
  id: string
  description: string
  amount: number
  cost_type: string
  status: string
  vendor_name?: string | null
}

interface JobFileWorkspaceCardProps {
  jobId: string
  userRole: string
}

type StatusMessage = {
  type: 'success' | 'error'
  text: string
} | null

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0)
}

function formatUserDisplay(uploadedBy: string | null) {
  if (!uploadedBy) return 'Unknown'
  return `User ${uploadedBy.slice(0, 8)}`
}

export default function JobFileWorkspaceCard({ jobId, userRole }: JobFileWorkspaceCardProps) {
  const supabase = useMemo(() => createClientBrowser(), [])

  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [costLines, setCostLines] = useState<CostLineRow[]>([])
  const [attachmentCountByLine, setAttachmentCountByLine] = useState<Record<string, number>>({})
  const [tableUnavailable, setTableUnavailable] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [uploadingCostAttachment, setUploadingCostAttachment] = useState(false)
  const [replacingDocumentId, setReplacingDocumentId] = useState<string | null>(null)
  const [photoTag, setPhotoTag] = useState('general')
  const [documentCategory, setDocumentCategory] = useState('misc')
  const [documentRole, setDocumentRole] = useState('')
  const [documentTitle, setDocumentTitle] = useState('')
  const [documentDescription, setDocumentDescription] = useState('')
  const [pendingDocumentFile, setPendingDocumentFile] = useState<File | null>(null)
  const [selectedCostLineId, setSelectedCostLineId] = useState('')
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const costAttachmentInputRef = useRef<HTMLInputElement>(null)

  const loadData = async (aliveRef?: { current: boolean }, options?: { keepLoadedUI?: boolean }) => {
    if (!options?.keepLoadedUI) {
      setLoading(true)
    }
    setTableUnavailable(false)

    const [photosRes, docsRes, costRes] = await Promise.all([
      supabase
        .from('photos')
        .select('id, photo_tag, filename, created_at, uploaded_by')
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('documents')
        .select('id, title, filename, category, document_role, version, status, is_protected, created_at, updated_at')
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(20),
      supabase
        .from('job_cost_lines')
        .select('id, description, amount, cost_type, status, vendors(name)')
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    if (aliveRef && !aliveRef.current) return

    // If migration isn't applied in an environment yet, show a safe empty-state note.
    const anyMissingTable =
      photosRes.error?.code === 'PGRST205' ||
      docsRes.error?.code === 'PGRST205' ||
      costRes.error?.code === 'PGRST205'

    if (anyMissingTable) {
      setTableUnavailable(true)
      setPhotos([])
      setDocuments([])
      setCostLines([])
      setAttachmentCountByLine({})
      setLoading(false)
      return
    }

    const unexpectedReadError = photosRes.error || docsRes.error || costRes.error
    if (unexpectedReadError) {
      setStatusMessage({
        type: 'error',
        text: 'Could not load workspace data. Please refresh and try again.',
      })
      setLoading(false)
      return
    }

    setPhotos((photosRes.data || []) as PhotoRow[])
    setDocuments((docsRes.data || []) as DocumentRow[])

    const normalizedCostLines = ((costRes.data || []) as any[]).map((row) => ({
      id: row.id,
      description: row.description,
      amount: Number(row.amount || 0),
      cost_type: row.cost_type,
      status: row.status,
      vendor_name: Array.isArray(row.vendors) ? row.vendors[0]?.name || null : row.vendors?.name || null,
    }))
    setCostLines(normalizedCostLines)
    setSelectedCostLineId((prev) => prev || normalizedCostLines[0]?.id || '')

    if (normalizedCostLines.length > 0) {
      const lineIds = normalizedCostLines.map((line) => line.id)
      const attachmentRes = await supabase
        .from('cost_attachments')
        .select('job_cost_line_id')
        .in('job_cost_line_id', lineIds)
        .is('deleted_at', null)

      if (aliveRef && !aliveRef.current) return

      const counts: Record<string, number> = {}
      for (const row of attachmentRes.data || []) {
        const key = (row as { job_cost_line_id: string }).job_cost_line_id
        counts[key] = (counts[key] || 0) + 1
      }
      setAttachmentCountByLine(counts)
    } else {
      setAttachmentCountByLine({})
    }

    setLoading(false)
  }

  useEffect(() => {
    const aliveRef = { current: true }
    loadData(aliveRef)

    return () => {
      aliveRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, supabase])

  useEffect(() => {
    const openCostAttachmentPicker = () => {
      if (tableUnavailable || uploadingCostAttachment || costLines.length === 0) return
      costAttachmentInputRef.current?.click()
    }

    window.addEventListener('job-files-open-cost-attachment', openCostAttachmentPicker)
    return () => {
      window.removeEventListener('job-files-open-cost-attachment', openCostAttachmentPicker)
    }
  }, [tableUnavailable, uploadingCostAttachment, costLines.length])

  const handlePhotoSelected = async (file?: File | null) => {
    if (!file) return
    setUploadingPhoto(true)
    setStatusMessage(null)
    try {
      const formData = new FormData()
      formData.append('photo_tag', photoTag)
      formData.append('file', file)

      const response = await fetch(`/api/ops/jobs/${jobId}/photos`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to upload photo')

      setStatusMessage({
        type: 'success',
        text: 'Photo uploaded successfully.',
      })
      await loadData(undefined, { keepLoadedUI: true })
    } catch (error: any) {
      setStatusMessage({
        type: 'error',
        text: error?.message || 'Photo upload failed. Please try again.',
      })
    } finally {
      setUploadingPhoto(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const handleDocumentSelected = (file?: File | null) => {
    if (!file) return
    setPendingDocumentFile(file)
    setStatusMessage(null)
    if (documentInputRef.current) documentInputRef.current.value = ''
  }

  const handleDocumentUpload = async () => {
    if (!pendingDocumentFile) return
    setUploadingDocument(true)
    setStatusMessage(null)
    try {
      const formData = new FormData()
      formData.append('category', documentCategory)
      if (documentRole) formData.append('document_role', documentRole)
      if (documentTitle) formData.append('title', documentTitle)
      if (documentDescription) formData.append('description', documentDescription)
      formData.append('file', pendingDocumentFile)

      const response = await fetch(`/api/ops/jobs/${jobId}/documents`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to upload document')

      setDocumentTitle('')
      setDocumentDescription('')
      setDocumentRole('')
      setDocumentCategory('misc')
      setPendingDocumentFile(null)
      setStatusMessage({
        type: 'success',
        text: 'Document uploaded successfully.',
      })
      await loadData(undefined, { keepLoadedUI: true })
    } catch (error: any) {
      setStatusMessage({
        type: 'error',
        text: error?.message || 'Document upload failed. Please try again.',
      })
    } finally {
      setUploadingDocument(false)
    }
  }

  const handleCostAttachmentSelected = async (file?: File | null) => {
    if (!file || !selectedCostLineId) return
    setUploadingCostAttachment(true)
    setStatusMessage(null)
    try {
      const formData = new FormData()
      formData.append('job_cost_line_id', selectedCostLineId)
      formData.append('file', file)

      const response = await fetch(`/api/ops/jobs/${jobId}/cost-attachments`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to upload attachment')

      setStatusMessage({
        type: 'success',
        text: 'Cost attachment uploaded successfully.',
      })
      await loadData(undefined, { keepLoadedUI: true })
    } catch (error: any) {
      setStatusMessage({
        type: 'error',
        text: error?.message || 'Cost attachment upload failed. Please try again.',
      })
    } finally {
      setUploadingCostAttachment(false)
      if (costAttachmentInputRef.current) costAttachmentInputRef.current.value = ''
    }
  }

  const handleReplaceDocument = async (documentId: string, file?: File | null) => {
    if (!file) return
    setReplacingDocumentId(documentId)
    setStatusMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/ops/jobs/${jobId}/documents/${documentId}/replace`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to replace document')

      setStatusMessage({
        type: 'success',
        text: 'New document version uploaded. Previous version is preserved in history.',
      })
      await loadData(undefined, { keepLoadedUI: true })
    } catch (error: any) {
      setStatusMessage({
        type: 'error',
        text: error?.message || 'Document replacement failed. Please try again.',
      })
    } finally {
      setReplacingDocumentId(null)
    }
  }

  const canSeeAmounts = userRole === 'admin' || userRole === 'owner' || userRole === 'operations'
  const canReplaceProtectedDocuments =
    userRole === 'admin' ||
    userRole === 'owner' ||
    userRole === 'operations' ||
    userRole === 'regional_manager'

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">Job Files Workspace</h2>
          <p className="text-sm text-gray-600 mt-1">
            Photos, documents, and cost records for this job.
          </p>
        </div>
      </div>

      {tableUnavailable && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This workspace will appear after the latest database migration is applied.
        </div>
      )}

      {statusMessage && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            statusMessage.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <div className="space-y-6">
        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">Photos</h3>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="job-photo-tag-select">
                Photo type
              </label>
              <select
                id="job-photo-tag-select"
                value={photoTag}
                onChange={(e) => setPhotoTag(e.target.value)}
                className="text-sm border rounded-lg px-2 py-2 text-gray-900"
              >
                <option value="general">General</option>
                <option value="before">Before</option>
                <option value="progress">Progress</option>
                <option value="after">After</option>
                <option value="final">Final</option>
              </select>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto || tableUnavailable}
                className="text-sm px-3 py-2 rounded-lg border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Upload before/progress/final photos so office and production can track the job clearly.
          </p>

          {loading ? (
            <p className="text-sm text-gray-500">Loading photos...</p>
          ) : photos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
              No photos yet. Use "Upload Photo" to add before/progress/final job photos.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">File</th>
                    <th className="text-left px-3 py-2 font-medium">Uploaded</th>
                    <th className="text-left px-3 py-2 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {photos.map((photo) => (
                    <tr key={photo.id} className="border-t">
                      <td className="px-3 py-2 text-gray-700">{photo.photo_tag || 'general'}</td>
                      <td className="px-3 py-2 text-gray-900">{photo.filename}</td>
                      <td className="px-3 py-2 text-gray-700">{formatDate(photo.created_at)}</td>
                      <td className="px-3 py-2 text-gray-700">{formatUserDisplay(photo.uploaded_by)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">Documents</h3>
            <button
              type="button"
              onClick={() => documentInputRef.current?.click()}
              disabled={uploadingDocument || tableUnavailable}
              className="text-sm px-3 py-2 rounded-lg border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              Upload File
            </button>
          </div>
          <input
            ref={documentInputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleDocumentSelected(e.target.files?.[0])}
          />
          {pendingDocumentFile && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm text-gray-700 mb-2">
                Selected file: <span className="font-medium">{pendingDocumentFile.name}</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2">
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className="text-sm border rounded-lg px-2 py-2 text-gray-900"
                />
                <select
                  value={documentCategory}
                  onChange={(e) => setDocumentCategory(e.target.value)}
                  className="text-sm border rounded-lg px-2 py-2 text-gray-900"
                >
                  <option value="misc">Misc</option>
                  <option value="contract">Contract</option>
                  <option value="change_order">Change Order</option>
                  <option value="permit">Permit</option>
                  <option value="invoice">Invoice</option>
                  <option value="warranty">Warranty</option>
                </select>
                <select
                  value={documentRole}
                  onChange={(e) => setDocumentRole(e.target.value)}
                  className="text-sm border rounded-lg px-2 py-2 text-gray-900"
                >
                  <option value="">No linked role</option>
                  <option value="draft">Draft</option>
                  <option value="signed_executed">Signed / Executed</option>
                  <option value="supporting_attachment">Supporting Attachment</option>
                  <option value="customer_copy">Customer Copy</option>
                  <option value="internal_copy">Internal Copy</option>
                </select>
                <input
                  type="text"
                  value={documentDescription}
                  onChange={(e) => setDocumentDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="text-sm border rounded-lg px-2 py-2 text-gray-900"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDocumentUpload}
                  disabled={uploadingDocument || tableUnavailable}
                  className="text-sm px-3 py-2 rounded-lg border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {uploadingDocument ? 'Uploading...' : 'Save Document'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDocumentFile(null)}
                  disabled={uploadingDocument}
                  className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {!pendingDocumentFile && (
            <div className="mb-3 rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              Choose a document file first, then add optional details before saving.
            </div>
          )}
          <p className="text-xs text-gray-500 mb-3">
            Documents are versioned. Replacing a document keeps prior versions in history and never overwrites files.
          </p>

          {loading ? (
            <p className="text-sm text-gray-500">Loading documents...</p>
          ) : documents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
              No documents yet. Add contracts, change-order files, and supporting documents here.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Title / File</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Role</th>
                    <th className="text-left px-3 py-2 font-medium">Version</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Updated</th>
                    <th className="text-left px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-t">
                      <td className="px-3 py-2 text-gray-900">
                        <div className="flex items-center gap-2">
                          <span>{doc.title || doc.filename}</span>
                          {doc.is_protected && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Protected</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{doc.category}</td>
                      <td className="px-3 py-2 text-gray-700">{doc.document_role || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">v{doc.version}</td>
                      <td className="px-3 py-2 text-gray-700">{doc.status}</td>
                      <td className="px-3 py-2 text-gray-700">{formatDate(doc.updated_at || doc.created_at)}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {doc.is_protected && !canReplaceProtectedDocuments ? (
                          <span className="text-xs text-gray-500">Restricted (protected doc)</span>
                        ) : (
                          <label className="text-sm text-indigo-700 hover:text-indigo-900 cursor-pointer">
                            {replacingDocumentId === doc.id ? 'Replacing...' : 'Replace Version'}
                            <input
                              type="file"
                              className="hidden"
                              disabled={replacingDocumentId !== null}
                              onChange={(e) => handleReplaceDocument(doc.id, e.target.files?.[0])}
                            />
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">Costs</h3>
            <div className="flex items-center gap-2">
              <select
                value={selectedCostLineId}
                onChange={(e) => setSelectedCostLineId(e.target.value)}
                className="text-sm border rounded-lg px-2 py-2 text-gray-900 max-w-[180px]"
                disabled={costLines.length === 0}
              >
                {costLines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.description.slice(0, 28)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => costAttachmentInputRef.current?.click()}
                disabled={uploadingCostAttachment || costLines.length === 0 || tableUnavailable}
                className="text-sm px-3 py-2 rounded-lg border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {uploadingCostAttachment ? 'Uploading...' : 'Attach Receipt / Invoice'}
              </button>
              <input
                ref={costAttachmentInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleCostAttachmentSelected(e.target.files?.[0])}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Attach receipts/invoices to a selected cost line for cleaner bookkeeping.
          </p>
          {!canSeeAmounts && (
            <p className="text-xs text-gray-500 mb-3">
              Cost amounts are hidden for your role.
            </p>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">Loading costs...</p>
          ) : costLines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
              No job cost lines yet. Add labor, material, permit, and miscellaneous costs here.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Item</th>
                    <th className="text-left px-3 py-2 font-medium">Vendor</th>
                    {canSeeAmounts && <th className="text-left px-3 py-2 font-medium">Amount</th>}
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Attachments</th>
                  </tr>
                </thead>
                <tbody>
                  {costLines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="px-3 py-2 text-gray-900">{line.description}</td>
                      <td className="px-3 py-2 text-gray-700">{line.vendor_name || '-'}</td>
                      {canSeeAmounts && <td className="px-3 py-2 text-gray-700">{formatCurrency(line.amount)}</td>}
                      <td className="px-3 py-2 text-gray-700">{line.cost_type}</td>
                      <td className="px-3 py-2 text-gray-700">{line.status}</td>
                      <td className="px-3 py-2 text-gray-700">{attachmentCountByLine[line.id] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
