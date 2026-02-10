import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(request: Request) {
  const formData = await request.formData()
  const token = String(formData.get('token') ?? '')
  const name = String(formData.get('name') ?? '')
  const email = String(formData.get('email') ?? '')
  const agree = String(formData.get('agree') ?? '')
  const signatureType = String(formData.get('signature_type') ?? '')
  const signatureData = String(formData.get('signature_data') ?? '')
  const signatureTyped = String(formData.get('signature_typed') ?? '')
  const initialsType = String(formData.get('initials_type') ?? '')
  const initialsData = String(formData.get('initials_data') ?? '')
  const initialsTyped = String(formData.get('initials_typed') ?? '')

  if (!token || !name || !email || agree !== 'yes') {
    return NextResponse.redirect(new URL(`/contracts/${token}`, request.url), { status: 303 })
  }

  const serviceSupabase = createServiceClient()
  const { data: contract } = await serviceSupabase
    .from('contracts')
    .select('*')
    .eq('token', token)
    .single()

  if (!contract) {
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  }

  if (contract.status !== 'rep_signed' && contract.status !== 'customer_signed') {
    return NextResponse.redirect(new URL(`/contracts/${token}`, request.url), {
      status: 303,
    })
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const signedIp = forwardedFor ? forwardedFor.split(',')[0] : null
  const signedLocationText = signedIp ? `IP: ${signedIp}` : null
  const userAgent = request.headers.get('user-agent')

  const signatureValue =
    signatureType === 'draw' && signatureData ? signatureData : signatureTyped || name
  const initialsValue =
    initialsType === 'draw' && initialsData ? initialsData : initialsTyped || ''

  await serviceSupabase.from('contract_signatures').insert({
    org_id: contract.org_id,
    contract_id: contract.id,
    role: 'customer',
    signed_name: name,
    signed_email: email,
    signature_type: signatureType || 'typed',
    signature_data: JSON.stringify({
      signature: { type: signatureType || 'typed', value: signatureValue },
      initials: { type: initialsType || 'typed', value: initialsValue },
    }),
    signed_ip: signedIp,
    signed_user_agent: userAgent,
    signed_location_text: signedLocationText,
  })

  await serviceSupabase
    .from('contracts')
    .update({
      status: 'fully_signed',
      customer_signed_at: new Date().toISOString(),
      signed_at: new Date().toISOString(),
      signed_name: name,
      signed_email: email,
      signed_ip: signedIp,
      signed_user_agent: userAgent,
      signed_location_text: signedLocationText,
    })
    .eq('id', contract.id)

  const { data: project } = await serviceSupabase
    .from('projects')
    .select('*, leads(*)')
    .eq('id', contract.project_id)
    .single()

  if (project) {
    let customerId = project.customer_id
    if (!customerId) {
      const lead = project.leads
      const { data: customer } = await serviceSupabase
        .from('customers')
        .insert({
          org_id: project.org_id,
          name: lead?.homeowner_name ?? null,
          phone: lead?.phone ?? null,
          email: lead?.email ?? null,
          address_text: lead?.address_text ?? null,
        })
        .select('*')
        .single()

      customerId = customer?.id ?? null
    }

    await serviceSupabase
      .from('projects')
      .update({ contract_uploaded_at: new Date().toISOString(), customer_id: customerId })
      .eq('id', project.id)

    if (project.lead_id) {
      await serviceSupabase
        .from('leads')
        .update({ status: 'won' })
        .eq('id', project.lead_id)
    }
  }

  return NextResponse.redirect(new URL(`/contracts/${token}`, request.url), { status: 303 })
}
