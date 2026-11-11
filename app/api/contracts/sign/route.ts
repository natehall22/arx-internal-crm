import { NextRequest, NextResponse } from 'next/server'
import { tryOrgAppUrl } from '@/lib/company-links'
import { customerSignedDocLinkForPage, customerSignedDocUrl } from '@/lib/files/files-object'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { buildContractSignedEmail } from '@/lib/contracts/customer-emails'
import { getDocumentBrand } from '@/lib/org-brand'
import { buildOrderFormContractSaleDescription, notifyOrgAdminsOfSale } from '@/lib/admin-sale-email'
import { syncJobSaleForProjectOrJob } from '@/lib/job-commission-base'
import { enrichCustomerFromContract, resolveCustomerDisplayName, upsertCustomer } from '@/lib/customers'
import { resolveProposalSoldRoofSquares } from '@/lib/sold-roof-squares'
import { createServiceClient } from '@/lib/supabase/service'
import { reinstateCancelledJob } from '@/lib/job-cancellation'
import { applyContractSignedStatuses } from '@/lib/job-status-events'
import { depositRequiredFraction } from '@/lib/job-pipeline'
import { ensureContractPdf } from '@/lib/contracts/finalize-pdf'
import { findBySigningToken } from '@/lib/signing-tokens'
import { findBySigningTokenOnThisHost } from '@/lib/signing-fence'
import {
  cleanInitials,
  cleanPreferredContact,
  cleanPrintName,
  cleanSignatureImage,
  contractInitialsProblem,
  signingEvidence,
} from '@/lib/signing-input'

type EmbeddedLeadRow = { owner_user_id?: string | null; closer_user_id?: string | null }
type AdminSupabaseClient = ReturnType<typeof createServiceClient>

/** Nested `leads` from Supabase may be an array, a single row, or absent; empty array → null. */
function pickEmbeddedLead(leads: unknown): EmbeddedLeadRow | null {
  if (leads == null) return null
  if (Array.isArray(leads)) return (leads[0] as EmbeddedLeadRow | undefined) ?? null
  return leads as EmbeddedLeadRow
}

async function ensureDealerFeeCostLine(
  supabase: AdminSupabaseClient,
  args: {
    orgId: string
    jobId: string
    userId: string | null
    dealerFeeAmount: number | null | undefined
  }
) {
  const amount = Math.round((Number(args.dealerFeeAmount) || 0) * 100) / 100
  if (amount <= 0) return

  try {
    const description = 'Lender / dealer fee'
    const { data: existing, error: findError } = await supabase
      .from('job_cost_lines')
      .select('id, amount')
      .eq('org_id', args.orgId)
      .eq('job_id', args.jobId)
      .eq('description', description)
      .is('deleted_at', null)
      .maybeSingle()

    if (findError) {
      console.error('[Contract Sign] Dealer fee cost-line lookup failed:', findError)
      return
    }

    if (existing?.id) {
      if (Number(existing.amount || 0) !== amount) {
        await supabase
          .from('job_cost_lines')
          .update({ amount, cost_type: 'misc', status: 'active' })
          .eq('id', existing.id)
      }
      return
    }

    const { error: insertError } = await supabase.from('job_cost_lines').insert({
      org_id: args.orgId,
      job_id: args.jobId,
      description,
      amount,
      cost_type: 'misc',
      status: 'active',
      notes: 'Financing lender/dealer fee from signed Installation Agreement.',
      created_by: args.userId,
      // Deterministic figure pulled straight from the signed contract's financing terms, not a
      // discretionary entry — exempt from the manual cost-line review gate by design.
      approved: true,
    })

    if (insertError) {
      console.error('[Contract Sign] Dealer fee cost-line insert failed:', insertError)
    }
  } catch (error) {
    console.error('[Contract Sign] Dealer fee cost-line sync failed:', error)
  }
}

async function getProposalSoldRoofSquares(
  supabase: AdminSupabaseClient,
  proposalId: string | null | undefined
): Promise<number | null> {
  if (!proposalId) return null

  const { data: proposal } = await supabase
    .from('proposals')
    .select('sold_squares')
    .eq('id', proposalId)
    .maybeSingle()

  if (proposal?.sold_squares != null) {
    return Number(proposal.sold_squares)
  }

  const { data: lineItems } = await supabase
    .from('proposal_line_items')
    .select('category, name, description, unit, quantity, is_adder')
    .eq('proposal_id', proposalId)

  return resolveProposalSoldRoofSquares(proposal, lineItems || [])
}

async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<boolean> {
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
      from: getCrmEmailFrom(),
      to,
      subject,
      text,
      html,
    })
    return true
  } catch (error) {
    console.error('Email send error:', error)
    return false
  }
}


/** The steps that follow a saved signature, each recorded in `signing_steps` when done so a retry runs only what is missing. */
async function finishSignedContract(
  supabase: AdminSupabaseClient,
  token: string
): Promise<{ pdfUrl: string | null; projectId: string | null; emailSent: boolean; pdfGenerationError: string | null; projectCreateError: string | null }> {
  // Always the row as it is NOW (the saved signature, the steps already done) — never a copy from before the claim.
  const contract = await findBySigningToken(supabase, 'contract', token)
  if (!contract || contract.status !== 'completed') {
    return { pdfUrl: null, projectId: null, emailSent: false, pdfGenerationError: null, projectCreateError: null }
  }
  const steps: Record<string, string> = { ...(contract.signing_steps ?? {}) }
  const done = (name: string) => !!steps[name]
  const mark = async (name: string) => {
    if (steps[name]) return
    steps[name] = new Date().toISOString()
    const { error } = await supabase
      .from('order_form_contracts')
      .update({ signing_steps: steps })
      .eq('id', contract.id)
      .eq('org_id', contract.org_id)
    if (error) console.error('[Contract Sign] could not record step', name, error.message)
  }
  const rawAgreementType = contract.agreement_type || 'installation'
  const isContingency = rawAgreementType === 'contingency'
  const isRepair = rawAgreementType === 'repair'
  const isSaleAgreement = rawAgreementType === 'installation' || rawAgreementType === 'repair'
  const agreementLabel = isContingency
    ? 'Insurance Contingency Agreement'
    : isRepair
      ? 'Repair Agreement'
      : 'Installation Agreement'
  const printName = contract.customer_print_name
  const clientIp = contract.customer_ip
  const customerSignedAt = contract.customer_signed_at

    if (!isContingency && !done('sale_notice')) try {
      const soldDescription = buildOrderFormContractSaleDescription(contract)
      const totalAmount =
        contract.project_cost != null && Number.isFinite(Number(contract.project_cost))
          ? Number(contract.project_cost)
          : null
      // Optional links: this block also marks the canvass pin sold, which must not depend on the app address.
      const appUrl = await tryOrgAppUrl(contract.org_id, 'contract signed: admin sale email')
      const recordUrl = appUrl && contract.opportunity_id
        ? `${appUrl}/opportunities/${contract.opportunity_id}`
        : undefined

      let projectUrl: string | undefined
      if (contract.opportunity_id) {
        const { data: projectRow } = await supabase
          .from('projects')
          .select('id')
          .eq('org_id', contract.org_id)
          .eq('opportunity_id', contract.opportunity_id)
          .maybeSingle()
        if (projectRow?.id && appUrl) {
          projectUrl = `${appUrl}/projects/${projectRow.id}`
        }
      }

      // Fetch setter / sales rep names and linked lead (for canvass "sold" pin) from the opportunity
      let setterName: string | null = null
      let closerName: string | null = null
      let resolvedLeadId: string | null = null
      if (contract.opportunity_id) {
        const { data: opp } = await supabase
          .from('opportunities')
          .select('lead_id, setter_user_id, owner_user_id, leads(owner_user_id, closer_user_id)')
          .eq('id', contract.opportunity_id)
          .eq('org_id', contract.org_id)
          .maybeSingle()

        resolvedLeadId = opp?.lead_id ?? null
        const leadData = pickEmbeddedLead(opp?.leads)
        // Sales rep: lead closer, else opportunity owner (closer-of-record)
        const closerUserId = leadData?.closer_user_id ?? opp?.owner_user_id ?? null
        // Fall back to lead.owner_user_id for older records where setter_user_id was not populated
        const resolvedSetterUserId = opp?.setter_user_id ?? leadData?.owner_user_id ?? null

        const userIds = [resolvedSetterUserId, closerUserId].filter(Boolean) as string[]
        if (userIds.length > 0) {
          const { data: salesUsers } = await supabase
            .from('users')
            .select('id, full_name')
            .in('id', userIds)
          const userMap = Object.fromEntries((salesUsers || []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]))
          if (resolvedSetterUserId) setterName = userMap[resolvedSetterUserId] ?? null
          if (closerUserId) closerName = userMap[closerUserId] ?? null
        }
      }

      // Push "sale" to canvass map (green $ pin) — same moment as sales-org blast email below.
      if (resolvedLeadId && isSaleAgreement) {
        const { error: leadSaleErr } = await supabase
          .from('leads')
          .update({ installation_agreement_signed_at: customerSignedAt })
          .eq('id', resolvedLeadId)
          .eq('org_id', contract.org_id)

        if (leadSaleErr) {
          console.error('[Contract Sign] sale agreement signed marker on lead:', leadSaleErr)
        }
      }

      await notifyOrgAdminsOfSale(supabase, {
        orgId: contract.org_id,
        customerName: contract.customer_name || 'Customer',
        soldDescription,
        totalAmount,
        setterName,
        closerName,
        projectUrl,
        recordUrl,
      })
    } catch (adminSaleErr) {
      console.error('notifyOrgAdminsOfSale (contract sign):', adminSaleErr)
    }
    await mark('sale_notice')

    // Supersede older contracts for this opportunity by VOIDING them — never deleting.
    // This used to hard-delete every other row (signed ones included) and purge their
    // PDFs, which destroyed fully-executed agreements on split cash/finance deals
    // (26-0040, 26-0031, 26-0010). Readers filter on status='completed', so a voided
    // row drops out of totals exactly as a deleted one did, but the record and its
    // PDF survive.
    if (contract.opportunity_id && !done('void_older')) {
      try {
        const { data: voided, error: voidError } = await supabase
          .from('order_form_contracts')
          .update({ status: 'voided', updated_at: new Date().toISOString() })
          .eq('opportunity_id', contract.opportunity_id)
          .eq('agreement_type', rawAgreementType)
          .neq('id', contract.id)
          .neq('status', 'voided')
          .select('id')

        if (voidError) {
          console.error('[Contract Sign] Error voiding older contracts:', voidError)
        } else if (voided && voided.length > 0) {
          console.log('[Contract Sign] Voided', voided.length, 'older contracts (records + PDFs kept)')
        }
      } catch (cleanupError) {
        console.error('[Contract Sign] Error voiding older contracts:', cleanupError)
      }
    }
    await mark('void_older')

    // Company identity for the customer email (one read).
    const documentBrand = await getDocumentBrand(supabase, contract.org_id)

    // The signed PDF, made from the row just saved. If it cannot be made the signature still stands (status completed,
    // no pdf_url = "PDF pending") and the same call runs again from the customer's next tap or the office's button.
    const pdfResult = await ensureContractPdf(supabase, contract.id, contract.org_id)
    const pdfStoragePath: string | null = pdfResult.path
    const pdfUrl: string | null = pdfResult.path
    const pdfGenerationError: string | null = pdfResult.error
    if (pdfResult.error) console.error('[Contract Sign] PDF not stored (signature kept, PDF pending):', pdfResult.error)
    if (pdfResult.path) await mark('pdf')

    let projectId = null
    let projectCreateError: string | null = null
    if (isContingency) {
      if (contract.opportunity_id) {
        await supabase
          .from('opportunities')
          .update({
            job_source: 'insurance',
            insurance_stage: 'contingency_signed',
            status: 'in_progress',
          })
          .eq('id', contract.opportunity_id)
      }
    } else try {
      let existingProject: { id: string } | null = null
      let oppForProject: {
        customer_id: string | null
        lead_id: string | null
        owner_user_id: string | null
        inspection_outcome: string | null
        job_source?: string | null
        insurance_stage?: string | null
      } | null = null

      if (contract.opportunity_id) {
        const { data: oppRow } = await supabase
          .from('opportunities')
          .select('customer_id, lead_id, owner_user_id, inspection_outcome, job_source, insurance_stage')
          .eq('id', contract.opportunity_id)
          .maybeSingle()
        oppForProject = oppRow
      }

      if (contract.opportunity_id) {
        const { data: byOpp } = await supabase
          .from('projects')
          .select('id')
          .eq('org_id', contract.org_id)
          .eq('opportunity_id', contract.opportunity_id)
          .maybeSingle()
        existingProject = byOpp
      }
      if (!existingProject && oppForProject?.lead_id) {
        const { data: byLead } = await supabase
          .from('projects')
          .select('id')
          .eq('org_id', contract.org_id)
          .eq('lead_id', oppForProject.lead_id)
          .maybeSingle()
        existingProject = byLead
      }

      if (!existingProject) {
        let customerId: string | null = null

        const opportunity = oppForProject

        customerId = opportunity?.customer_id ?? null

        if (!customerId) {
          let leadForName: {
            homeowner_name: string | null
            phone: string | null
            email: string | null
            address_text: string | null
          } | null = null
          if (opportunity?.lead_id) {
            const { data: lr } = await supabase
              .from('leads')
              .select('homeowner_name, phone, email, address_text')
              .eq('id', opportunity.lead_id)
              .maybeSingle()
            leadForName = lr
          }
          const displayName = resolveCustomerDisplayName({
            name: contract.customer_name || leadForName?.homeowner_name,
            address_text: contract.project_address || leadForName?.address_text,
            phone: contract.customer_phone || leadForName?.phone,
          })
          try {
            const { customer_id } = await upsertCustomer(supabase, contract.org_id, {
              name: displayName,
              email: contract.customer_email || leadForName?.email,
              phone: contract.customer_phone || leadForName?.phone,
              address_text: contract.project_address || leadForName?.address_text,
            })
            customerId = customer_id
          } catch (e) {
            console.error('[Contract Sign] upsertCustomer (new project)', e)
          }
        }

        // The customer exists from inspection booking: fill in what the signed contract adds, and tell QuickBooks now.
        if (customerId) await enrichCustomerFromContract(supabase, contract.org_id, customerId, contract)

        const soldRoofSquares = (await getProposalSoldRoofSquares(supabase, contract.proposal_id)) ?? contract.total_squares

        const { data: project, error: projectInsertError } = await supabase
          .from('projects')
          .insert({
            org_id: contract.org_id,
            customer_id: customerId,
            lead_id: opportunity?.lead_id || null,
            opportunity_id: contract.opportunity_id || null,
            owner_user_id: opportunity?.owner_user_id ?? contract.created_by,
            status: 'open',
            project_type: contract.scope_roof_replacement || contract.scope_roof_repair ? 'roofing' : 
                         contract.scope_siding ? 'siding' : 'mixed',
            address_text: contract.project_address,
            roof_squares: contract.total_squares,
            sold_roof_squares: soldRoofSquares,
            notes: `Contract signed on ${new Date(customerSignedAt).toLocaleDateString()}`,
            scope_of_work: [
              contract.scope_roof_replacement && 'Roof Replacement',
              contract.scope_roof_repair && 'Roof Repair',
              contract.scope_gutters && 'Gutters',
              contract.scope_siding && 'Siding',
              contract.scope_other,
            ].filter(Boolean).join(', '),
            contract_pdf_path: pdfStoragePath,
            contract_uploaded_at: customerSignedAt,
          })
          .select('id')
          .single()

        if (projectInsertError) {
          projectCreateError = projectInsertError.message
          console.error('[Contract Sign] Project insert failed (opportunity not marked won):', projectInsertError)
        }

        projectId = project?.id ?? null

        // Only mark the deal won when a project row actually exists — avoids won opportunities with no project.
        if (projectId && contract.opportunity_id) {
          const wonUpdate: Record<string, unknown> = { status: 'won', customer_id: customerId }
          if (contract.payment_method === 'insurance') {
            wonUpdate.job_source = 'insurance'
            wonUpdate.insurance_stage = oppForProject?.insurance_stage || 'contingency_signed'
          }
          // Dashboard sales metrics count this completed sale agreement.
          // Leave inspection_outcome alone so sits/no-sits stay tied to inspection feedback settings.
          await supabase.from('opportunities').update(wonUpdate).eq('id', contract.opportunity_id)
        }

        if (customerId && opportunity?.lead_id) {
          await supabase
            .from('leads')
            .update({ customer_id: customerId })
            .eq('id', opportunity.lead_id)
        }

        if (projectId) {
          await supabase.from('activities').insert({
            org_id: contract.org_id,
            project_id: projectId,
            user_id: contract.created_by,
            type: 'status_change',
            body: 'Project created from signed contract.',
          })

          // Auto-create production job when contract is signed
          try {
            let proposalFinancing: {
              financing_program_id?: string | null
              dealer_fee_percent?: number | null
              dealer_fee_amount?: number | null
            } = {}
            if (contract.proposal_id) {
              const { data: propRow } = await supabase
                .from('proposals')
                .select('financing_program_id, dealer_fee_percent, dealer_fee_amount')
                .eq('id', contract.proposal_id)
                .maybeSingle()
              if (propRow) {
                // Lender bookkeeping only. The commission base is the signed contract total
                // (+ signed change orders), written below by syncJobSaleForProjectOrJob.
                const isFinance = contract.payment_method === 'finance'
                proposalFinancing = {
                  financing_program_id: isFinance ? propRow.financing_program_id : null,
                  dealer_fee_percent: isFinance ? propRow.dealer_fee_percent : null,
                  dealer_fee_amount: isFinance ? propRow.dealer_fee_amount : null,
                }
              }
            }

            // Check if production job already exists for this project
            const { data: existingJob } = await supabase
              .from('production_jobs')
              .select('id, job_number')
              .eq('project_id', projectId)
              .maybeSingle()

            if (!existingJob) {
              // Determine job type from contract scope
              const jobType = contract.scope_roof_replacement || contract.scope_roof_repair ? 'roofing' : 
                             contract.scope_siding ? 'siding' : 
                             contract.scope_gutters ? 'gutters' : 'mixed'

              const { data: newJob, error: jobError } = await supabase
                .from('production_jobs')
                .insert({
                  org_id: contract.org_id,
                  project_id: projectId,
                  customer_id: customerId,
                  job_type: jobType,
                  address_text: contract.project_address || '',
                  accepted_proposal_id: contract.proposal_id || null,
                  salesperson_id: opportunity?.owner_user_id ?? contract.created_by,
                  sale_date: new Date().toISOString().split('T')[0],
                  sale_amount: contract.project_cost || null,
                  deposit_required_percent: depositRequiredFraction(contract.deposit_amount, contract.project_cost),
                  created_by: contract.created_by,
                  internal_notes: contract.notes || null,
                  special_instructions: contract.exclusions || null,
                  job_source: oppForProject?.job_source || (contract.payment_method === 'insurance' ? 'insurance' : 'retail'),
                  insurance_stage:
                    (oppForProject?.job_source === 'insurance' || contract.payment_method === 'insurance')
                      ? (oppForProject?.insurance_stage || 'contingency_signed')
                      : null,
                  ...proposalFinancing,
                })
                .select('id, job_number')
                .single()

              if (jobError) {
                console.error('[Contract Sign] Error creating production job:', jobError)
              } else if (newJob) {
                console.log('[Contract Sign] Production job created:', newJob.job_number)
                await ensureDealerFeeCostLine(supabase, {
                  orgId: contract.org_id,
                  jobId: newJob.id,
                  userId: contract.created_by,
                  dealerFeeAmount: proposalFinancing.dealer_fee_amount,
                })
                
                // Update project status to in_progress
                await supabase
                  .from('projects')
                  .update({ status: 'in_progress' })
                  .eq('id', projectId)

                // Log activity
                await supabase.from('activities').insert({
                  org_id: contract.org_id,
                  project_id: projectId,
                  user_id: contract.created_by,
                  type: 'status_change',
                  body: `Production job ${newJob.job_number} auto-created from signed ${agreementLabel}.`,
                })
              }
            } else {
              console.log('[Contract Sign] Production job already exists:', existingJob.job_number)
              await reinstateCancelledJob(supabase, {
                orgId: contract.org_id,
                jobId: existingJob.id,
                projectId,
                userId: contract.created_by ?? null,
                saleAmount: contract.project_cost ?? null,
              })
              if (proposalFinancing.dealer_fee_amount != null || contract.proposal_id) {
                await supabase
                  .from('production_jobs')
                  .update({
                    ...proposalFinancing,
                    accepted_proposal_id: contract.proposal_id || null,
                  })
                  .eq('id', existingJob.id)
                  .eq('org_id', contract.org_id)
              }
              await ensureDealerFeeCostLine(supabase, {
                orgId: contract.org_id,
                jobId: existingJob.id,
                userId: contract.created_by,
                dealerFeeAmount: proposalFinancing.dealer_fee_amount,
              })
            }
          } catch (jobCreationError) {
            console.error('[Contract Sign] Error in job creation:', jobCreationError)
          }
        }
      } else {
        projectId = existingProject.id
        const soldRoofSquares = (await getProposalSoldRoofSquares(supabase, contract.proposal_id)) ?? contract.total_squares

        if (contract.opportunity_id) {
          await supabase
            .from('projects')
            .update({ opportunity_id: contract.opportunity_id })
            .eq('id', existingProject.id)
            .is('opportunity_id', null)
        }

        if (soldRoofSquares != null) {
          await supabase
            .from('projects')
            .update({ sold_roof_squares: soldRoofSquares })
            .eq('id', existingProject.id)
        }

        // Ensure customer exists when signing (project may have been created without one).
        try {
          const { data: projRow } = await supabase
            .from('projects')
            .select('customer_id, lead_id')
            .eq('id', projectId)
            .single()

          const { data: oppRow } = contract.opportunity_id
            ? await supabase
                .from('opportunities')
                .select('customer_id, lead_id')
                .eq('id', contract.opportunity_id)
                .single()
            : { data: null }

          let ensuredId = projRow?.customer_id || oppRow?.customer_id || null
          if (!ensuredId) {
            const leadId = oppRow?.lead_id || projRow?.lead_id
            let leadForName: {
              homeowner_name: string | null
              phone: string | null
              email: string | null
              address_text: string | null
            } | null = null
            if (leadId) {
              const { data: lr } = await supabase
                .from('leads')
                .select('homeowner_name, phone, email, address_text')
                .eq('id', leadId)
                .maybeSingle()
              leadForName = lr
            }
            const displayName = resolveCustomerDisplayName({
              name: contract.customer_name || leadForName?.homeowner_name,
              address_text: contract.project_address || leadForName?.address_text,
              phone: contract.customer_phone || leadForName?.phone,
            })
            const { customer_id } = await upsertCustomer(supabase, contract.org_id, {
              name: displayName,
              email: contract.customer_email || leadForName?.email,
              phone: contract.customer_phone || leadForName?.phone,
              address_text: contract.project_address || leadForName?.address_text,
            })
            ensuredId = customer_id
            await supabase.from('projects').update({ customer_id: ensuredId }).eq('id', projectId)
            if (contract.opportunity_id) {
              await supabase.from('opportunities').update({ customer_id: ensuredId }).eq('id', contract.opportunity_id)
            }
            if (leadId) {
              await supabase.from('leads').update({ customer_id: ensuredId }).eq('id', leadId)
            }
          }
          // The one QuickBooks enqueue for this signing (upsertCustomer never enqueues).
          await enrichCustomerFromContract(supabase, contract.org_id, ensuredId, contract)
        } catch (e) {
          console.error('[Contract Sign] ensure customer (existing project)', e)
        }
        
        // Even if project exists, check if we need to create a job
        try {
          let proposalFinancingExisting: {
            financing_program_id?: string | null
            dealer_fee_percent?: number | null
            dealer_fee_amount?: number | null
          } = {}
          if (contract.proposal_id) {
            const { data: propRow2 } = await supabase
              .from('proposals')
              .select('financing_program_id, dealer_fee_percent, dealer_fee_amount')
              .eq('id', contract.proposal_id)
              .maybeSingle()
            if (propRow2) {
              // Lender bookkeeping only — see the new-project branch above.
              const isFinance = contract.payment_method === 'finance'
              proposalFinancingExisting = {
                financing_program_id: isFinance ? propRow2.financing_program_id : null,
                dealer_fee_percent: isFinance ? propRow2.dealer_fee_percent : null,
                dealer_fee_amount: isFinance ? propRow2.dealer_fee_amount : null,
              }
            }
          }

          const { data: projectData } = await supabase
            .from('projects')
            .select('customer_id, owner_user_id')
            .eq('id', projectId)
            .single()

          const { data: existingJob } = await supabase
            .from('production_jobs')
            .select('id, job_number')
            .eq('project_id', projectId)
            .maybeSingle()

          if (!existingJob) {
            const jobType = contract.scope_roof_replacement || contract.scope_roof_repair ? 'roofing' : 
                           contract.scope_siding ? 'siding' : 
                           contract.scope_gutters ? 'gutters' : 'mixed'

            const { data: newJob, error: jobError } = await supabase
              .from('production_jobs')
              .insert({
                org_id: contract.org_id,
                project_id: projectId,
                customer_id: projectData?.customer_id || null,
                job_type: jobType,
                address_text: contract.project_address || '',
                accepted_proposal_id: contract.proposal_id || null,
                salesperson_id: projectData?.owner_user_id || contract.created_by,
                sale_date: new Date().toISOString().split('T')[0],
                sale_amount: contract.project_cost || null,
                deposit_required_percent: depositRequiredFraction(contract.deposit_amount, contract.project_cost),
                created_by: contract.created_by,
                internal_notes: contract.notes || null,
                special_instructions: contract.exclusions || null,
                ...proposalFinancingExisting,
              })
              .select('id, job_number')
              .single()

            if (jobError) {
              console.error('[Contract Sign] Error creating production job for existing project:', jobError)
            } else if (newJob) {
              console.log('[Contract Sign] Production job created for existing project:', newJob.job_number)
              await ensureDealerFeeCostLine(supabase, {
                orgId: contract.org_id,
                jobId: newJob.id,
                userId: contract.created_by,
                dealerFeeAmount: proposalFinancingExisting.dealer_fee_amount,
              })
              
              await supabase
                .from('projects')
                .update({ status: 'in_progress' })
                .eq('id', projectId)

              await supabase.from('activities').insert({
                org_id: contract.org_id,
                project_id: projectId,
                user_id: contract.created_by,
                type: 'status_change',
                body: `Production job ${newJob.job_number} auto-created from signed ${agreementLabel}.`,
              })
            }
          } else {
            await reinstateCancelledJob(supabase, {
              orgId: contract.org_id,
              jobId: existingJob.id,
              projectId,
              userId: contract.created_by ?? null,
              saleAmount: contract.project_cost ?? null,
            })
            if (
              proposalFinancingExisting.dealer_fee_amount != null ||
              contract.proposal_id ||
              projectData?.customer_id ||
              projectData?.owner_user_id
            ) {
              await supabase
                .from('production_jobs')
                .update({
                  ...proposalFinancingExisting,
                  accepted_proposal_id: contract.proposal_id || null,
                  customer_id: projectData?.customer_id || null,
                  salesperson_id: projectData?.owner_user_id || contract.created_by,
                })
                .eq('id', existingJob.id)
                .eq('org_id', contract.org_id)
            }
            await ensureDealerFeeCostLine(supabase, {
              orgId: contract.org_id,
              jobId: existingJob.id,
              userId: contract.created_by,
              dealerFeeAmount: proposalFinancingExisting.dealer_fee_amount,
            })
          }
        } catch (jobCreationError) {
          console.error('[Contract Sign] Error creating job for existing project:', jobCreationError)
        }
      }
    } catch (projectError) {
      console.error('Error creating project:', projectError)
    }

    // The project/job step is idempotent (an existing project or job is updated, never duplicated); it counts as done once a
    // project exists (or for a contingency, which makes none).
    if (isContingency || (projectId && !projectCreateError)) await mark('project')

    // Sale amount + commission base = signed contract total + signed change orders. Written once,
    // here, by the one writer (lib/job-commission-base.ts) — for both the new-project and the
    // existing-project branch above, and for a reinstated cancelled job.
    if (!isContingency && projectId) {
      const baseSync = await syncJobSaleForProjectOrJob(supabase, { orgId: contract.org_id, projectId })
      if (baseSync?.status === 'error') {
        console.error('[Contract Sign] Commission base sync failed:', baseSync.error)
      } else if (baseSync?.status === 'skipped') {
        console.warn('[Contract Sign] Commission base not written:', baseSync.totals.reason)
      }
    }

    if (contract.opportunity_id && !done('signed_note')) {
      await supabase.from('activities').insert({
        org_id: contract.org_id,
        opportunity_id: contract.opportunity_id,
        user_id: contract.created_by,
        type: 'status_change',
        body: `${agreementLabel} signed by ${printName} from IP ${clientIp}`,
      })
    }

    await mark('signed_note')

    // The signed sale agreement is the real "accept": mark its proposal accepted and close
    // the deal's past appointments still sitting "scheduled" (desire paths, W4/W6).
    if (isSaleAgreement) {
      await applyContractSignedStatuses(supabase, {
        orgId: contract.org_id,
        proposalId: contract.proposal_id ?? null,
        opportunityId: contract.opportunity_id ?? null,
        projectId: projectId ?? null,
        signedAtIso: customerSignedAt,
      })
    }

    if (projectCreateError && contract.opportunity_id && !done('project_error_note')) {
      await supabase.from('activities').insert({
        org_id: contract.org_id,
        opportunity_id: contract.opportunity_id,
        user_id: contract.created_by,
        type: 'status_change',
        body: `Project was not created after contract sign (opportunity not marked won). ${projectCreateError}`,
      })
      await mark('project_error_note')
    }

    // The customer's link to their signed copy goes through the token route, never the bucket's public URL
    // (the stored pdf_url is unchanged and stays staff-side).
    const customerPdfUrl = pdfUrl
      ? customerSignedDocUrl('contract', token, await tryOrgAppUrl(contract.org_id, 'signed contract link'))
      : null

    // Always try to send confirmation email if customer has email
    let emailSent = false
    if (contract.customer_email && !done('customer_email') && done('pdf')) {
      console.log('[Contract Sign] Sending confirmation email to:', contract.customer_email)
      
      const email = buildContractSignedEmail({
        brand: documentBrand,
        agreementLabel,
        customerName: contract.customer_name,
        projectAddress: contract.project_address,
        isContingency,
        projectCost: contract.project_cost,
        customerPdfUrl,
      })
      emailSent = await sendEmail(contract.customer_email, email.subject, email.text, email.html)
      
      console.log('[Contract Sign] Email sent:', emailSent)
      if (emailSent) await mark('customer_email')
    } else if (!contract.customer_email) {
      await mark('customer_email') // nobody to email
    }

    // Everything done → finished for good; anything missing is retried by the next call on this link (see CLAUDE.md).
    const required = ['void_older', 'pdf', 'project', 'signed_note', 'customer_email', ...(isContingency ? [] : ['sale_notice'])]
    if (required.every((k) => done(k))) {
      await supabase
        .from('order_form_contracts')
        .update({ signing_finalized_at: new Date().toISOString() })
        .eq('id', contract.id)
        .eq('org_id', contract.org_id)
        .eq('status', 'completed')
    }

    return { pdfUrl: pdfUrl ? customerPdfUrl ?? customerSignedDocLinkForPage('contract', token) : null, projectId, emailSent, pdfGenerationError, projectCreateError }
}

/** For this long the request that saved a signature is assumed to still be finishing it (a second tap must not race it). */
const FINISH_LEASE_MS = 2 * 60 * 1000

/**
 * The answer for a contract that is already signed: success, with the signed copy's link. This is the ONE recovery path: a
 * signed contract that is not finalized (the first request died, or a step failed) is finished here — project/job, voiding the
 * superseded contract, commission base, PDF, notes, email — each step only if it is still missing, never flipping the contract
 * out of 'completed'. A lease keeps a second tap from running the steps while the first request is still on them.
 */
async function alreadySignedResponse(supabase: AdminSupabaseClient, contract: Record<string, any>, token: string) {
  const hasPdf = () => !!String(contract.pdf_storage_path || contract.pdf_url || '').trim()
  let result: Awaited<ReturnType<typeof finishSignedContract>> | null = null
  if (!contract.signing_finalized_at) {
    const leaseAt = contract.signing_finalize_lease_at ?? null
    const stale = !leaseAt || Date.now() - new Date(leaseAt).getTime() > FINISH_LEASE_MS
    if (stale) {
      const nowIso = new Date().toISOString()
      let claim = supabase
        .from('order_form_contracts')
        .update({ signing_finalize_lease_at: nowIso })
        .eq('id', contract.id)
        .eq('org_id', contract.org_id)
        .eq('status', 'completed')
        .is('signing_finalized_at', null)
      claim = leaseAt ? claim.eq('signing_finalize_lease_at', leaseAt) : claim.is('signing_finalize_lease_at', null)
      const { data: got } = await claim.select('id')
      if (got && got.length > 0) {
        result = await finishSignedContract(supabase, token)
      }
    }
  }
  if (result) return NextResponse.json({ success: true, alreadySigned: true, ...result })
  return NextResponse.json({
    success: true,
    alreadySigned: true,
    pdfUrl: hasPdf() ? customerSignedDocLinkForPage('contract', token) : null,
    projectId: null,
    emailSent: false,
    pdfGenerationError: null,
    projectCreateError: null,
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const body = await request.json()

    const {
      token,
      preferredContact: preferredContactInput,
      printName: printNameInput,
      signature: signatureInput,
      initialsChangeOrders: initialsChangeOrdersInput,
      initialsPropertyCondition: initialsPropertyConditionInput,
      initialsLandscaping: initialsLandscapingInput,
      initialsInsurance: initialsInsuranceInput,
    } = body ?? {}

    if (typeof token !== 'string' || !token || !printNameInput || !signatureInput) {
      return NextResponse.json(
        { error: 'Token, print name, and signature are required' },
        { status: 400 }
      )
    }

    // The page checks these for the customer's benefit; the server never takes its word for it.
    const printName = cleanPrintName(printNameInput)
    if (!printName) {
      return NextResponse.json({ error: 'Please enter your printed name' }, { status: 400 })
    }
    const signature = cleanSignatureImage(signatureInput)
    if (!signature) {
      return NextResponse.json({ error: 'Please sign the agreement' }, { status: 400 })
    }
    const preferredContact = cleanPreferredContact(preferredContactInput)
    if (preferredContact === false) {
      return NextResponse.json({ error: 'Choose phone or email as your preferred contact' }, { status: 400 })
    }

    const contract = await findBySigningTokenOnThisHost(supabase, 'contract', token)

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      )
    }

    if (new Date(contract.token_expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'Contract signing link has expired' },
        { status: 400 }
      )
    }

    if (contract.status === 'voided') {
      return NextResponse.json(
        { error: 'Contract has been voided' },
        { status: 400 }
      )
    }

    // Already signed (a second tap, a second tab, a stale page): the answer is the signed result, not an error — and a
    // signed contract whose PDF never got made is finished here (see lib/contracts/finalize-pdf.ts).
    if (contract.status === 'completed') {
      return alreadySignedResponse(supabase, contract, token)
    }

    const rawAgreementType = contract.agreement_type || 'installation'
    const isContingency = rawAgreementType === 'contingency'
    const isRepair = rawAgreementType === 'repair'
    const isSaleAgreement = rawAgreementType === 'installation' || rawAgreementType === 'repair'
    const agreementLabel = isContingency
      ? 'Insurance Contingency Agreement'
      : isRepair
        ? 'Repair Agreement'
        : 'Installation Agreement'

    const initialsChangeOrders = cleanInitials(initialsChangeOrdersInput)
    const initialsPropertyCondition = cleanInitials(initialsPropertyConditionInput)
    const initialsLandscaping = cleanInitials(initialsLandscapingInput)
    const initialsInsurance = cleanInitials(initialsInsuranceInput)
    const initialsProblem = contractInitialsProblem(contract, {
      changeOrders: initialsChangeOrders,
      propertyCondition: initialsPropertyCondition,
      landscaping: initialsLandscaping,
      insurance: initialsInsurance,
    })
    if (initialsProblem) {
      return NextResponse.json({ error: initialsProblem }, { status: 400 })
    }

    const { ip: clientIp, userAgent: clientUserAgent } = signingEvidence(request.headers)

    const customerSignedAt = new Date().toISOString()

    // The signature is saved first, and only ONE request can save it: the update only matches a contract that is still
    // waiting for the customer and whose link is still live. Two taps / two tabs → one winner; the other gets the signed result.
    const { data: claimed, error: updateError } = await supabase
      .from('order_form_contracts')
      .update({
        preferred_contact: preferredContact,
        customer_print_name: printName,
        customer_signature_data: signature,
        customer_signed_at: customerSignedAt,
        customer_ip: clientIp,
        customer_user_agent: clientUserAgent,
        customer_initials_change_orders: initialsChangeOrders,
        customer_initials_property_condition: initialsPropertyCondition,
        customer_initials_landscaping: initialsLandscaping,
        customer_initials_insurance: initialsInsurance,
        status: 'completed',
        signing_finalize_lease_at: customerSignedAt,
      })
      .eq('id', contract.id)
      .eq('status', 'pending_customer')
      .gt('token_expires_at', customerSignedAt)
      .select('id')

    if (updateError) {
      console.error('Error updating contract:', updateError)
      return NextResponse.json(
        { error: 'Failed to sign contract' },
        { status: 500 }
      )
    }

    if (!claimed || claimed.length === 0) {
      // Lost the race (or the link expired / the contract was voided between the read and the write): say what it is now.
      const { data: now } = await supabase.from('order_form_contracts').select('*').eq('id', contract.id).maybeSingle()
      if (now?.status === 'completed') return alreadySignedResponse(supabase, now, token)
      if (now?.status === 'voided') {
        return NextResponse.json({ error: 'Contract has been voided' }, { status: 400 })
      }
      if (now && new Date(now.token_expires_at) < new Date()) {
        return NextResponse.json({ error: 'Contract signing link has expired' }, { status: 400 })
      }
      return NextResponse.json({ error: 'This contract is not open for signing' }, { status: 409 })
    }

    // Everything after the saved signature. If this request dies from here on, the next call on the link finishes
    // whatever is missing (alreadySignedResponse → finishSignedContract); a completed contract is never reopened.
    const result = await finishSignedContract(supabase, token)

    console.log('[Contract Sign] Complete. PDF URL:', result.pdfUrl, 'Email sent:', result.emailSent, 'Project ID:', result.projectId)

    // The signing page links relative to itself, so it keeps a download link even with no app address configured.
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Contract sign error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sign contract' },
      { status: 500 }
    )
  }
}
