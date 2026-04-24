import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'
import nodemailer from 'nodemailer'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createClient()
    const serviceClient = createServiceClient()

    // Get sub_id for this user
    const { data: subId } = await supabase
      .rpc('get_sub_id_for_user', { user_uuid: profile.id })

    if (!subId) {
      return NextResponse.json({ error: 'Not a sub contractor' }, { status: 403 })
    }

    // Get sub info
    const { data: subInfo } = await supabase
      .from('sub_contractors')
      .select('company_name, org_id')
      .eq('id', subId)
      .single()

    if (!subInfo) {
      return NextResponse.json({ error: 'Sub contractor not found' }, { status: 404 })
    }

    // Verify work order is assigned to this sub
    const { data: workOrder, error: woError } = await supabase
      .from('work_orders')
      .select(`
        id, 
        status, 
        title, 
        description,
        address,
        city,
        state,
        job_id,
        org_id,
        assigned_user_id
      `)
      .eq('id', params.id)
      .eq('assigned_sub_id', subId)
      .single()

    if (woError || !workOrder) {
      return NextResponse.json({ error: 'Work order not found or not assigned to you' }, { status: 404 })
    }

    // Check if already completed
    if (workOrder.status === 'completed') {
      return NextResponse.json({ error: 'Work order is already completed' }, { status: 400 })
    }

    // Parse form data
    const formData = await request.formData()
    const completionNote = formData.get('completion_note') as string

    if (!completionNote?.trim()) {
      return NextResponse.json({ error: 'Completion note is required' }, { status: 400 })
    }

    // Collect photos
    const workDonePhotos: File[] = []
    const cleanupPhotos: File[] = []

    const entries = Array.from(formData.entries())
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i]
      if (key.startsWith('work_done_photo_') && value instanceof File) {
        workDonePhotos.push(value)
      } else if (key.startsWith('cleanup_photo_') && value instanceof File) {
        cleanupPhotos.push(value)
      }
    }

    if (workDonePhotos.length === 0) {
      return NextResponse.json({ error: 'At least 1 work done photo required' }, { status: 400 })
    }

    if (cleanupPhotos.length === 0) {
      return NextResponse.json({ error: 'At least 1 cleanup photo required' }, { status: 400 })
    }

    // Upload photos to Supabase storage
    const uploadedPhotos: { path: string; type: 'work_done' | 'cleanup' }[] = []
    const timestamp = Date.now()

    for (let i = 0; i < workDonePhotos.length; i++) {
      const file = workDonePhotos[i]
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `work-orders/${params.id}/work_done_${timestamp}_${i}.${ext}`
      
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Try work-order-photos bucket first, then files bucket
      let uploadError = null
      let usedBucket = 'work-order-photos'

      const { error: err1 } = await serviceClient.storage
        .from('work-order-photos')
        .upload(path, buffer, { contentType: file.type })

      if (err1) {
        usedBucket = 'files'
        const { error: err2 } = await serviceClient.storage
          .from('files')
          .upload(path, buffer, { contentType: file.type })
        uploadError = err2
      }

      if (!uploadError) {
        uploadedPhotos.push({ path: `${usedBucket}/${path}`, type: 'work_done' })
      }
    }

    for (let i = 0; i < cleanupPhotos.length; i++) {
      const file = cleanupPhotos[i]
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `work-orders/${params.id}/cleanup_${timestamp}_${i}.${ext}`
      
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      let uploadError = null
      let usedBucket = 'work-order-photos'

      const { error: err1 } = await serviceClient.storage
        .from('work-order-photos')
        .upload(path, buffer, { contentType: file.type })

      if (err1) {
        usedBucket = 'files'
        const { error: err2 } = await serviceClient.storage
          .from('files')
          .upload(path, buffer, { contentType: file.type })
        uploadError = err2
      }

      if (!uploadError) {
        uploadedPhotos.push({ path: `${usedBucket}/${path}`, type: 'cleanup' })
      }
    }

    // Insert photo records
    for (const photo of uploadedPhotos) {
      await serviceClient
        .from('work_order_photos')
        .insert({
          org_id: workOrder.org_id,
          work_order_id: params.id,
          photo_type: photo.type,
          storage_path: photo.path,
          uploaded_by_sub_id: subId,
        })
    }

    // Update work order status
    const { error: updateError } = await serviceClient
      .from('work_orders')
      .update({
        status: 'completed',
        sub_completion_notes: completionNote,
        completed_by_sub_id: subId,
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.id)

    if (updateError) {
      console.error('Error updating work order:', updateError)
      return NextResponse.json({ error: 'Failed to update work order' }, { status: 500 })
    }

    // Get job address for notification
    let jobAddress = [workOrder.address, workOrder.city, workOrder.state].filter(Boolean).join(', ')
    
    if (workOrder.job_id) {
      const { data: job } = await serviceClient
        .from('production_jobs')
        .select('address_text')
        .eq('id', workOrder.job_id)
        .single()
      
      if (job?.address_text) {
        jobAddress = job.address_text
      }
    }

    // Find PM to notify (assigned_user_id on work order, or job's assigned_pm_id)
    let pmUserId = workOrder.assigned_user_id
    
    if (!pmUserId && workOrder.job_id) {
      const { data: job } = await serviceClient
        .from('production_jobs')
        .select('assigned_pm_id, created_by')
        .eq('id', workOrder.job_id)
        .single()
      
      pmUserId = job?.assigned_pm_id || job?.created_by
    }

    // Create in-app notification for PM
    if (pmUserId) {
      const notificationTitle = `${subInfo.company_name} completed work order: ${workOrder.title}`
      const notificationBody = `Work order completed on ${jobAddress}`
      const linkUrl = workOrder.job_id ? `/ops/jobs/${workOrder.job_id}` : `/work-orders/${params.id}`

      await serviceClient
        .from('notifications')
        .insert({
          org_id: workOrder.org_id,
          recipient_user_id: pmUserId,
          type: 'work_order_completed',
          title: notificationTitle,
          body: notificationBody,
          link_url: linkUrl,
        })

      // Send email notification to PM
      const { data: pmUser } = await serviceClient
        .from('users')
        .select('email, full_name')
        .eq('id', pmUserId)
        .single()

      if (
        pmUser?.email &&
        (await isUserActiveForTransactionalEmail(serviceClient, pmUserId))
      ) {
        try {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          })

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'

          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'noreply@arxroofing.com',
            to: pmUser.email,
            subject: `✅ Work Order Completed — ${jobAddress}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #16a34a;">Work Order Completed</h2>
                <p><strong>Sub:</strong> ${subInfo.company_name}</p>
                <p><strong>Work Order:</strong> ${workOrder.title}</p>
                <p><strong>Address:</strong> ${jobAddress}</p>
                <p><strong>Completion Note:</strong></p>
                <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 12px 0;">
                  ${completionNote}
                </div>
                <p><strong>Photos Uploaded:</strong> ${uploadedPhotos.length} (${workDonePhotos.length} work done, ${cleanupPhotos.length} cleanup)</p>
                <p style="margin-top: 24px;">
                  <a href="${appUrl}${linkUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">
                    View Details
                  </a>
                </p>
              </div>
            `,
          })
        } catch (emailError) {
          console.error('Error sending PM notification email:', emailError)
        }
      }
    }

    return NextResponse.json({ 
      success: true,
      photos_uploaded: uploadedPhotos.length,
    })

  } catch (error) {
    console.error('Error completing work order:', error)
    return NextResponse.json({ error: 'Failed to complete work order' }, { status: 500 })
  }
}
