import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

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
  const formData = await request.formData()
  const email = String(formData.get('email') ?? '')

  if (!email) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, token, project_id, org_id')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!contract?.token) {
    return NextResponse.redirect(new URL('/projects', request.url), { status: 303 })
  }

  const signingUrl = `${process.env.NEXT_PUBLIC_APP_URL}/contracts/${contract.token}`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Please sign your contract',
    text: `Please review and sign your contract: ${signingUrl}`,
    html: `<p>Please review and sign your contract:</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
  })

  await supabase
    .from('contracts')
    .update({ sent_to_email: email, sent_at: new Date().toISOString() })
    .eq('id', contract.id)

  return NextResponse.redirect(new URL(`/projects/${contract.project_id}`, request.url), {
    status: 303,
  })
}
