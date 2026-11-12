import { NextRequest, NextResponse } from 'next/server'
import { getMailTransport } from '@/lib/setter-email'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { escapeHtml } from '@/lib/html'

// Public form: every field is escaped before it goes into the HTML email (security audit M4).
const esc = (v: unknown) => escapeHtml(v == null ? '' : String(v))
const PLAIN_EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      firstName,
      lastName,
      email,
      phone,
      companyName,
      teamSize,
      currentCrm,
      howDidYouHear,
    } = body

    if (![firstName, lastName, email, phone, companyName].every((v) => typeof v === 'string')) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (!firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!email?.trim() || !PLAIN_EMAIL.test(email.trim())) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!phone?.trim()) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    if (!companyName?.trim()) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
    }

    const transporter = getMailTransport(null)

    const subject = `🚀 New Trial Signup: ${companyName}`

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🚀 New Trial Signup Request</h1>
        </div>
        
        <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px;">Contact Information</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280; width: 140px;">Name:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${esc(firstName)} ${esc(lastName)}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280;">Email:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                <a href="mailto:${esc(email.trim())}" style="color: #4f46e5; text-decoration: none;">${esc(email.trim())}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280;">Phone:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                <a href="tel:${esc(phone)}" style="color: #4f46e5; text-decoration: none;">${esc(phone)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280;">Company:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;">${esc(companyName)}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280;">Team Size:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${esc(teamSize)}</td>
            </tr>
            ${currentCrm ? `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280;">Current CRM:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${esc(currentCrm)}</td>
            </tr>
            ` : ''}
            ${howDidYouHear ? `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #6b7280;">How they heard:</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${esc(howDidYouHear)}</td>
            </tr>
            ` : ''}
          </table>
          
          <div style="margin-top: 24px; padding: 16px; background: #dbeafe; border-radius: 8px;">
            <p style="margin: 0; color: #1e40af; font-size: 14px;">
              <strong>Next Steps:</strong> Reach out within 24 hours to schedule onboarding and set up their account.
            </p>
          </div>
          
          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; margin-bottom: 0;">
            Submitted on ${new Date().toLocaleString('en-US', { 
              dateStyle: 'full', 
              timeStyle: 'short',
              timeZone: 'America/New_York'
            })} ET
          </p>
        </div>
      </div>
    `

    await transporter.sendMail({
      from: getCrmEmailFrom(),
      to: 'nathan@arxroofing.com',
      subject,
      html: htmlContent,
      replyTo: email.trim(),
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error processing trial signup:', error)
    return NextResponse.json({ error: 'Failed to submit trial request' }, { status: 500 })
  }
}
