import { createHash } from 'crypto'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export default async function AgreementReceiptPage({ params }: { params: { token: string } }) {
  const hash = createHash('sha256').update(params.token).digest('hex')
  const admin = createServiceClient()
  const { data } = await admin.from('employee_comp_agreements').select('rep_signed_name, rep_signed_at, agreement_version, agreement_content_hash, receipt_expires_at').eq('receipt_token_hash', hash).eq('status', 'rep_signed').maybeSingle()
  if (!data || !data.receipt_expires_at || new Date(data.receipt_expires_at).getTime() < Date.now()) notFound()
  return <main className="min-h-screen bg-gray-100 px-4 py-16"><div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-700 text-2xl font-bold text-white">✓</div><p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-green-700">ARX Roofing &amp; Exteriors</p><h1 className="mt-2 text-2xl font-bold">Agreement signed</h1><p className="mt-3 text-gray-600">Thank you, {data.rep_signed_name}. Your compensation agreement was signed on {new Date(data.rep_signed_at).toLocaleString()}.</p><dl className="mt-6 rounded-lg bg-gray-50 p-4 text-left text-sm"><div className="flex justify-between gap-4"><dt>Agreement version</dt><dd className="font-medium">{data.agreement_version}</dd></div><div className="mt-2"><dt>Document fingerprint</dt><dd className="mt-1 break-all font-mono text-xs text-gray-600">{data.agreement_content_hash}</dd></div></dl><p className="mt-5 text-xs text-gray-500">This confirmation link expires in one hour. Your hiring manager can access the permanent CRM record.</p></div></main>
}
