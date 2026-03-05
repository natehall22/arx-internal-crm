import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import nodemailer from 'nodemailer'

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuth()
    const supabase = createServiceClient()
    const body = await request.json()

    const {
      opportunityId,
      proposalId,
      customerName,
      customerEmail,
      customerPhone,
      projectAddress,
      projectCost,
      totalSquares,
      roofingMaterial,
      scopeRoofReplacement,
      scopeRoofRepair,
      scopeGutters,
      scopeSiding,
      scopeOther,
      paymentMethod,
      financeCompany,
      depositAmount,
      estCompletionDate,
      exclusions,
      additionalProducts,
      notes,
      repName,
      repTitle,
      repSignature,
    } = body

    if (!customerName || !projectAddress || !projectCost) {
      return NextResponse.json(
        { error: 'Customer name, project address, and project cost are required' },
        { status: 400 }
      )
    }

    if (!repName || !repSignature) {
      return NextResponse.json(
        { error: 'Representative name and signature are required' },
        { status: 400 }
      )
    }

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    const { data: contract, error: insertError } = await supabase
      .from('order_form_contracts')
      .insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId || null,
        proposal_id: proposalId || null,
        customer_name: customerName,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        project_address: projectAddress,
        project_cost: projectCost,
        total_squares: totalSquares || null,
        roofing_material: roofingMaterial || null,
        scope_roof_replacement: scopeRoofReplacement || false,
        scope_roof_repair: scopeRoofRepair || false,
        scope_gutters: scopeGutters || false,
        scope_siding: scopeSiding || false,
        scope_other: scopeOther || null,
        payment_method: paymentMethod || 'cash',
        finance_company: financeCompany || null,
        deposit_amount: depositAmount || 0,
        est_completion_date: estCompletionDate || null,
        exclusions: exclusions || null,
        additional_products: additionalProducts || null,
        notes: notes || null,
        rep_name: repName,
        rep_title: repTitle || 'Sales Representative',
        rep_signature_data: repSignature,
        rep_signed_at: new Date().toISOString(),
        rep_ip: clientIp,
        status: 'pending_customer',
        created_by: profile.id,
      })
      .select('id, signing_token')
      .single()

    if (insertError) {
      console.error('Error creating contract:', insertError)
      return NextResponse.json(
        { error: 'Failed to create contract' },
        { status: 500 }
      )
    }

    const signingUrl = `${process.env.NEXT_PUBLIC_APP_URL}/contracts/sign/${contract.signing_token}`

    if (customerEmail) {
      try {
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
          from: process.env.SMTP_FROM || 'ARX Roofing <noreply@arxroofing.com>',
          to: customerEmail,
          subject: 'ARX Roofing & Exteriors - Contract Ready for Signature',
          text: `Dear ${customerName},

Your contract from ARX Roofing & Exteriors is ready for your signature.

Please click the link below to review and sign your contract:
${signingUrl}

This link will expire in 7 days.

Project Details:
- Address: ${projectAddress}
- Project Cost: $${projectCost.toLocaleString()}

If you have any questions, please contact us at:
Phone: 704-313-8834
Email: info@arxroofing.com

Thank you for choosing ARX Roofing & Exteriors!

Best regards,
${repName}
ARX Roofing & Exteriors LLC`,
          html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e3a5f; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .button { display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .details { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">ARX ROOFING & EXTERIORS LLC</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Contract Ready for Signature</p>
    </div>
    <div class="content">
      <p>Dear ${customerName},</p>
      <p>Your contract from ARX Roofing & Exteriors is ready for your signature.</p>
      
      <div class="details">
        <strong>Project Details:</strong><br>
        Address: ${projectAddress}<br>
        Project Cost: $${projectCost.toLocaleString()}
      </div>
      
      <p style="text-align: center;">
        <a href="${signingUrl}" class="button">Review & Sign Contract</a>
      </p>
      
      <p style="font-size: 14px; color: #666;">This link will expire in 7 days.</p>
      
      <p>If you have any questions, please contact us:</p>
      <p>
        Phone: 704-313-8834<br>
        Email: info@arxroofing.com
      </p>
      
      <p>Thank you for choosing ARX Roofing & Exteriors!</p>
      <p>Best regards,<br>${repName}<br>ARX Roofing & Exteriors LLC</p>
    </div>
    <div class="footer">
      <p>ARX Roofing & Exteriors LLC<br>
      4101 Woodbury Terrace NW, Concord, NC 28027<br>
      arxroofing.com</p>
    </div>
  </div>
</body>
</html>
          `,
        })
      } catch (emailError) {
        console.error('Error sending contract email:', emailError)
      }
    }

    if (opportunityId) {
      await supabase.from('activities').insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId,
        user_id: profile.id,
        type: 'note',
        body: `Contract created and sent to ${customerEmail || 'customer'}. Signing link: ${signingUrl}`,
      })
    }

    return NextResponse.json({
      success: true,
      contractId: contract.id,
      signingToken: contract.signing_token,
      signingUrl,
    })
  } catch (error) {
    console.error('Contract create error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create contract' },
      { status: 500 }
    )
  }
}
