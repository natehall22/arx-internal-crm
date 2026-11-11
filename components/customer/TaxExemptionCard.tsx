'use client'

import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, toast } from '@/components/ui'

export type TaxExemptionInitial = {
  exempt: boolean
  reason: string | null
  certificateNumber: string | null
  documentId: string | null
}

/**
 * Customer File → Sales tax (billing staff only; the server refuses anyone else). An exempt customer is charged no
 * sales tax on new quotes and invoices. The certificate is one of this customer's files.
 */
export default function TaxExemptionCard({
  customerId,
  initial,
  documents,
  proposalWord = 'Quote',
}: {
  customerId: string
  initial: TaxExemptionInitial
  documents: Array<{ id: string; label: string }>
  /** The company's word for a quote (industry profile terms.proposal). */
  proposalWord?: string
}) {
  const quotes = `${proposalWord.toLowerCase()}s`
  const [exempt, setExempt] = useState(initial.exempt)
  const [reason, setReason] = useState(initial.reason ?? '')
  const [certificate, setCertificate] = useState(initial.certificateNumber ?? '')
  const [documentId, setDocumentId] = useState(initial.documentId ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/customers/${customerId}/tax-exemption`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tax_exempt: exempt,
        tax_exempt_reason: reason,
        tax_exempt_certificate_number: certificate,
        tax_exempt_document_id: documentId || null,
      }),
    }).catch(() => null)
    setSaving(false)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return toast.error((data as { error?: string }).error || 'Could not save')
    if (!exempt) {
      setReason('')
      setCertificate('')
      setDocumentId('')
    }
    toast.success(exempt ? 'Customer marked tax exempt' : 'Customer is charged sales tax')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales tax</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
          <input type="checkbox" className="h-5 w-5" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
          Tax exempt (no sales tax on new {quotes} and invoices)
        </label>
        {exempt && (
          <>
            <Input aria-label="Reason" placeholder="Reason, e.g. church, resale, government" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            <Input aria-label="Certificate number" placeholder="Certificate number" value={certificate} maxLength={80} onChange={(e) => setCertificate(e.target.value)} />
            <Select aria-label="Certificate file" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">{documents.length ? 'Certificate file (optional)' : 'No files on this customer yet'}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </Select>
          </>
        )}
        <p className="text-ui-sm text-ink">{proposalWord}s and invoices already sent keep the tax they were sent with.</p>
        <Button className="min-h-tap self-start" loading={saving} onClick={() => void save()}>Save</Button>
      </CardContent>
    </Card>
  )
}
