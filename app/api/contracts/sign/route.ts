import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

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

      // Try contracts bucket first
      const { error: uploadError } = await supabase.storage
        .from('contracts')
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        })

      if (uploadError) {
        console.error('[Contract Sign] Error uploading to contracts bucket:', uploadError.message)
        
        // Fallback to files bucket
        const { error: filesUploadError } = await supabase.storage
          .from('files')
          .upload(pdfStoragePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: false,
          })
        
        if (filesUploadError) {
          console.error('[Contract Sign] Error uploading to files bucket:', filesUploadError.message)
          pdfGenerationError = `Storage upload failed: ${filesUploadError.message}`
        } else {
          pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/files/${pdfStoragePath}`
          console.log('[Contract Sign] PDF uploaded to files bucket:', pdfUrl)
        }
      } else {
        pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/contracts/${pdfStoragePath}`
        console.log('[Contract Sign] PDF uploaded to contracts bucket:', pdfUrl)
      }

      if (pdfUrl) {
        await supabase
          .from('order_form_contracts')
          .update({
            pdf_url: pdfUrl,
            pdf_storage_path: pdfStoragePath,
          })
          .eq('id', contract.id)
      }
    } catch (pdfError: any) {
      pdfGenerationError = pdfError?.message || 'Unknown PDF generation error'
      console.error('[Contract Sign] PDF generation failed:', pdfGenerationError)
      console.error('[Contract Sign] Full error:', pdfError)
    }

    let projectId = null
    try {
      const { data: existingProject } = await supabase
        .from('projects')
        .select('id')
        .eq('org_id', contract.org_id)
        .or(`opportunity_id.eq.${contract.opportunity_id},lead_id.eq.${contract.opportunity_id}`)
        .maybeSingle()

      if (!existingProject) {
        let customerId = null
        
        const { data: opportunity } = contract.opportunity_id 
          ? await supabase
              .from('opportunities')
              .select('customer_id, lead_id')
              .eq('id', contract.opportunity_id)
              .single()
          : { data: null }

        customerId = opportunity?.customer_id

        if (!customerId) {
          const { data: customer } = await supabase
            .from('customers')
            .insert({
              org_id: contract.org_id,
              name: contract.customer_name,
              phone: contract.customer_phone,
              email: contract.customer_email,
              address_text: contract.project_address,
            })
            .select('id')
            .single()

          customerId = customer?.id
        }

        const { data: project } = await supabase
          .from('projects')
          .insert({
            org_id: contract.org_id,
            customer_id: customerId,
            lead_id: opportunity?.lead_id || null,
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

        projectId = project?.id

        if (contract.opportunity_id) {
          await supabase
            .from('opportunities')
            .update({ status: 'won', customer_id: customerId })
            .eq('id', contract.opportunity_id)
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
    })
  } catch (error) {
    console.error('Contract sign error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sign contract' },
      { status: 500 }
    )
  }
}
