import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, description, severity, rep_name, rep_email, page_url } = body

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    if (!type || !['bug', 'feature'].includes(type)) {
      return NextResponse.json({ error: 'Invalid feedback type' }, { status: 400 })
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
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${rep_name || 'Unknown'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Email:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                <a href="mailto:${rep_email}" style="color: #4f46e5;">${rep_email || 'Unknown'}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Page URL:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; word-break: break-all;">
                <a href="${page_url}" style="color: #4f46e5; font-size: 13px;">${page_url || 'Unknown'}</a>
              </td>
            </tr>
          </table>
          
          <div style="margin-bottom: 20px;">
            <h3 style="color: #374151; margin-bottom: 10px; font-size: 16px;">Description:</h3>
            <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
${description}
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
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${rep_name || 'Unknown'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Email:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                <a href="mailto:${rep_email}" style="color: #4f46e5;">${rep_email || 'Unknown'}</a>
              </td>
            </tr>
          </table>
          
          <div style="margin-bottom: 20px;">
            <h3 style="color: #374151; margin-bottom: 10px; font-size: 16px;">Feature Description:</h3>
            <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
${description}
            </div>
          </div>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            Submitted at ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
        </div>
      `

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@arxroofing.com',
      to: 'nathan@arxroofing.com',
      subject,
      html: htmlContent,
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error submitting feedback:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }
}
