export const dynamic = 'force-dynamic'

import SignerFlow, { type SignerField } from '@/components/signing/SignerFlow'
import { getDocumentBrand } from '@/lib/org-brand'
import { esignDisclosure } from '@/lib/signing/consent'
import { findSignerByToken, requestExpired } from '@/lib/signing/requests/db'
import { canSignNow, signingWave } from '@/lib/signing/requests/types'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { createServiceClient } from '@/lib/supabase/service'

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center text-[#2c2c2a] shadow-lg">
        <h1 className="mb-2 text-xl font-bold">{title}</h1>
        <p className="text-base">{body}</p>
      </div>
    </div>
  )
}

/** A signer's own link: /sign/<token>. Public (the token is the credential), host-fenced, company brand only. */
export default async function SignPage({ params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const found = await findSignerByToken(admin, params.token)
  if (!found) return <Message title="Link not found" body="This signing link is not valid. Please ask the sender for a new one." />
  const { signer, request, signers, fields } = found
  const brand = await getDocumentBrand(admin, request.org_id)
  if (request.status === 'voided') return <Message title="No longer open" body={`${brand.name} cancelled this document. Please contact them if you have questions.`} />
  if (request.status === 'declined') return <Message title="Not signed" body={`This document was declined, so it is closed. Please contact ${brand.name}.`} />
  if (request.status === 'pending' && signer.status !== 'signed' && requestExpired(request)) return <Message title="This link has expired" body={`Please ask ${brand.name} to send you a new one.`} />

  const settings = await loadSigningSettings(admin, request.org_id)
  const roleLabels = new Map(signers.map((s) => [s.role_key, s.role_label]))
  const view: SignerField[] = fields.map((f) => ({ id: f.id, roleKey: f.role_key, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, ...(f.label ? { label: f.label } : {}), mine: f.role_key === signer.role_key, roleLabel: roleLabels.get(f.role_key) ?? '' }))
  const turn = request.status === 'pending' && signer.status !== 'signed' ? canSignNow(request.signing_order, signers, signer.id) : true
  const earlier = signers.filter((s) => signingWave(request.signing_order, s, signers) < signingWave(request.signing_order, signer, signers) && s.status !== 'signed').sort((a, b) => a.order_index - b.order_index)[0]
  return (
    <SignerFlow
      token={params.token}
      title={request.title}
      companyName={brand.name}
      signerName={signer.name}
      roleLabel={signer.role_label}
      fields={view}
      consent={settings.consentStep ? esignDisclosure({ name: brand.name, phone: brand.phone, email: brand.email }) : null}
      declineEnabled={settings.declineEnabled}
      alreadySigned={signer.status === 'signed'}
      completed={request.status === 'completed'}
      waitingFor={!turn && earlier ? earlier.role_label : null}
    />
  )
}
