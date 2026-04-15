'use client'

import type { DragEvent, FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { multipartFilenameForUpload } from '@/lib/files/storage'
import { createClientBrowser } from '@/lib/supabase/client'

type PhotoRow = {
  id: string
  photo_tag: string | null
  filename: string
  created_at: string
  uploaded_by: string | null
  uploaded_by_name?: string | null
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
  is_system?: boolean
}

interface JobFileWorkspaceCardProps {
  jobId: string
  userRole: string
  registerOpenCostAttachmentShortcut?: (openPicker: (() => void) | null) => void
  dealerFeeAmount?: number | null
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

function formatUserDisplay(uploadedByName?: string | null) {
  if (!uploadedByName) return 'Unknown'
  return uploadedByName
}

function isImageFile(file: File) {
  if (file.type.startsWith('image/')) return true
  return /\.(heic|heif|jpg|jpeg|png|gif|webp|bmp|tiff?)$/i.test(file.name)
}

function hasFilePayload(e: DragEvent) {
  return e.dataTransfer.types.includes('Files')
}

/**
 * Upload routes return JSON; reverse proxies (e.g. Vercel) may respond with plain text on limits
 * (e.g. "413 Request Entity Too Large") before the handler runs — `response.json()` then throws
 * "Unexpected token 'R'..." which is confusing.
 */
async function parseUploadResponseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const t = text.replace(/\s+/g, ' ').trim()
    const tooLarge =
      response.status === 413 ||
      /request entity too large|payload too large|body exceeded|max body/i.test(t)
    if (tooLarge) {
      throw new Error(
        'This file exceeds the server upload size limit (often about 4.5 MB on typical hosted deployments). Compress the image or use a smaller file.'
      )
    }
    throw new Error(t.slice(0, 200) || `Upload failed (HTTP ${response.status})`)
  }
}

async function fetchOpsJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, credentials: 'include' })
  const data = await parseUploadResponseJson(response)
  if (!response.ok) {
    throw new Error(String(data.error || 'Request failed'))
  }
  return data
}

export default function JobFileWorkspaceCard({
  jobId,
  userRole,
  registerOpenCostAttachmentShortcut,
  dealerFeeAmount,
}: JobFileWorkspaceCardProps) {
  const supabase = useMemo(() => createClientBrowser(), [])

  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [costLines, setCostLines] = useState<CostLineRow[]>([])
  const [attachmentCountByLine, setAttachmentCountByLine] = useState<Record<string, number>>({})
  const [tableUnavailable, setTableUnavailable] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoUploadProgress, setPhotoUploadProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [uploadingCostAttachment, setUploadingCostAttachment] = useState(false)
  const [replacingDocumentId, setReplacingDocumentId] = useState<string | null>(null)
  const [photoTag, setPhotoTag] = useState('general')
  const [documentCategory, setDocumentCategory] = useState('misc')
  const [documentRole, setDocumentRole] = useState('')
  const [documentTitle, setDocumentTitle] = useState('')
  const [documentDescription, setDocumentDescription] = useState('')
  const [pendingDocumentFiles, setPendingDocumentFiles] = useState<File[]>([])
  const [selectedCostLineId, setSelectedCostLineId] = useState('')
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const costAttachmentInputRef = useRef<HTMLInputElement>(null)
  const photoDragDepth = useRef(0)
  const documentDragDepth = useRef(0)
  const costDragDepth = useRef(0)
  const [photoDropActive, setPhotoDropActive] = useState(false)
  const [documentDropActive, setDocumentDropActive] = useState(false)
  const [costDropActive, setCostDropActive] = useState(false)
  const [showAddCostForm, setShowAddCostForm] = useState(false)
  const [savingCostLine, setSavingCostLine] = useState(false)
  const [newCostDescription, setNewCostDescription] = useState('')
  const [newCostAmount, setNewCostAmount] = useState('')
  const [newCostType, setNewCostType] = useState<string>('material')

  const loadData = async (aliveRef?: { current: boolean }, options?: { keepLoadedUI?: boolean }) => {
    if (!options?.keepLoadedUI) {
      setLoading(true)
    }
    setTableUnavailable(false)

    const photosPromise = fetch(`/api/ops/jobs/${jobId}/photos`, {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          return {
            data: null,
            error: {
              message: data?.error || 'Failed to load photos',
              code: data?.code || null,
            },
          }
        }
        return { data: (data?.photos || []) as PhotoRow[], error: null }
      })
      .catch((error: any) => ({
        data: null,
        error: { message: error?.message || 'Failed to load photos', code: null },
      }))

    const [photosRes, docsRes, costRes] = await Promise.all([
      photosPromise,
      fetch(`/api/ops/jobs/${jobId}/documents`, {
        method: 'GET',
        cache: 'no-store',
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}))
          if (!response.ok) {
            return {
              data: null,
              error: {
                message: data?.error || 'Failed to load documents',
                code: data?.code || null,
              },
            }
          }
          return { data: (data?.documents || []) as DocumentRow[], error: null }
        })
        .catch((error: any) => ({
          data: null,
          error: { message: error?.message || 'Failed to load documents', code: null },
        })),
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

    const normalizedCostLines: CostLineRow[] = ((costRes.data || []) as any[]).map((row) => ({
      id: row.id,
      description: row.description,
      amount: Number(row.amount || 0),
      cost_type: row.cost_type,
      status: row.status,
      vendor_name: Array.isArray(row.vendors) ? row.vendors[0]?.name || null : row.vendors?.name || null,
    }))
    const hasPersistedDealerFee = normalizedCostLines.some((line) =>
      /lender|dealer fee/i.test(line.description)
    )
    const displayCostLines: CostLineRow[] =
      dealerFeeAmount != null && dealerFeeAmount > 0 && !hasPersistedDealerFee
        ? [
            {
              id: 'system-lender-dealer-fee',
              description: 'Lender / dealer fee',
              amount: Number(dealerFeeAmount || 0),
              cost_type: 'misc',
              status: 'active',
              vendor_name: null,
              is_system: true,
            },
            ...normalizedCostLines,
          ]
        : normalizedCostLines
    setCostLines(displayCostLines)
    const firstAttachableLine = displayCostLines.find((line) => !line.is_system)
    setSelectedCostLineId((prev) => {
      if (prev && displayCostLines.some((line) => line.id === prev && !line.is_system)) return prev
      return firstAttachableLine?.id || ''
    })

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
    if (!registerOpenCostAttachmentShortcut) return

    const openCostAttachmentPicker = () => {
      if (tableUnavailable || uploadingCostAttachment || !selectedCostLineId) return
      costAttachmentInputRef.current?.click()
    }

    registerOpenCostAttachmentShortcut(openCostAttachmentPicker)
    return () => {
      registerOpenCostAttachmentShortcut(null)
    }
  }, [registerOpenCostAttachmentShortcut, tableUnavailable, uploadingCostAttachment, selectedCostLineId])

  useEffect(() => {
    if (costLines.length > 0) setShowAddCostForm(false)
  }, [costLines.length])

  const handlePhotosSelected = async (fileList?: FileList | null) => {
    const files = fileList ? Array.from(fileList).filter((f) => f.size > 0) : []
    if (files.length === 0) return
    setUploadingPhoto(true)
    setPhotoUploadProgress({ done: 0, total: files.length })
    setStatusMessage(null)
    let ok = 0
    let firstError = ''
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setPhotoUploadProgress({ done: i, total: files.length })
      try {
        const safeName = multipartFilenameForUpload(file, `photo_${i + 1}`)
        const reg = await fetchOpsJson(`/api/ops/jobs/${jobId}/photos/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: safeName }),
        })
        const photoId = String(reg.photoId)
        const storagePath = String(reg.storagePath)
        const bucket = String(reg.bucket)
        const signedUploadToken = String(reg.signedUploadToken)

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(storagePath, signedUploadToken, file, {
            contentType: file.type || 'application/octet-stream',
          })
        if (uploadError) throw new Error(uploadError.message)

        const data = await fetchOpsJson(`/api/ops/jobs/${jobId}/photos/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photoId,
            photo_tag: photoTag,
            mime_type: file.type || null,
            file_size: file.size,
          }),
        })

        if (data?.photo) {
          setPhotos((prev) => [data.photo as PhotoRow, ...prev])
        }
        ok++
      } catch (error: any) {
        if (!firstError) firstError = error?.message || 'Upload failed'
      }
      setPhotoUploadProgress({ done: i + 1, total: files.length })
    }

    setStatusMessage({
      type: ok < files.length ? 'error' : 'success',
      text:
        ok === files.length
          ? `Uploaded ${ok} photo${ok === 1 ? '' : 's'} successfully.`
          : `Uploaded ${ok} of ${files.length}.${firstError ? ` ${firstError}` : ''}`,
    })
    await loadData(undefined, { keepLoadedUI: true })
    setUploadingPhoto(false)
    setPhotoUploadProgress(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const handleDocumentsSelected = (fileList?: FileList | null) => {
    const files = fileList ? Array.from(fileList).filter((f) => f.size > 0) : []
    if (files.length === 0) return
    setPendingDocumentFiles(files)
    setStatusMessage(null)
    if (documentInputRef.current) documentInputRef.current.value = ''
  }

  const handleDocumentUpload = async () => {
    if (pendingDocumentFiles.length === 0) return
    setUploadingDocument(true)
    setStatusMessage(null)
    const files = pendingDocumentFiles
    let ok = 0
    let firstError = ''
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const safeName = multipartFilenameForUpload(file, `document_${i + 1}`)
        const baseTitle =
          files.length === 1 && documentTitle.trim()
            ? documentTitle.trim()
            : file.name.replace(/\.[^.]+$/, '') || file.name

        const regBody: Record<string, string | null | undefined> = { filename: safeName }
        if (documentRole) regBody.document_role = documentRole

        const reg = await fetchOpsJson(`/api/ops/jobs/${jobId}/documents/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(regBody),
        })
        const documentId = String(reg.documentId)
        const storagePath = String(reg.storagePath)
        const bucket = String(reg.bucket)
        const signedUploadToken = String(reg.signedUploadToken)

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(storagePath, signedUploadToken, file, {
            contentType: file.type || 'application/octet-stream',
          })
        if (uploadError) throw new Error(uploadError.message)

        await fetchOpsJson(`/api/ops/jobs/${jobId}/documents/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId,
            category: documentCategory,
            title: baseTitle,
            description: documentDescription || null,
            document_role: documentRole || null,
            linked_record_type: null,
            linked_record_id: null,
            mime_type: file.type || null,
            file_size: file.size,
          }),
        })
        ok++
      } catch (error: any) {
        if (!firstError) firstError = error?.message || 'Document upload failed.'
      }
    }

    if (ok === files.length) {
      setDocumentTitle('')
      setDocumentDescription('')
      setDocumentRole('')
      setDocumentCategory('misc')
      setPendingDocumentFiles([])
    }
    setStatusMessage({
      type: ok < files.length ? 'error' : 'success',
      text:
        ok === files.length
          ? ok === 1
            ? 'Document uploaded successfully.'
            : `Uploaded ${ok} documents successfully.`
          : `Uploaded ${ok} of ${files.length}.${firstError ? ` ${firstError}` : ''}`,
    })
    await loadData(undefined, { keepLoadedUI: true })
    setUploadingDocument(false)
  }

  const handleCostAttachmentsSelected = async (fileList?: FileList | null) => {
    const files = fileList ? Array.from(fileList).filter((f) => f.size > 0) : []
    if (files.length === 0 || !selectedCostLineId) return
    setUploadingCostAttachment(true)
    setStatusMessage(null)
    let ok = 0
    let firstError = ''
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const safeName = multipartFilenameForUpload(file, `attachment_${i + 1}`)
        const reg = await fetchOpsJson(`/api/ops/jobs/${jobId}/cost-attachments/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: safeName,
            job_cost_line_id: selectedCostLineId,
          }),
        })
        const attachmentId = String(reg.attachmentId)
        const documentId = String(reg.documentId)
        const storagePath = String(reg.storagePath)
        const bucket = String(reg.bucket)
        const signedUploadToken = String(reg.signedUploadToken)

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(storagePath, signedUploadToken, file, {
            contentType: file.type || 'application/octet-stream',
          })
        if (uploadError) throw new Error(uploadError.message)

        await fetchOpsJson(`/api/ops/jobs/${jobId}/cost-attachments/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attachmentId,
            documentId,
            job_cost_line_id: selectedCostLineId,
            mime_type: file.type || null,
            file_size: file.size,
          }),
        })
        ok++
      } catch (error: any) {
        if (!firstError) firstError = error?.message || 'Upload failed'
      }
    }

    setStatusMessage({
      type: ok < files.length ? 'error' : 'success',
      text:
        ok === files.length
          ? ok === 1
            ? 'Cost attachment uploaded successfully.'
            : `Uploaded ${ok} attachments successfully.`
          : `Uploaded ${ok} of ${files.length}.${firstError ? ` ${firstError}` : ''}`,
    })
    await loadData(undefined, { keepLoadedUI: true })
    setUploadingCostAttachment(false)
    if (costAttachmentInputRef.current) costAttachmentInputRef.current.value = ''
  }

  const handleReplaceDocument = async (documentId: string, file?: File | null) => {
    if (!file) return
    setReplacingDocumentId(documentId)
    setStatusMessage(null)
    try {
      const safeName = multipartFilenameForUpload(file, 'document')
      const reg = await fetchOpsJson(`/api/ops/jobs/${jobId}/documents/${documentId}/replace/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: safeName }),
      })
      const newDocumentId = String(reg.newDocumentId)
      const storagePath = String(reg.storagePath)
      const bucket = String(reg.bucket)
      const signedUploadToken = String(reg.signedUploadToken)

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(storagePath, signedUploadToken, file, {
          contentType: file.type || 'application/octet-stream',
        })
      if (uploadError) throw new Error(uploadError.message)

      await fetchOpsJson(`/api/ops/jobs/${jobId}/documents/${documentId}/replace/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newDocumentId,
          mime_type: file.type || null,
          file_size: file.size,
        }),
      })

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

  const fileListFromFiles = (files: File[]) => {
    const dt = new DataTransfer()
    files.forEach((f) => dt.items.add(f))
    return dt.files
  }

  const resetPhotoDrag = () => {
    photoDragDepth.current = 0
    setPhotoDropActive(false)
  }

  const onPhotoDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingPhoto) return
    e.preventDefault()
    e.stopPropagation()
    photoDragDepth.current += 1
    setPhotoDropActive(true)
  }

  const onPhotoDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    photoDragDepth.current -= 1
    if (photoDragDepth.current <= 0) {
      photoDragDepth.current = 0
      setPhotoDropActive(false)
    }
  }

  const onPhotoDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingPhoto) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onPhotoDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingPhoto) return
    e.preventDefault()
    e.stopPropagation()
    resetPhotoDrag()
    const images = Array.from(e.dataTransfer.files).filter(isImageFile)
    if (images.length === 0) {
      setStatusMessage({ type: 'error', text: 'Drop image files only for photos.' })
      return
    }
    void handlePhotosSelected(fileListFromFiles(images))
  }

  const resetDocumentDrag = () => {
    documentDragDepth.current = 0
    setDocumentDropActive(false)
  }

  const onDocumentDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingDocument) return
    e.preventDefault()
    e.stopPropagation()
    documentDragDepth.current += 1
    setDocumentDropActive(true)
  }

  const onDocumentDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    documentDragDepth.current -= 1
    if (documentDragDepth.current <= 0) {
      documentDragDepth.current = 0
      setDocumentDropActive(false)
    }
  }

  const onDocumentDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingDocument) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDocumentDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingDocument) return
    e.preventDefault()
    e.stopPropagation()
    resetDocumentDrag()
    const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0)
    if (files.length === 0) return
    handleDocumentsSelected(fileListFromFiles(files))
  }

  const resetCostDrag = () => {
    costDragDepth.current = 0
    setCostDropActive(false)
  }

  const onCostDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingCostAttachment || costLines.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    costDragDepth.current += 1
    setCostDropActive(true)
  }

  const onCostDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    costDragDepth.current -= 1
    if (costDragDepth.current <= 0) {
      costDragDepth.current = 0
      setCostDropActive(false)
    }
  }

  const onCostDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingCostAttachment || costLines.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onCostDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(e) || tableUnavailable || uploadingCostAttachment || costLines.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    resetCostDrag()
    if (!selectedCostLineId) {
      setStatusMessage({ type: 'error', text: 'Select a cost line before dropping attachments.' })
      return
    }
    const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0)
    if (files.length === 0) return
    void handleCostAttachmentsSelected(fileListFromFiles(files))
  }

  const canSeeAmounts = userRole === 'admin' || userRole === 'owner' || userRole === 'operations'

  const handleAddCostLine = async (e: FormEvent) => {
    e.preventDefault()
    if (tableUnavailable || savingCostLine) return
    const desc = newCostDescription.trim()
    if (!desc) {
      setStatusMessage({ type: 'error', text: 'Enter a description for this cost.' })
      return
    }
    setSavingCostLine(true)
    setStatusMessage(null)
    try {
      const amountNum = canSeeAmounts ? parseFloat(newCostAmount) : 0
      const amount = Number.isFinite(amountNum) ? amountNum : 0
      const response = await fetch(`/api/ops/jobs/${jobId}/cost-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          description: desc,
          cost_type: newCostType,
          amount,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not add cost line')
      setNewCostDescription('')
      setNewCostAmount('')
      setNewCostType('material')
      setShowAddCostForm(false)
      await loadData()
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Could not add cost line' })
    } finally {
      setSavingCostLine(false)
    }
  }

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
                {uploadingPhoto
                  ? photoUploadProgress
                    ? `Uploading ${photoUploadProgress.done}/${photoUploadProgress.total}…`
                    : 'Uploading…'
                  : 'Upload Photos'}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handlePhotosSelected(e.target.files)}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Upload before/progress/final photos so office and production can track the job clearly. Select multiple
            images in the file picker (Shift- or Cmd/Ctrl-click) or drag files into the area below.
          </p>

          <div
            className={`rounded-lg border-2 border-dashed transition-colors ${
              photoDropActive ? 'border-indigo-500 bg-indigo-50/90' : 'border-gray-200'
            }`}
            onDragEnter={onPhotoDragEnter}
            onDragLeave={onPhotoDragLeave}
            onDragOver={onPhotoDragOver}
            onDrop={onPhotoDrop}
            role="region"
            aria-label="Photo drop zone"
          >
            {photoDropActive && (
              <p className="text-center text-sm font-medium text-indigo-800 py-2 border-b border-indigo-200/80">
                Drop images to upload with the selected photo type
              </p>
            )}
            {loading ? (
              <p className="text-sm text-gray-500 p-4">Loading photos...</p>
            ) : photos.length === 0 ? (
              <div className="p-4 text-sm text-gray-600">
                <p className="mb-1">No photos yet.</p>
                <p>Use &quot;Upload Photos&quot; or drag image files here (HEIC, JPEG, PNG, etc.).</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-gray-200 m-2">
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
                        <td className="px-3 py-2">
                          <a
                            href={`/api/ops/jobs/${jobId}/photos/${photo.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
                          >
                            {photo.filename}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{formatDate(photo.created_at)}</td>
                        <td className="px-3 py-2 text-gray-700">{formatUserDisplay(photo.uploaded_by_name)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
              Upload files
            </button>
          </div>
          <input
            ref={documentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleDocumentsSelected(e.target.files)}
          />
          {pendingDocumentFiles.length > 0 && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm text-gray-700 mb-2">
                {pendingDocumentFiles.length === 1 ? (
                  <>
                    Selected file:{' '}
                    <span className="font-medium">{pendingDocumentFiles[0].name}</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium">{pendingDocumentFiles.length} files selected</span>
                    <span className="block mt-1 text-xs text-gray-600 max-h-24 overflow-y-auto">
                      {pendingDocumentFiles.map((f) => f.name).join(', ')}
                    </span>
                  </>
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2">
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder={
                    pendingDocumentFiles.length > 1
                      ? 'Title (single file only; batch uses filenames)'
                      : 'Title (optional)'
                  }
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
                  {uploadingDocument ? 'Uploading...' : pendingDocumentFiles.length > 1 ? 'Save documents' : 'Save document'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDocumentFiles([])}
                  disabled={uploadingDocument}
                  className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {pendingDocumentFiles.length === 0 && (
            <div className="mb-3 rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              Upload files, set category and role, then save. Drag-and-drop supported.
            </div>
          )}
          <p className="text-xs text-gray-500 mb-3">Contracts, change orders, and supporting files.</p>

          <div
            className={`rounded-lg border-2 border-dashed transition-colors ${
              documentDropActive ? 'border-indigo-500 bg-indigo-50/90' : 'border-gray-200'
            }`}
            onDragEnter={onDocumentDragEnter}
            onDragLeave={onDocumentDragLeave}
            onDragOver={onDocumentDragOver}
            onDrop={onDocumentDrop}
            role="region"
            aria-label="Document drop zone"
          >
            {documentDropActive && (
              <p className="text-center text-sm font-medium text-indigo-800 py-2 border-b border-indigo-200/80">
                Drop files to queue them — add details, then save
              </p>
            )}
            {loading ? (
              <p className="text-sm text-gray-500 p-4">Loading documents...</p>
            ) : documents.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No documents yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-gray-200 m-2">
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
                            <a
                              href={`/api/ops/jobs/${jobId}/documents/${doc.id}/download`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
                            >
                              {doc.title || doc.filename}
                            </a>
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
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">Costs</h3>
            <div className="flex items-center gap-2">
              <select
                value={selectedCostLineId}
                onChange={(e) => setSelectedCostLineId(e.target.value)}
                className="text-sm border rounded-lg px-2 py-2 text-gray-900 max-w-[180px]"
                disabled={!costLines.some((line) => !line.is_system)}
              >
                {costLines.filter((line) => !line.is_system).map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.description.slice(0, 28)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => costAttachmentInputRef.current?.click()}
                disabled={uploadingCostAttachment || !selectedCostLineId || tableUnavailable}
                className="text-sm px-3 py-2 rounded-lg border border-indigo-600 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {uploadingCostAttachment ? 'Uploading...' : 'Attach receipts / invoices'}
              </button>
              <input
                ref={costAttachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void handleCostAttachmentsSelected(e.target.files)}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Attach receipts/invoices to a selected cost line for cleaner bookkeeping. You can drag files onto the
            cost table when a line is selected.
          </p>
          {!canSeeAmounts && (
            <p className="text-xs text-gray-500 mb-3">
              Cost amounts are hidden for your role.
            </p>
          )}

          <div
            className={`rounded-lg border-2 border-dashed transition-colors ${
              costDropActive ? 'border-indigo-500 bg-indigo-50/90' : 'border-gray-200'
            }`}
            onDragEnter={onCostDragEnter}
            onDragLeave={onCostDragLeave}
            onDragOver={onCostDragOver}
            onDrop={onCostDrop}
            role="region"
            aria-label="Cost attachment drop zone"
          >
            {costDropActive && (
              <p className="text-center text-sm font-medium text-indigo-800 py-2 border-b border-indigo-200/80">
                Drop files to attach to the selected cost line
              </p>
            )}
            {loading ? (
              <p className="text-sm text-gray-500 p-4">Loading costs...</p>
            ) : costLines.length === 0 ? (
              <div className="p-3 sm:p-4">
                {showAddCostForm ? (
                  <form onSubmit={handleAddCostLine} className="space-y-3 text-sm">
                    <div>
                      <label htmlFor="new-cost-description" className="block text-xs font-medium text-gray-500 mb-1">
                        Description
                      </label>
                      <input
                        id="new-cost-description"
                        type="text"
                        value={newCostDescription}
                        onChange={(e) => setNewCostDescription(e.target.value)}
                        placeholder="e.g. Shingles, permit fee, dumpster"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        autoFocus
                        disabled={savingCostLine || tableUnavailable}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="new-cost-type" className="block text-xs font-medium text-gray-500 mb-1">
                          Category
                        </label>
                        <select
                          id="new-cost-type"
                          value={newCostType}
                          onChange={(e) => setNewCostType(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                          disabled={savingCostLine || tableUnavailable}
                        >
                          <option value="material">Material</option>
                          <option value="labor">Labor</option>
                          <option value="permit">Permit</option>
                          <option value="subcontractor">Subcontractor</option>
                          <option value="misc">Misc</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      {canSeeAmounts && (
                        <div>
                          <label htmlFor="new-cost-amount" className="block text-xs font-medium text-gray-500 mb-1">
                            Amount (USD)
                          </label>
                          <input
                            id="new-cost-amount"
                            type="number"
                            min={0}
                            step="0.01"
                            value={newCostAmount}
                            onChange={(e) => setNewCostAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                            disabled={savingCostLine || tableUnavailable}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={savingCostLine || tableUnavailable}
                        className="min-h-[44px] px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {savingCostLine ? 'Saving…' : 'Save cost line'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCostForm(false)
                          setNewCostDescription('')
                          setNewCostAmount('')
                          setNewCostType('material')
                        }}
                        disabled={savingCostLine}
                        className="min-h-[44px] px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddCostForm(true)}
                    disabled={tableUnavailable}
                    className="w-full min-h-[44px] rounded-lg border-2 border-dashed border-gray-200 p-4 text-left text-sm text-gray-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <p className="mb-1">No job cost lines yet.</p>
                    <p className="font-semibold text-indigo-700">
                      + Add labor, material, permit, or miscellaneous cost
                    </p>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-gray-200 m-2">
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
                        <td className="px-3 py-2 text-gray-900">
                          {line.description}
                          {line.is_system && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                              from financing
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{line.vendor_name || '-'}</td>
                        {canSeeAmounts && <td className="px-3 py-2 text-gray-700">{formatCurrency(line.amount)}</td>}
                        <td className="px-3 py-2 text-gray-700">{line.cost_type}</td>
                        <td className="px-3 py-2 text-gray-700">{line.status}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {line.is_system ? '-' : attachmentCountByLine[line.id] || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
