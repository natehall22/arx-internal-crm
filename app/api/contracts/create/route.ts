import { NextRequest, NextResponse } from 'next/server'
import { orgAppUrl } from '@/lib/company-links'
import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'
import {
  saveDealSaleCredit,
  loadDealSaleCredit,
  diffSaleCredit,
  SALE_CREDIT_EDIT_ROLES,
  type SaleCreditChange,
} from '@/lib/deal-sale-credit'
import { isSuperAdmin } from '@/lib/super-admin'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildContractReadyEmail } from '@/lib/contracts/customer-emails'
import { getDocumentBrand } from '@/lib/org-brand'

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = auth
  try {

    if (await resolveSalesDocAccessBarred(createServiceClient(), authUser.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
      saleCredit,
    } = body

    const safeAgreementType =
      agreementType === 'contingency'
        ? 'contingency'
        : agreementType === 'repair'
          ? 'repair'
          : 'installation'
    // Insurance switched off for the company (Settings → Features): no contingency agreement, no insurance payment.
    if (safeAgreementType === 'contingency' || paymentMethod === 'insurance') {
      const featureOff = await orgFeatureOffResponse(profile.org_id, 'insurance')
      if (featureOff) return featureOff
    }
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

    // The opportunity id comes from the request: confirm it is this org's before anything below
    // writes against it (sale credit, voiding pending contracts, the new contract row).
    if (opportunityId) {
      const { data: opportunity } = await supabase
        .from('opportunities')
        .select('id')
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (!opportunity) {
        return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
      }
    }
    if (proposalId) {
      const { data: proposal } = await supabase
        .from('proposals')
        .select('id')
        .eq('id', proposalId)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (!proposal) {
        return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
      }
    }

    // Sale credit (closer / setter / self-generated) is confirmed here, on the signing screen,
    // and saved with the deal before the agreement goes out. Once a sale agreement is signed
    // the same writer only lets an owner change it (lib/deal-sale-credit.ts).
    if (opportunityId && needsProjectPrice && saleCredit && typeof saleCredit === 'object') {
      const next: SaleCreditChange = {}
      if ('closerUserId' in saleCredit) next.closerUserId = saleCredit.closerUserId || null
      if ('setterUserId' in saleCredit) next.setterUserId = saleCredit.setterUserId || null
      if (typeof saleCredit.isSelfGenerated === 'boolean') next.isSelfGenerated = saleCredit.isSelfGenerated
      if (!next.closerUserId) {
        return NextResponse.json({ error: 'Pick who closed this sale.' }, { status: 400 })
      }
      // Anyone who can send a contract may CONFIRM the stored credit; only owners (or a super
      // admin) may change it — otherwise a rep could credit themselves before signing.
      if (!SALE_CREDIT_EDIT_ROLES.has(String(profile.role || '').toLowerCase()) && !isSuperAdmin(profile)) {
        const stored = await loadDealSaleCredit(supabase, profile.org_id, opportunityId)
        const changes = stored ? diffSaleCredit(stored.credit, next) : next
        if (Object.keys(changes).length > 0) {
          return NextResponse.json(
            { error: 'Only an owner or admin can change who gets credit for this sale.' },
            { status: 403 }
          )
        }
      }
      const savedCredit = await saveDealSaleCredit(supabase, {
        orgId: profile.org_id,
        opportunityId,
        actor: profile,
        next,
        reason: typeof saleCredit.reason === 'string' ? saleCredit.reason : null,
      })
      if (!savedCredit.ok) {
        return NextResponse.json({ error: savedCredit.error }, { status: savedCredit.status })
      }
    }

    // Supersede any unsigned contract still out with the customer. Voided, not deleted:
    // it keeps a record of what was sent, and its signing link stops working because
    // /contracts/sign rejects voided contracts.
    if (opportunityId) {
      const { error: voidError } = await supabase
        .from('order_form_contracts')
        .update({ status: 'voided', updated_at: new Date().toISOString() })
        .eq('opportunity_id', opportunityId)
        .eq('agreement_type', safeAgreementType)
        .eq('status', 'pending_customer')

      if (voidError) {
        console.error('Error voiding existing pending contracts:', voidError)
      }
    }

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Checked before the row is written: a contract with no working signing link must not be created.
    const appUrl = await orgAppUrl(supabase, profile.org_id)

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
        // Only a finance deal has a lender. The modal pre-fills the proposal's lender and keeps it
        // when the rep switches to insurance/cash, which printed "Insurance (Sunlight Financial)".
        finance_company:
          (safeAgreementType === 'installation' || safeAgreementType === 'repair') && safePaymentMethod === 'finance'
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

    const signingUrl = `${appUrl}/contracts/sign/${contract.signing_token}`

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

        const email = buildContractReadyEmail({
          brand: await getDocumentBrand(supabase, profile.org_id),
          agreementLabel,
          customerName,
          signingUrl,
          projectAddress,
          isContingency: safeAgreementType === 'contingency',
          projectCost: safeProjectCost,
          repName,
        })
        await transporter.sendMail({
          from: getCrmEmailFrom(),
          to: customerEmail,
          subject: email.subject,
          text: email.text,
          html: email.html,
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
