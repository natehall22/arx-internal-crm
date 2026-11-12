/**
 * Completion (server only): everything the engine does once a document is SIGNED, as ONE idempotent function that every
 * provider path ends in — our own signing pages (`completeEnvelope` is a named step of the contract's recovery path and a call
 * from the change-order route) and, later, a DocuSign webhook handing us the signed PDF (`recordProviderCompletion`).
 *
 *   events      signed / completed (+ consent) re-derived from what the document row itself stored, so a lost event is repaired
 *   SHA-256     of the signed PDF's stored bytes (set once)
 *   certificate its own PDF, stored beside the document (set once)
 *   filed       the signed copy + certificate on the customer as protected `signed_executed` documents (company switch `autoFile`)
 *   copies      the signed PDF + certificate to the rep and the company inbox (company switch `emails.signedCopy`, once)
 *
 * Every write is conditional on "still empty", so two requests running it at once (a double tap, a cron, the office's button)
 * produce one hash, one certificate, one filing, one set of copies. The signed PDF itself is never touched.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { renderCustomerEmail, type EmailCompany } from '@/lib/customer-email-layout'
import { newDocumentInsert } from '@/lib/files/documents'
import { getDocumentBrand, type DocumentBrand } from '@/lib/org-brand'
import { buildCertificatePdf } from '@/lib/signing/certificate'
import { ensureEnvelope, documentTitle, loadDocRow, patchEnvelope } from '@/lib/signing/envelope'
import { listSigningEvents, recordSigningEvent } from '@/lib/signing/events'
import { sha256Hex } from '@/lib/signing/hash'
import { sendSigningEmail } from '@/lib/signing/mail'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import type { EnvelopeRow, SigningKind } from '@/lib/signing/types'

type DocRow = Record<string, any>

export type CompleteResult =
  | { ok: true; skipped?: 'not_ready'; sha256?: string; certificatePath?: string }
  | { ok: false; reason: 'pdf_pending' | 'not_signed' | 'not_found' | 'error'; error?: string }

export function emailCompanyFromBrand(brand: DocumentBrand): EmailCompany {
  return { name: brand.name, phone: brand.phone, email: brand.email, website: brand.website, addressLine: brand.addressLine, logoUrl: null }
}

function storagePathOf(row: DocRow): string | null {
  return String(row.pdf_storage_path || row.pdf_url || '').trim() || null
}

async function download(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from('files').download(path)
  if (error || !data) return null
  return Buffer.from(await (data as Blob).arrayBuffer())
}

export async function completeEnvelope(
  admin: SupabaseClient,
  args: { kind: SigningKind; docId: string; orgId: string; /** Signed on the rep's own device (change order made in person). */ inPerson?: boolean }
): Promise<CompleteResult> {
  try {
    const row = await loadDocRow(admin, args.kind, args.orgId, args.docId)
    if (!row) return { ok: false, reason: 'not_found' }
    const signed = !!row.customer_signed_at && (row.status === 'completed' || row.status === 'voided')
    if (!signed) return { ok: false, reason: 'not_signed' }
    const path = storagePathOf(row)
    if (!path) return { ok: false, reason: 'pdf_pending' }

    const envOrNot = await ensureEnvelope(admin, args.kind, row)
    // Migration 202611200010 not applied: signing works as it always did; the evidence starts when it is.
    if (envOrNot === 'not_ready') return { ok: true, skipped: 'not_ready' }
    let env: EnvelopeRow = envOrNot

    const settings = await loadSigningSettings(admin, args.orgId)
    const brand = await getDocumentBrand(admin, args.orgId)

    // 1. Events the signer's own request produced, re-derived from the row (a request that died after saving the signature
    //    still leaves a complete record).
    const base = { org_id: env.org_id, envelope_id: env.id, doc_kind: args.kind, doc_id: env.doc_id }
    const signerName = String(row.customer_print_name || row.customer_name || '')
    if (row.consent_version) {
      await recordSigningEvent(admin, { ...base, event: 'consent_given', signer_key: 'customer', actor_type: 'signer', actor_name: signerName, ip: row.customer_ip ?? null, user_agent: row.customer_user_agent ?? null, consent_version: row.consent_version, created_at: row.consent_at ?? row.customer_signed_at })
    }
    await recordSigningEvent(admin, {
      ...base,
      event: 'signed',
      signer_key: 'customer',
      actor_type: args.inPerson ? 'staff' : 'signer',
      actor_name: signerName,
      actor_email: row.customer_email ?? null,
      ip: row.customer_ip ?? null,
      user_agent: row.customer_user_agent ?? null,
      consent_version: row.consent_version ?? null,
      created_at: row.customer_signed_at,
      meta: args.inPerson ? { inPerson: true } : {},
    })
    await recordSigningEvent(admin, { ...base, event: 'completed', actor_type: 'system', created_at: row.customer_signed_at })
    if (env.status !== 'completed') {
      env = (await patchEnvelope(admin, env, { status: 'completed', completed_at: row.customer_signed_at }, { status: ['sent', 'viewed'] })) ?? { ...env, status: 'completed' }
    }

    // 2. SHA-256 of the signed PDF (the bytes as stored). Set once.
    let sha = env.pdf_sha256
    if (!sha) {
      const bytes = await download(admin, path)
      if (!bytes) return { ok: false, reason: 'error', error: 'The signed PDF could not be read back from storage' }
      sha = sha256Hex(bytes)
      const hashedAt = new Date().toISOString()
      const documents = (env.documents?.length ? env.documents : [{ role: 'agreement', title: documentTitle(args.kind, row), storagePath: path, sha256: null }]).map((d) =>
        d.role === 'agreement' ? { ...d, storagePath: path, sha256: sha } : d
      )
      const patched = await patchEnvelope(admin, env, { pdf_sha256: sha, pdf_hashed_at: hashedAt, documents }, { isNull: 'pdf_sha256' })
      if (patched) env = patched
      else {
        // Another request set it first: its value is the record.
        const again = await ensureEnvelope(admin, args.kind, row)
        if (again !== 'not_ready') env = again
        sha = env.pdf_sha256 ?? sha
      }
    }

    // 3. The certificate. Set once.
    let certificatePath = env.certificate_path
    if (!certificatePath) {
      const events = await listSigningEvents(admin, args.orgId, env.id)
      const customerSigner = env.signers.find((s) => s.role === 'customer')
      const companySigner = env.signers.find((s) => s.role === 'company')
      const pdf = buildCertificatePdf({
        brand,
        certificateId: env.id,
        documentTitle: documentTitle(args.kind, row),
        documentNumber: args.kind === 'change-order' ? row.co_number ?? null : null,
        documentSha256: sha as string,
        hashedAt: env.pdf_hashed_at ?? new Date().toISOString(),
        provider: env.provider,
        providerRef: env.provider_ref,
        sentAt: env.sent_at,
        signers: env.signers.map((s) => (s.role === 'customer' ? { ...s, status: 'signed', signedAt: row.customer_signed_at, name: signerName || s.name } : s)),
        evidence: {
          customer: { ip: row.customer_ip ?? null, userAgent: row.customer_user_agent ?? null, consentVersion: row.consent_version ?? null, consentAt: row.consent_at ?? null },
          company: companySigner ? { ip: row.rep_ip ?? null } : undefined,
        },
        events: events.map((e) => ({ event: e.event, actor_type: e.actor_type, actor_name: e.actor_name, ip: e.ip, created_at: e.created_at, meta: e.meta })),
        generatedAt: new Date().toISOString(),
      })
      void customerSigner
      const certPath = `org/${args.orgId}/signing/${args.kind}/${args.docId}_certificate_${Date.now()}.pdf`
      const { error: uploadError } = await admin.storage.from('files').upload(certPath, pdf, { contentType: 'application/pdf', upsert: false })
      if (uploadError) return { ok: false, reason: 'error', error: `Certificate upload failed: ${uploadError.message}` }
      const certSha = sha256Hex(pdf)
      const documents = [
        ...(env.documents ?? []).filter((d) => d.role !== 'certificate'),
        { role: 'certificate' as const, title: `Certificate of completion — ${documentTitle(args.kind, row)}`, storagePath: certPath, sha256: certSha },
      ]
      const patched = await patchEnvelope(admin, env, { certificate_path: certPath, certificate_sha256: certSha, documents }, { isNull: 'certificate_path' })
      if (patched) {
        env = patched
        certificatePath = certPath
        await recordSigningEvent(admin, { ...base, event: 'certificate_issued', actor_type: 'system', meta: { sha256: certSha } })
      } else {
        const again = await ensureEnvelope(admin, args.kind, row)
        if (again !== 'not_ready') env = again
        certificatePath = env.certificate_path
      }
    }

    // 4. Filed on the customer.
    if (settings.autoFile && !env.filed_at) await fileOnCustomer(admin, { kind: args.kind, row, env, path, certificatePath, title: documentTitle(args.kind, row) })

    // 5. Copies to the rep and the company inbox.
    if (settings.emails.signedCopy && !env.copies_sent_at && certificatePath) await sendPartyCopies(admin, { kind: args.kind, row, env, path, certificatePath, brand, title: documentTitle(args.kind, row) })

    return { ok: true, sha256: sha ?? undefined, certificatePath: certificatePath ?? undefined }
  } catch (error) {
    console.error('[signing] completeEnvelope failed', error)
    return { ok: false, reason: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function customerIdFor(admin: SupabaseClient, kind: SigningKind, row: DocRow): Promise<string | null> {
  if (kind === 'contract' && row.opportunity_id) {
    const { data } = await admin.from('opportunities').select('customer_id').eq('id', row.opportunity_id).eq('org_id', row.org_id).maybeSingle()
    if ((data as { customer_id?: string | null } | null)?.customer_id) return (data as { customer_id: string }).customer_id
  }
  if (row.project_id || kind === 'contract') {
    const q = admin.from('projects').select('customer_id').eq('org_id', row.org_id)
    const { data } = row.project_id
      ? await q.eq('id', row.project_id).maybeSingle()
      : row.opportunity_id
        ? await q.eq('opportunity_id', row.opportunity_id).maybeSingle()
        : { data: null }
    return (data as { customer_id?: string | null } | null)?.customer_id ?? null
  }
  return null
}

/** The signed PDF + certificate as protected customer-level documents (same storage objects; nothing is copied). Once. */
async function fileOnCustomer(
  admin: SupabaseClient,
  a: { kind: SigningKind; row: DocRow; env: EnvelopeRow; path: string; certificatePath: string | null; title: string }
): Promise<void> {
  const customerId = await customerIdFor(admin, a.kind, a.row)
  if (!customerId) return // a deal with no customer yet: tried again by the next completion call
  const claimed = await patchEnvelope(admin, a.env, { filed_at: new Date().toISOString() }, { isNull: 'filed_at' })
  if (!claimed) return
  const linkedRecordType = a.kind === 'contract' ? 'contract' : 'change_order'
  const { data: existing } = await admin.from('documents').select('id, document_role, storage_path').eq('org_id', a.row.org_id).eq('linked_record_id', a.row.id)
  const have = (existing ?? []) as Array<{ document_role: string | null; storage_path: string }>
  const inserts: Array<Record<string, unknown>> = []
  const base = { orgId: a.row.org_id as string, jobId: null, customerId, linkedRecordType: linkedRecordType as 'contract' | 'change_order', linkedRecordId: a.row.id as string, category: 'contract', uploadedBy: (a.row.created_by ?? null) as string, mimeType: 'application/pdf' }
  if (!have.some((d) => d.document_role === 'signed_executed' && d.storage_path === a.path)) {
    inserts.push({ ...newDocumentInsert({ ...base, documentRole: 'signed_executed', storagePath: a.path, filename: `${a.title}.pdf`, title: `Signed — ${a.title}` }), is_protected: true })
  }
  if (a.certificatePath && !have.some((d) => d.storage_path === a.certificatePath)) {
    inserts.push({ ...newDocumentInsert({ ...base, documentRole: 'supporting_attachment', storagePath: a.certificatePath, filename: `${a.title} - certificate of completion.pdf`, title: `Certificate of completion — ${a.title}` }), is_protected: true })
  }
  if (inserts.length) {
    const { error } = await admin.from('documents').insert(inserts)
    if (error) {
      console.error('[signing] could not file the signed copy on the customer', error.message)
      await patchEnvelope(admin, a.env, { filed_at: null }) // released: the next completion call tries again
      return
    }
  }
  await recordSigningEvent(admin, { org_id: a.env.org_id, envelope_id: a.env.id, doc_kind: a.kind, doc_id: a.env.doc_id, event: 'filed', actor_type: 'system', meta: { customerId } })
}

async function partyEmails(admin: SupabaseClient, row: DocRow): Promise<string[]> {
  const out = new Set<string>()
  const customer = String(row.customer_email ?? '').trim().toLowerCase()
  if (row.created_by) {
    const { data } = await admin.from('users').select('email').eq('id', row.created_by).eq('org_id', row.org_id).maybeSingle()
    const e = String((data as { email?: string } | null)?.email ?? '').trim().toLowerCase()
    if (e) out.add(e)
  }
  const { data: org } = await admin.from('orgs').select('email').eq('id', row.org_id).maybeSingle()
  const oe = String((org as { email?: string } | null)?.email ?? '').trim().toLowerCase()
  if (oe) out.add(oe)
  out.delete(customer)
  return Array.from(out)
}

/** The signed PDF + certificate to the rep and the company inbox — once (claimed first, released if it could not be sent). */
async function sendPartyCopies(
  admin: SupabaseClient,
  a: { kind: SigningKind; row: DocRow; env: EnvelopeRow; path: string; certificatePath: string; brand: DocumentBrand; title: string }
): Promise<void> {
  const to = await partyEmails(admin, a.row)
  if (to.length === 0) return
  const claimed = await patchEnvelope(admin, a.env, { copies_sent_at: new Date().toISOString() }, { isNull: 'copies_sent_at' })
  if (!claimed) return
  const [pdf, cert] = await Promise.all([download(admin, a.path), download(admin, a.certificatePath)])
  if (!pdf || !cert) {
    await patchEnvelope(admin, a.env, { copies_sent_at: null })
    return
  }
  const who = String(a.row.customer_print_name || a.row.customer_name || 'The customer')
  const rendered = renderCustomerEmail({
    company: emailCompanyFromBrand(a.brand),
    heading: `${a.title} signed`,
    paragraphs: [`${who} signed ${a.title}. The signed PDF and its certificate of completion are attached.`],
    rows: [{ label: 'Project', value: String(a.row.project_address ?? '') }],
    unsubscribeUrl: null,
  })
  const ok = await sendSigningEmail({
    to,
    subject: `Signed: ${a.title} — ${who}`,
    text: rendered.text,
    html: rendered.html,
    attachments: [
      { filename: `${a.title}.pdf`, content: pdf, contentType: 'application/pdf' },
      { filename: `${a.title} - certificate of completion.pdf`, content: cert, contentType: 'application/pdf' },
    ],
  })
  if (!ok) {
    await patchEnvelope(admin, a.env, { copies_sent_at: null })
    return
  }
  await recordSigningEvent(admin, { org_id: a.env.org_id, envelope_id: a.env.id, doc_kind: a.kind, doc_id: a.env.doc_id, event: 'copy_sent', actor_type: 'system', meta: { to } })
}

/**
 * The signed PDF + certificate as email attachments for the CUSTOMER's signed-copy email — [] unless the company turned
 * `emails.signedCopy` on and the certificate exists. The email's subject and body are unchanged either way.
 */
export async function loadSignedAttachments(
  admin: SupabaseClient,
  args: { kind: SigningKind; docId: string; orgId: string }
): Promise<Array<{ filename: string; content: Buffer; contentType: string }>> {
  try {
    const settings = await loadSigningSettings(admin, args.orgId)
    if (!settings.emails.signedCopy) return []
    const row = await loadDocRow(admin, args.kind, args.orgId, args.docId)
    if (!row) return []
    const env = await ensureEnvelope(admin, args.kind, row)
    if (env === 'not_ready' || !env.certificate_path) return []
    const path = storagePathOf(row)
    if (!path) return []
    const [pdf, cert] = await Promise.all([download(admin, path), download(admin, env.certificate_path)])
    if (!pdf || !cert) return []
    const title = documentTitle(args.kind, row)
    return [
      { filename: `${title}.pdf`, content: pdf, contentType: 'application/pdf' },
      { filename: `${title} - certificate of completion.pdf`, content: cert, contentType: 'application/pdf' },
    ]
  } catch (error) {
    console.error('[signing] could not load signed attachments', error)
    return []
  }
}
