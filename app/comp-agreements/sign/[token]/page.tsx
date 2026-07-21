import { createHash } from 'crypto'
import { notFound } from 'next/navigation'
import AgreementDocument from '@/components/employee-agreements/AgreementDocument'
import { createServiceClient } from '@/lib/supabase/service'
import type { EmployeeAgreementTemplate } from '@/lib/employee-comp-agreements'

export const dynamic = 'force-dynamic'

export default async function EmployeeAgreementSigningPage({ params, searchParams }: { params: { token: string }; searchParams: { error?: string } }) {
  const admin = createServiceClient()
  const tokenHash = createHash('sha256').update(params.token).digest('hex')
  const { data } = await admin.from('employee_comp_agreements').select('id, agreement_snapshot, status, token_expires_at, manager_signed_name, manager_signed_at').eq('signing_token_hash', tokenHash).maybeSingle()
  if (!data) notFound()
  const snapshot = data.agreement_snapshot as EmployeeAgreementTemplate & { employeeName: string; employeeEmail: string; effectiveDate: string }
  const expired = !data.token_expires_at || new Date(data.token_expires_at).getTime() < Date.now()
  const signable = data.status === 'sent' && !expired
  return <main className="min-h-screen bg-gray-100 px-4 py-10"><div className="mx-auto max-w-4xl"><div className="mb-5 rounded-xl bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.18em] text-green-700">ARX Roofing &amp; Exteriors</p><h1 className="mt-1 text-2xl font-bold">Compensation agreement</h1>{expired ? <p className="mt-2 text-red-700">This signing link has expired. Contact your hiring manager for a new link.</p> : signable ? <p className="mt-2 text-gray-600">Review the complete agreement below, then sign at the bottom.</p> : <p className="mt-2 text-amber-700">This agreement is not currently available for signature.</p>}</div>{!expired && <AgreementDocument agreement={snapshot} employeeName={snapshot.employeeName} effectiveDate={snapshot.effectiveDate} />}<div className="mt-5 rounded-xl border bg-white p-6 shadow-sm"><p className="text-sm text-gray-600">Manager signed by <strong>{data.manager_signed_name}</strong> on {new Date(data.manager_signed_at).toLocaleString()}.</p>{searchParams.error && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{searchParams.error}</p>}{signable && <form action={`/api/comp-agreements/sign/${params.token}`} method="POST" className="mt-5 space-y-4"><div><label htmlFor="signedName" className="mb-1 block text-sm font-medium">Type your full legal name</label><input id="signedName" name="signedName" required defaultValue={snapshot.employeeName} className="w-full rounded-lg border px-3 py-2 text-lg italic" /></div><label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" value="yes" required className="mt-1" /><span>I have reviewed this agreement and intend my typed name to be my electronic signature.</span></label><button type="submit" className="rounded-lg bg-green-700 px-5 py-3 font-semibold text-white hover:bg-green-800">Sign agreement</button></form>}</div></div></main>
}
