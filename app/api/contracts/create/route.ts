import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import nodemailer from 'nodemailer'

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const body = await request.json()

    const {
      opportunityId,
      proposalId,
      agreementType,
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

    const safeAgreementType =
      agreementType === 'contingency'
        ? 'contingency'
        : agreementType === 'repair'
          ? 'repair'
          : 'installation'
    const safeProjectCost = safeAgreementType === 'contingency' ? 0 : Number(projectCost || 0)
    const safeDepositAmount = safeAgreementType === 'contingency' ? 0 : Number(depositAmount || 0)
    const safePaymentMethod = safeAgreementType === 'contingency' ? 'insurance' : (paymentMethod || 'cash')
    const safeTotalSquares =
      safeAgreementType === 'contingency' || safeAgreementType === 'repair'
        ? null
        : (totalSquares || null)
    const safeRoofingMaterial =
      safeAgreementType === 'contingency' || safeAgreementType === 'repair'
        ? null
        : (roofingMaterial || null)
    const safeEstCompletionDate = safeAgreementType === 'contingency' ? null : (estCompletionDate || null)
    const safeExclusions = safeAgreementType === 'contingency' ? null : (exclusions || null)
    const safeAdditionalProducts =
      safeAgreementType === 'contingency' || safeAgreementType === 'repair'
        ? null
        : (additionalProducts || null)
    const agreementLabel =
      safeAgreementType === 'contingency'
        ? 'Insurance Contingency Agreement'
        : safeAgreementType === 'repair'
          ? 'Repair Agreement'
          : 'Installation Agreement'

    const needsProjectPrice = safeAgreementType === 'installation' || safeAgreementType === 'repair'
    if (!customerName || !projectAddress || (needsProjectPrice && !safeProjectCost)) {
      return NextResponse.json(
        {
          error: needsProjectPrice
            ? 'Customer name, project address, and project cost are required'
            : 'Customer name and project address are required',
        },
        { status: 400 }
      )
    }

    if (!repName || !repSignature) {
      return NextResponse.json(
        { error: 'Representative name and signature are required' },
        { status: 400 }
      )
    }

    // Delete any existing pending contracts for this opportunity
    if (opportunityId) {
      const { error: deleteError } = await supabase
        .from('order_form_contracts')
        .delete()
        .eq('opportunity_id', opportunityId)
        .eq('agreement_type', safeAgreementType)
        .eq('status', 'pending_customer')

      if (deleteError) {
        console.error('Error deleting existing pending contracts:', deleteError)
      } else {
        console.log('Deleted existing pending contracts for opportunity:', opportunityId)
      }
    }

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    const { data: contract, error: insertError } = await supabase
      .from('order_form_contracts')
      .insert({
        org_id: profile.org_id,
        agreement_type: safeAgreementType,
        opportunity_id: opportunityId || null,
        proposal_id: proposalId || null,
        customer_name: customerName,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        project_address: projectAddress,
        project_cost: safeProjectCost,
        total_squares: safeTotalSquares,
        roofing_material: safeRoofingMaterial,
        scope_roof_replacement: scopeRoofReplacement || false,
        scope_roof_repair: scopeRoofRepair || false,
        scope_gutters: scopeGutters || false,
        scope_siding: scopeSiding || false,
        scope_other: scopeOther || null,
        payment_method: safePaymentMethod,
        finance_company:
          safeAgreementType === 'installation' || safeAgreementType === 'repair'
            ? (financeCompany || null)
            : null,
        deposit_amount: safeDepositAmount,
        est_completion_date: safeEstCompletionDate,
        exclusions: safeExclusions,
        additional_products: safeAdditionalProducts,
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
          subject: `ARX Roofing - Your ${agreementLabel} is Ready to Sign`,
          text: `Hi ${customerName},

Your ${agreementLabel} is ready. Please review and sign it using the link below:

${signingUrl}

Project: ${projectAddress}
${safeAgreementType !== 'contingency' ? `Amount: $${safeProjectCost.toLocaleString()}` : 'Amount: Not required until final Installation Agreement'}

This link expires in 7 days.

Questions? Call 704-313-8834 or email info@arxroofing.com

- ${repName}, ARX Roofing & Exteriors`,
          html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">

<tr><td style="background:#1e3a5f;padding:20px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:20px;">ARX ROOFING & EXTERIORS</h1>
</td></tr>

<tr><td style="padding:30px 30px 20px 30px;">
<p style="margin:0 0 15px 0;font-size:16px;color:#333;">Hi ${customerName},</p>
<p style="margin:0 0 25px 0;font-size:16px;color:#333;">Your ${agreementLabel} is ready for signature. Click below to review and sign:</p>
</td></tr>

<tr><td align="center" style="padding:0 30px 25px 30px;">
<table cellpadding="0" cellspacing="0"><tr>
<td style="background:#22c55e;border-radius:6px;padding:14px 32px;">
<a href="${signingUrl}" style="color:#ffffff;text-decoration:none;font-size:18px;font-weight:bold;display:block;">Review & Sign Agreement</a>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0 30px 20px 30px;">
<table width="100%" cellpadding="12" cellspacing="0" style="background:#f9f9f9;border-radius:6px;">
<tr><td style="font-size:14px;color:#666;">
<strong style="color:#333;">Project:</strong> ${projectAddress}<br>
<strong style="color:#333;">Agreement:</strong> ${agreementLabel}<br>
<strong style="color:#333;">Amount:</strong> ${safeAgreementType !== 'contingency' ? `$${safeProjectCost.toLocaleString()}` : 'Not required until final Installation Agreement'}
</td></tr>
</table>
</td></tr>

<tr><td style="padding:0 30px 25px 30px;">
<p style="margin:0;font-size:13px;color:#999;">This link expires in 7 days.</p>
</td></tr>

<tr><td style="padding:20px 30px;border-top:1px solid #eee;font-size:13px;color:#666;">
Questions? <strong>704-313-8834</strong> or <a href="mailto:info@arxroofing.com" style="color:#1e3a5f;">info@arxroofing.com</a><br><br>
${repName}<br>ARX Roofing & Exteriors LLC
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
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
        body: `${agreementLabel} created and sent to ${customerEmail || 'customer'}. Signing link: ${signingUrl}`,
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
