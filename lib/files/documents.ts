export type LinkedRecordType = 'contract' | 'change_order' | null

export type DocumentRole =
  | 'draft'
  | 'signed_executed'
  | 'supporting_attachment'
  | 'customer_copy'
  | 'internal_copy'
  | null

export type DocumentStatus = 'active' | 'superseded' | 'void' | 'archived'

export interface DocumentRowForVersioning {
  id: string
  org_id: string
  job_id: string | null
  customer_id: string | null
  linked_record_type: LinkedRecordType
  linked_record_id: string | null
  document_role: DocumentRole
  category: string
  title: string | null
  description: string | null
  is_protected: boolean
  version: number
}

export function shouldAutoProtectDocument(args: {
  linkedRecordType: LinkedRecordType
  documentRole: DocumentRole
}) {
  return (
    args.linkedRecordType !== null &&
    (args.linkedRecordType === 'contract' || args.linkedRecordType === 'change_order') &&
    args.documentRole === 'signed_executed'
  )
}

export function createInitialDocumentInsert(args: {
  orgId: string
  jobId?: string | null
  customerId?: string | null
  linkedRecordType?: LinkedRecordType
  linkedRecordId?: string | null
  documentRole?: DocumentRole
  storagePath: string
  filename: string
  fileSize?: number | null
  mimeType?: string | null
  category: string
  title?: string | null
  description?: string | null
  uploadedBy: string
  versionNote?: string | null
}) {
  const linkedRecordType = args.linkedRecordType ?? null
  const documentRole = args.documentRole ?? null
  const isProtected = shouldAutoProtectDocument({
    linkedRecordType,
    documentRole,
  })

  return {
    org_id: args.orgId,
    job_id: args.jobId ?? null,
    customer_id: args.customerId ?? null,
    linked_record_type: linkedRecordType,
    linked_record_id: args.linkedRecordId ?? null,
    document_role: documentRole,
    storage_path: args.storagePath,
    filename: args.filename,
    file_size: args.fileSize ?? null,
    mime_type: args.mimeType ?? null,
    category: args.category,
    title: args.title ?? null,
    description: args.description ?? null,
    status: 'active' as DocumentStatus,
    is_protected: isProtected,
    version: 1,
    parent_document_id: null,
    version_note: args.versionNote ?? null,
    uploaded_by: args.uploadedBy,
  }
}

// Alias used by API handlers for clearer intent.
export const newDocumentInsert = createInitialDocumentInsert

export function createReplacementDocumentVersion(args: {
  previous: DocumentRowForVersioning
  storagePath: string
  filename: string
  fileSize?: number | null
  mimeType?: string | null
  uploadedBy: string
  versionNote?: string | null
}) {
  const inheritedProtected =
    args.previous.is_protected ||
    shouldAutoProtectDocument({
      linkedRecordType: args.previous.linked_record_type,
      documentRole: args.previous.document_role,
    })

  return {
    newDocumentInsert: {
      org_id: args.previous.org_id,
      job_id: args.previous.job_id,
      customer_id: args.previous.customer_id,
      linked_record_type: args.previous.linked_record_type,
      linked_record_id: args.previous.linked_record_id,
      document_role: args.previous.document_role,
      storage_path: args.storagePath,
      filename: args.filename,
      file_size: args.fileSize ?? null,
      mime_type: args.mimeType ?? null,
      category: args.previous.category,
      title: args.previous.title,
      description: args.previous.description,
      status: 'active' as DocumentStatus,
      is_protected: inheritedProtected,
      version: args.previous.version + 1,
      parent_document_id: args.previous.id,
      version_note: args.versionNote ?? null,
      uploaded_by: args.uploadedBy,
    },
    previousDocumentUpdate: {
      status: 'superseded' as DocumentStatus,
    },
  }
}

export function buildSoftDeleteDocumentUpdate(args: {
  deletedBy: string
  reason?: string | null
}) {
  return {
    status: 'archived' as DocumentStatus,
    deleted_at: new Date().toISOString(),
    deleted_by: args.deletedBy,
    deletion_reason: args.reason ?? null,
  }
}
