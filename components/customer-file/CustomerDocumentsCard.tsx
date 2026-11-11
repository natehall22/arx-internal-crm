'use client'

import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, FileDropZone, Field, Select, toast } from '@/components/ui'
import { CUSTOMER_DOCUMENT_CATEGORIES } from '@/lib/customer-document-categories'
import { formatDate } from '@/lib/format'
import { multipartFilenameForUpload } from '@/lib/files/storage'
import { createClientBrowser } from '@/lib/supabase/client'

export type CustomerDocumentItem = {
  id: string
  title: string | null
  filename: string
  category: string
  property_id: string | null
  created_at: string
}

type PropertyOption = { id: string; name: string }

const categoryLabel = (v: string) => CUSTOMER_DOCUMENT_CATEGORIES.find((c) => c.value === v)?.label ?? 'Document'

/**
 * Customer File → Files → "Customer documents": contracts and papers filed on the customer (and optionally a property),
 * with no job. Upload = drag and drop or the picker; each file goes register → straight to storage → finalize
 * (/api/customers/[id]/documents), the same flow as job documents. A company that never files one sees only a small
 * "Add a customer document" button.
 */
export default function CustomerDocumentsCard({
  customerId,
  initial,
  canUpload,
  properties,
}: {
  customerId: string
  initial: CustomerDocumentItem[]
  canUpload: boolean
  properties: PropertyOption[]
}) {
  const [docs, setDocs] = React.useState(initial)
  const [open, setOpen] = React.useState(initial.length > 0)
  const [category, setCategory] = React.useState<string>('contract')
  const [propertyId, setPropertyId] = React.useState<string>('')
  const [busy, setBusy] = React.useState<string | null>(null)

  async function refresh() {
    const res = await fetch(`/api/customers/${customerId}/documents`, { cache: 'no-store' }).catch(() => null)
    const data = (res ? await res.json().catch(() => ({})) : {}) as { documents?: CustomerDocumentItem[] }
    if (res?.ok && Array.isArray(data.documents)) setDocs(data.documents)
  }

  async function uploadOne(file: File, i: number): Promise<string | null> {
    const json = async (url: string, body: unknown) => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Upload failed')
      return data
    }
    try {
      const reg = await json(`/api/customers/${customerId}/documents`, {
        filename: multipartFilenameForUpload(file, `document_${i + 1}`),
        propertyId: propertyId || null,
      })
      const { error } = await createClientBrowser()
        .storage.from(String(reg.bucket))
        .uploadToSignedUrl(String(reg.storagePath), String(reg.signedUploadToken), file, { contentType: file.type || 'application/octet-stream' })
      if (error) throw new Error(error.message)
      await json(`/api/customers/${customerId}/documents/finalize`, {
        documentId: reg.documentId,
        category,
        title: file.name.replace(/\.[^.]+$/, '') || file.name,
        propertyId: propertyId || null,
        mime_type: file.type || null,
        file_size: file.size,
      })
      return null
    } catch (e) {
      return `${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`
    }
  }

  async function upload(files: File[]) {
    let failed: string | null = null
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`)
      failed = (await uploadOne(files[i], i)) ?? failed
    }
    setBusy(null)
    await refresh()
    if (failed) toast.error(failed)
    else toast.success(files.length === 1 ? 'Document added' : `${files.length} documents added`)
  }

  if (!open && docs.length === 0) {
    return canUpload ? (
      <Button type="button" variant="ghost" className="px-0 text-brand-800 underline" onClick={() => setOpen(true)}>
        + Add a customer document
      </Button>
    ) : null
  }

  const propName = (id: string | null) => (id ? properties.find((p) => p.id === id)?.name ?? null : null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer documents</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-ui-base text-ink">Contracts and papers for this customer that aren’t tied to one job.</p>
        {docs.length === 0 ? (
          <p className="text-ui-base text-ink">No customer documents yet.</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-ui-base font-semibold text-ink">{d.title || d.filename}</p>
                  <p className="text-ui-sm text-ink">
                    {categoryLabel(d.category)} · {formatDate(d.created_at)}
                    {propName(d.property_id) ? ` · ${propName(d.property_id)}` : ''}
                  </p>
                </div>
                <a
                  href={`/api/customers/${customerId}/documents/${d.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-tap items-center text-ui-sm font-semibold text-brand-800 underline"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        )}
        {canUpload ? (
          <div className="flex flex-col gap-3 border-t border-surface-line pt-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Document type">
                {(p) => (
                  <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)} className="text-base">
                    {CUSTOMER_DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {properties.length > 0 ? (
                <Field label="Property (optional)">
                  {(p) => (
                    <Select {...p} value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="text-base">
                      <option value="">Whole account</option>
                      {properties.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
            </div>
            <FileDropZone disabled={busy !== null} label={busy ?? 'Drop files here or tap to choose'} hint="PDFs, photos or any file" onFiles={(f) => void upload(f)} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
