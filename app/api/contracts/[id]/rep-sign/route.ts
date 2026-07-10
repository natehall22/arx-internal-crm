import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { authUser, profile } = await requireAuthApi()
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, authUser.id, profile)) {
    return NextResponse.redirect(new URL('/dashboard', request.url), { status: 303 })
  }
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const formData = await request.formData()
  const repName = String(formData.get('rep_name') ?? '')
  const repTitle = String(formData.get('rep_title') ?? '')
  const paymentMethods = formData.getAll('payment_method').map((value) => String(value))
  const financeCompany = String(formData.get('finance_company') ?? '')
  const paymentOther = String(formData.get('payment_other') ?? '')
  const depositAmount = String(formData.get('deposit_amount') ?? '')
  const notes = String(formData.get('notes') ?? '')
  const exclusionsObservations = String(formData.get('exclusions_observations') ?? '')
  const additionalProducts = String(formData.get('additional_products') ?? '')
  const leadName = String(formData.get('lead_name') ?? '')
  const leadAddress = String(formData.get('lead_address') ?? '')
  const leadPhone = String(formData.get('lead_phone') ?? '')
  const leadEmail = String(formData.get('lead_email') ?? '')

  const { data: contract } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!contract) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  const signatureType = String(formData.get('signature_type') ?? 'typed')
  const signatureData = String(formData.get('signature_data') ?? '')
  const signatureTyped = String(formData.get('signature_typed') ?? '')
  const signatureValue =
    signatureType === 'draw' && signatureData ? signatureData : signatureTyped || repName

  await serviceSupabase.from('contract_signatures').insert({
    org_id: profile.org_id,
    contract_id: contract.id,
    role: 'rep',
    signed_name: repName || profile.full_name,
    signed_title: repTitle || null,
    signed_email: profile.email ?? null,
    signature_type: signatureType,
    signature_data: signatureValue,
    signed_ip: null,
    signed_user_agent: null,
    signed_location_text: 'Rep signature',
  })

  const { data: updated } = await serviceSupabase
    .from('contracts')
    .update({
      status: 'rep_signed',
      rep_signed_at: new Date().toISOString(),
      contract_payload: {
        customer_name: leadName,
        project_address: leadAddress,
        phone: leadPhone,
        email: leadEmail,
        payment_method: paymentMethods,
        finance_company: financeCompany,
        payment_other: paymentOther,
        deposit_amount: depositAmount,
        notes,
        exclusions_observations: exclusionsObservations,
        additional_products: additionalProducts,
      },
    })
    .eq('id', contract.id)
    .select('project_id')
    .single()

  const projectId = updated?.project_id || contract.project_id
  return NextResponse.redirect(new URL(`/projects/${projectId}?repSigned=1`, request.url), {
    status: 303,
  })
}
