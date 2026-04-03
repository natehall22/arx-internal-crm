import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { buildOrderFormContractSaleDescription, notifyOrgAdminsOfSale } from '@/lib/admin-sale-email'
import { resolveCustomerDisplayName, upsertCustomer } from '@/lib/customers'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
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
      from: process.env.SMTP_FROM || 'ARX Roofing <noreply@arxroofing.com>',
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

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()

    const {
      token,
      preferredContact,
      printName,
      signature,
      initialsChangeOrders,
      initialsPropertyCondition,
      initialsLandscaping,
      initialsInsurance,
    } = body

    if (!token || !printName || !signature) {
      return NextResponse.json(
        { error: 'Token, print name, and signature are required' },
        { status: 400 }
      )
    }

    const { data: contract, error: fetchError } = await supabase
      .from('order_form_contracts')
      .select('*')
      .eq('signing_token', token)
      .single()

    if (fetchError || !contract) {
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

    if (contract.status === 'completed') {
      return NextResponse.json(
        { error: 'Contract has already been signed' },
        { status: 400 }
      )
    }

    if (contract.status === 'voided') {
      return NextResponse.json(
        { error: 'Contract has been voided' },
        { status: 400 }
      )
    }

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    const customerSignedAt = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('order_form_contracts')
      .update({
        preferred_contact: preferredContact,
        customer_print_name: printName,
        customer_signature_data: signature,
        customer_signed_at: customerSignedAt,
        customer_ip: clientIp,
        customer_initials_change_orders: initialsChangeOrders,
        customer_initials_property_condition: initialsPropertyCondition,
        customer_initials_landscaping: initialsLandscaping,
        customer_initials_insurance: initialsInsurance || null,
        status: 'completed',
      })
      .eq('id', contract.id)

    if (updateError) {
      console.error('Error updating contract:', updateError)
      return NextResponse.json(
        { error: 'Failed to sign contract' },
        { status: 500 }
      )
    }

    try {
      const soldDescription = buildOrderFormContractSaleDescription(contract)
      const totalAmount =
        contract.project_cost != null && Number.isFinite(Number(contract.project_cost))
          ? Number(contract.project_cost)
          : null
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
      const recordUrl = contract.opportunity_id
        ? `${appUrl}/opportunities/${contract.opportunity_id}`
        : undefined

      // Fetch setter and closer names from the linked opportunity
      let setterName: string | null = null
      let closerName: string | null = null
      if (contract.opportunity_id) {
        const { data: opp } = await supabase
          .from('opportunities')
          .select('setter_user_id, leads(closer_user_id)')
          .eq('id', contract.opportunity_id)
          .maybeSingle()

        const closerUserId = Array.isArray(opp?.leads)
          ? opp.leads[0]?.closer_user_id
          : (opp?.leads as any)?.closer_user_id ?? null

        const userIds = [opp?.setter_user_id, closerUserId].filter(Boolean) as string[]
        if (userIds.length > 0) {
          const { data: salesUsers } = await supabase
            .from('users')
            .select('id, full_name')
            .in('id', userIds)
          const userMap = Object.fromEntries((salesUsers || []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]))
          if (opp?.setter_user_id) setterName = userMap[opp.setter_user_id] ?? null
          if (closerUserId) closerName = userMap[closerUserId] ?? null
        }
      }

      await notifyOrgAdminsOfSale(supabase, {
        orgId: contract.org_id,
        customerName: contract.customer_name || 'Customer',
        soldDescription,
        totalAmount,
        setterName,
        closerName,
        recordUrl,
      })
    } catch (adminSaleErr) {
      console.error('notifyOrgAdminsOfSale (contract sign):', adminSaleErr)
    }

    // Void and delete any older contracts for this opportunity
    if (contract.opportunity_id) {
      try {
        // Find all other contracts for this opportunity (not the current one)
        const { data: olderContracts } = await supabase
          .from('order_form_contracts')
          .select('id, pdf_storage_path')
          .eq('opportunity_id', contract.opportunity_id)
          .neq('id', contract.id)

        if (olderContracts && olderContracts.length > 0) {
          console.log('[Contract Sign] Found', olderContracts.length, 'older contracts to void and delete')
          
          // Delete PDFs from storage
          for (const oldContract of olderContracts) {
            if (oldContract.pdf_storage_path) {
              await supabase.storage
                .from('files')
                .remove([oldContract.pdf_storage_path])
            }
          }

          // Delete the contract records
          const oldIds = olderContracts.map(c => c.id)
          const { error: deleteError } = await supabase
            .from('order_form_contracts')
            .delete()
            .in('id', oldIds)

          if (deleteError) {
            console.error('[Contract Sign] Error deleting older contracts:', deleteError)
          } else {
            console.log('[Contract Sign] Deleted', oldIds.length, 'older contracts')
          }
        }
      } catch (cleanupError) {
        console.error('[Contract Sign] Error cleaning up older contracts:', cleanupError)
      }
    }

    const { data: updatedContract } = await supabase
      .from('order_form_contracts')
      .select('*')
      .eq('id', contract.id)
      .single()

    let pdfUrl: string | null = null
    let pdfStoragePath: string | null = null
    let pdfGenerationError: string | null = null

    // Try to generate PDF
    try {
      console.log('[Contract Sign] Starting PDF generation for contract:', contract.id)
      
      // Dynamic import to avoid issues with @react-pdf/renderer in edge runtime
      const { generateContractPdf } = await import('@/lib/contracts/generatePdf')
      const pdfBuffer = await generateContractPdf(updatedContract)
      
      console.log('[Contract Sign] PDF generated, size:', pdfBuffer.length, 'bytes')
      
      const fileName = `contract_${contract.id}_${Date.now()}.pdf`
      pdfStoragePath = `org/${contract.org_id}/contracts/${fileName}`

      // Try files bucket first (more reliable)
      const { error: filesUploadError } = await supabase.storage
        .from('files')
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true, // Allow overwrite if exists
        })
      
      if (filesUploadError) {
        console.error('[Contract Sign] Error uploading to files bucket:', filesUploadError.message)
        
        // Fallback to contracts bucket
        const { error: contractsUploadError } = await supabase.storage
          .from('contracts')
          .upload(pdfStoragePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          })
        
        if (contractsUploadError) {
          console.error('[Contract Sign] Error uploading to contracts bucket:', contractsUploadError.message)
          pdfGenerationError = `Storage upload failed: ${contractsUploadError.message}`
        } else {
          pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/contracts/${pdfStoragePath}`
          console.log('[Contract Sign] PDF uploaded to contracts bucket:', pdfUrl)
        }
      } else {
        pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/files/${pdfStoragePath}`
        console.log('[Contract Sign] PDF uploaded to files bucket:', pdfUrl)
      }

      if (pdfUrl) {
        const { error: updatePdfError } = await supabase
          .from('order_form_contracts')
          .update({
            pdf_url: pdfUrl,
            pdf_storage_path: pdfStoragePath,
          })
          .eq('id', contract.id)
        
        if (updatePdfError) {
          console.error('[Contract Sign] Error updating pdf_url in database:', updatePdfError)
        } else {
          console.log('[Contract Sign] PDF URL saved to database:', pdfUrl)
        }
      }
    } catch (pdfError: any) {
      pdfGenerationError = pdfError?.message || 'Unknown PDF generation error'
      console.error('[Contract Sign] PDF generation failed:', pdfGenerationError)
      console.error('[Contract Sign] Full error:', pdfError)
    }

    let projectId = null
    let projectCreateError: string | null = null
    try {
      let existingProject: { id: string } | null = null
      if (contract.opportunity_id) {
        const { data: byOpp } = await supabase
          .from('projects')
          .select('id')
          .eq('org_id', contract.org_id)
          .eq('opportunity_id', contract.opportunity_id)
          .maybeSingle()
        existingProject = byOpp
      }
      if (!existingProject) {
        const { data: opportunity } = contract.opportunity_id
          ? await supabase
              .from('opportunities')
              .select('customer_id, lead_id')
              .eq('id', contract.opportunity_id)
              .single()
          : { data: null }

        if (opportunity?.lead_id) {
          const { data: byLead } = await supabase
            .from('projects')
            .select('id')
            .eq('org_id', contract.org_id)
            .eq('lead_id', opportunity.lead_id)
            .maybeSingle()
          existingProject = byLead
        }
      }

      if (!existingProject) {
        let customerId: string | null = null

        const { data: opportunity } = contract.opportunity_id
          ? await supabase
              .from('opportunities')
              .select('customer_id, lead_id')
              .eq('id', contract.opportunity_id)
              .single()
          : { data: null }

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

        const { data: project, error: projectInsertError } = await supabase
          .from('projects')
          .insert({
            org_id: contract.org_id,
            customer_id: customerId,
            lead_id: opportunity?.lead_id || null,
            opportunity_id: contract.opportunity_id || null,
            owner_user_id: contract.created_by,
            status: 'open',
            project_type: contract.scope_roof_replacement || contract.scope_roof_repair ? 'roofing' : 
                         contract.scope_siding ? 'siding' : 'mixed',
            address_text: contract.project_address,
            roof_squares: contract.total_squares,
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
          await supabase
            .from('opportunities')
            .update({ status: 'won', customer_id: customerId })
            .eq('id', contract.opportunity_id)
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
                  salesperson_id: contract.created_by,
                  sale_date: new Date().toISOString().split('T')[0],
                  sale_amount: contract.project_cost || null,
                  deposit_required_percent: contract.deposit_amount && contract.project_cost 
                    ? Math.round((contract.deposit_amount / contract.project_cost) * 100) 
                    : null,
                  created_by: contract.created_by,
                  internal_notes: contract.notes || null,
                  special_instructions: contract.exclusions || null,
                })
                .select('id, job_number')
                .single()

              if (jobError) {
                console.error('[Contract Sign] Error creating production job:', jobError)
              } else if (newJob) {
                console.log('[Contract Sign] Production job created:', newJob.job_number)
                
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
                  body: `Production job ${newJob.job_number} auto-created from signed Installation Agreement.`,
                })
              }
            } else {
              console.log('[Contract Sign] Production job already exists:', existingJob.job_number)
            }
          } catch (jobCreationError) {
            console.error('[Contract Sign] Error in job creation:', jobCreationError)
          }
        }
      } else {
        projectId = existingProject.id

        if (contract.opportunity_id) {
          await supabase
            .from('projects')
            .update({ opportunity_id: contract.opportunity_id })
            .eq('id', existingProject.id)
            .is('opportunity_id', null)
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
        } catch (e) {
          console.error('[Contract Sign] ensure customer (existing project)', e)
        }
        
        // Even if project exists, check if we need to create a job
        try {
          const { data: existingJob } = await supabase
            .from('production_jobs')
            .select('id, job_number')
            .eq('project_id', projectId)
            .maybeSingle()

          if (!existingJob) {
            // Get customer_id from existing project
            const { data: projectData } = await supabase
              .from('projects')
              .select('customer_id')
              .eq('id', projectId)
              .single()

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
                salesperson_id: contract.created_by,
                sale_date: new Date().toISOString().split('T')[0],
                sale_amount: contract.project_cost || null,
                deposit_required_percent: contract.deposit_amount && contract.project_cost 
                  ? Math.round((contract.deposit_amount / contract.project_cost) * 100) 
                  : null,
                created_by: contract.created_by,
                internal_notes: contract.notes || null,
                special_instructions: contract.exclusions || null,
              })
              .select('id, job_number')
              .single()

            if (jobError) {
              console.error('[Contract Sign] Error creating production job for existing project:', jobError)
            } else if (newJob) {
              console.log('[Contract Sign] Production job created for existing project:', newJob.job_number)
              
              await supabase
                .from('projects')
                .update({ status: 'in_progress' })
                .eq('id', projectId)

              await supabase.from('activities').insert({
                org_id: contract.org_id,
                project_id: projectId,
                user_id: contract.created_by,
                type: 'status_change',
                body: `Production job ${newJob.job_number} auto-created from signed Installation Agreement.`,
              })
            }
          }
        } catch (jobCreationError) {
          console.error('[Contract Sign] Error creating job for existing project:', jobCreationError)
        }
      }
    } catch (projectError) {
      console.error('Error creating project:', projectError)
    }

    if (contract.opportunity_id) {
      await supabase.from('activities').insert({
        org_id: contract.org_id,
        opportunity_id: contract.opportunity_id,
        user_id: contract.created_by,
        type: 'status_change',
        body: `Contract signed by ${printName} from IP ${clientIp}`,
      })
    }

    if (projectCreateError && contract.opportunity_id) {
      await supabase.from('activities').insert({
        org_id: contract.org_id,
        opportunity_id: contract.opportunity_id,
        user_id: contract.created_by,
        type: 'status_change',
        body: `Project was not created after contract sign (opportunity not marked won). ${projectCreateError}`,
      })
    }

    // Always try to send confirmation email if customer has email
    let emailSent = false
    if (contract.customer_email) {
      console.log('[Contract Sign] Sending confirmation email to:', contract.customer_email)
      
      const pdfSection = pdfUrl
        ? `<p style="text-align: center;">
            <a href="${pdfUrl}" style="display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Download Signed Contract</a>
          </p>`
        : `<p style="background: #fef3c7; padding: 12px; border-radius: 6px; color: #92400e;">
            Your signed contract is being processed. A copy will be sent to you shortly, or you can contact us to request one.
          </p>`

      const pdfTextSection = pdfUrl
        ? `You can download your signed contract here:\n${pdfUrl}`
        : `Your signed contract is being processed. Please contact us if you need a copy.`

      const emailText = `Dear ${contract.customer_name},

Thank you for signing your contract with ARX Roofing & Exteriors!

${pdfTextSection}

Project Details:
- Address: ${contract.project_address}
- Project Cost: $${contract.project_cost.toLocaleString()}

We look forward to working with you!

If you have any questions, please contact us at:
Phone: 704-313-8834
Email: info@arxroofing.com

Best regards,
ARX Roofing & Exteriors LLC`

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e3a5f; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .details { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">ARX ROOFING & EXTERIORS LLC</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Contract Signed Successfully!</p>
    </div>
    <div class="content">
      <p>Dear ${contract.customer_name},</p>
      <p>Thank you for signing your contract with ARX Roofing & Exteriors!</p>
      
      <div class="details">
        <strong>Project Details:</strong><br>
        Address: ${contract.project_address}<br>
        Project Cost: $${contract.project_cost.toLocaleString()}
      </div>
      
      ${pdfSection}
      
      <p>We look forward to working with you!</p>
      
      <p>If you have any questions, please contact us:</p>
      <p>
        Phone: 704-313-8834<br>
        Email: info@arxroofing.com
      </p>
      
      <p>Best regards,<br>ARX Roofing & Exteriors LLC</p>
    </div>
    <div class="footer">
      <p>ARX Roofing & Exteriors LLC<br>
      4101 Woodbury Terrace NW, Concord, NC 28027<br>
      arxroofing.com</p>
    </div>
  </div>
</body>
</html>`

      emailSent = await sendEmail(
        contract.customer_email,
        'ARX Roofing & Exteriors - Your Signed Contract',
        emailText,
        emailHtml
      )
      
      console.log('[Contract Sign] Email sent:', emailSent)
    }

    console.log('[Contract Sign] Complete. PDF URL:', pdfUrl, 'Email sent:', emailSent, 'Project ID:', projectId)

    return NextResponse.json({
      success: true,
      pdfUrl,
      projectId,
      emailSent,
      pdfGenerationError,
      projectCreateError,
    })
  } catch (error) {
    console.error('Contract sign error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sign contract' },
      { status: 500 }
    )
  }
}
