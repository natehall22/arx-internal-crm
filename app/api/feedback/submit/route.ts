import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, description, severity, page_url } = body

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    if (!type || !['bug', 'feature'].includes(type)) {
      return NextResponse.json({ error: 'Invalid feedback type' }, { status: 400 })
    }

    // Resolve reporter name and email from authenticated session (more reliable than client-provided)
    let rep_name = body.rep_name || ''
    let rep_email = body.rep_email || ''
    const { client: authClient, accessToken } = getAuthClient(request)
    if (accessToken) {
      const { data: { user }, error } = await authClient.auth.getUser(accessToken)
      if (!error && user) {
        rep_email = user.email || rep_email
        const adminClient = getAdminClient()
        const { data: profile } = await adminClient
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .single()
        if (profile?.full_name) {
          rep_name = profile.full_name
        } else if (rep_email) {
          const emailName = rep_email.split('@')[0]
            .replace(/[._]/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
          rep_name = emailName
        }
      }
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    const isBug = type === 'bug'
    const isUrgent = isBug && severity === 'urgent'
    
    const severityLabel = severity === 'urgent' ? 'URGENT' : severity === 'medium' ? 'Medium' : 'Low'
    const severityColor = severity === 'urgent' ? '#dc2626' : severity === 'medium' ? '#ca8a04' : '#6b7280'
    
    const subject = isBug
      ? `🐛 ${isUrgent ? '[URGENT] ' : ''}Bug Report from ${rep_name || 'Unknown User'}`
      : `💡 Feature Request from ${rep_name || 'Unknown User'}`

    const htmlContent = isBug
      ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1f2937; margin-bottom: 20px;">🐛 Bug Report</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280; width: 120px;">Severity:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 14px; font-weight: 600; background-color: ${severityColor}20; color: ${severityColor};">
                  ${severityLabel}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Reported By:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${escapeHtml(rep_name || 'Unknown')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Email:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                <a href="mailto:${escapeHtml(rep_email || '')}" style="color: #4f46e5;">${escapeHtml(rep_email || 'Unknown')}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Page URL:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; word-break: break-all;">
                <a href="${escapeHtml(page_url || '')}" style="color: #4f46e5; font-size: 13px;">${escapeHtml(page_url || 'Unknown')}</a>
              </td>
            </tr>
          </table>
          
          <div style="margin-bottom: 20px;">
            <h3 style="color: #374151; margin-bottom: 10px; font-size: 16px;">Description:</h3>
            <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
${escapeHtml(description.trim())}
            </div>
          </div>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            Submitted at ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1f2937; margin-bottom: 20px;">💡 Feature Request</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280; width: 120px;">Requested By:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${escapeHtml(rep_name || 'Unknown')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Email:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                <a href="mailto:${escapeHtml(rep_email || '')}" style="color: #4f46e5;">${escapeHtml(rep_email || 'Unknown')}</a>
              </td>
            </tr>
          </table>
          
          <div style="margin-bottom: 20px;">
            <h3 style="color: #374151; margin-bottom: 10px; font-size: 16px;">Feature Description:</h3>
            <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
${escapeHtml(description.trim())}
            </div>
          </div>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            Submitted at ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
        </div>
      `

    await transporter.sendMail({
      from: getCrmEmailFrom(),
      to: 'info@arxroofing.com',
      subject,
      html: htmlContent,
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error submitting feedback:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }
}
