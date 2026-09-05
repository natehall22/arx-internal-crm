import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'

function getMailTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractMentionFragments(noteText: string): string[] {
  const matches = noteText.match(/@([^\n@]{1,80})/g) || []
  return Array.from(
    new Set(
      matches
        .map((m) => m.slice(1).trim())
        .map((m) => m.replace(/[.,!?;:]+$/g, '').trim())
        .filter(Boolean)
    )
  )
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', params.id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Verify org match
    if (job.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Fetch notes with user info, newest first
    const { data: notes, error: notesError } = await adminClient
      .from('production_job_notes')
      .select(`
        id,
        note,
        created_at,
        user:users(full_name)
      `)
      .eq('job_id', params.id)
      .order('created_at', { ascending: false })

    if (notesError) {
      console.error('Error fetching notes:', notesError)
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
    }

    return NextResponse.json({ notes: notes || [] })

  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]/notes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', params.id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const { note, page_url, mentioned_user_ids, customer_name, customer_id, job_number } = body

    if (!note || typeof note !== 'string' || !note.trim()) {
      return NextResponse.json({ error: 'Note is required' }, { status: 400 })
    }

    // Insert the note
    const { data: newNote, error: insertError } = await adminClient
      .from('production_job_notes')
      .insert({
        job_id: params.id,
        user_id: profile.id,
        note: note.trim(),
        is_internal: true,
      })
      .select(`
        id,
        note,
        created_at
      `)
      .single()

    if (insertError) {
      console.error('Error inserting note:', insertError)
      return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
    }

    // Send email notifications for @mentions without blocking note creation.
    try {
      const { data: orgUsers } = await adminClient
        .from('users')
        .select('id, full_name, email, active')
        .eq('org_id', profile.org_id)
        .not('email', 'is', null)

      const allUsers = (orgUsers || []).filter(
        (u: any) =>
          u?.active !== false &&
          u?.id &&
          typeof u.full_name === 'string' &&
          typeof u.email === 'string' &&
          u.email.trim()
      )
      const explicitMentionIds = Array.isArray(mentioned_user_ids)
        ? mentioned_user_ids.filter((id: any) => typeof id === 'string')
        : []
      const mentionFragments = extractMentionFragments(note)

      // Fallback parsing for manually typed mentions.
      const parsedMentionUsers = allUsers.filter((orgUser: any) => {
        if (!orgUser?.full_name) return false
        const mentionPattern = new RegExp(
          `(^|\\s)@${escapeRegExp(orgUser.full_name)}(?=\\s|$|[.,!?;:])`,
          'i'
        )
        return mentionPattern.test(note)
      })

      const fuzzyMentionUsers = allUsers.filter((orgUser: any) => {
        const normalizedUserName = normalizeName(orgUser.full_name || '')
        if (!normalizedUserName) return false

        return mentionFragments.some((fragment) => {
          const normalizedFragment = normalizeName(fragment)
          if (!normalizedFragment) return false

          return (
            normalizedUserName === normalizedFragment ||
            normalizedUserName.startsWith(normalizedFragment) ||
            normalizedFragment.startsWith(normalizedUserName)
          )
        })
      })

      const mentionedUsers = allUsers.filter((orgUser: any) => {
        if (!orgUser?.id || !orgUser?.email) {
          return false
        }
        return (
          explicitMentionIds.includes(orgUser.id) ||
          parsedMentionUsers.some((u: any) => u.id === orgUser.id) ||
          fuzzyMentionUsers.some((u: any) => u.id === orgUser.id)
        )
      })

      if (mentionedUsers.length > 0) {
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || ''
        const fallbackJobPath = `/ops/jobs/${params.id}`
        const pageLink = typeof page_url === 'string' && page_url.trim()
          ? page_url.trim()
          : `${origin}${fallbackJobPath}`
        const customerLink =
          typeof customer_id === 'string' && customer_id.trim()
            ? `${origin}/customers/${customer_id.trim()}`
            : null

        const transporter = getMailTransport()
        const senderName = profile.full_name || 'ARX Team'
        const customerLabel = typeof customer_name === 'string' && customer_name.trim()
          ? customer_name.trim()
          : 'Customer'
        const jobLabel = typeof job_number === 'string' && job_number.trim()
          ? job_number.trim()
          : `Job ${params.id}`
        const subject = `${customerLabel} • ${jobLabel} • New tagged note`

        console.log(
          'Sending @mention emails:',
          mentionedUsers.map((u: any) => ({ id: u.id, email: u.email, full_name: u.full_name }))
        )

        const emailResults = await Promise.allSettled(
          mentionedUsers.map((mentionedUser: any) =>
            transporter.sendMail({
              from: getCrmEmailFrom(),
              to: mentionedUser.email,
              subject,
              html: `
                <p>Hi ${mentionedUser.full_name || 'there'},</p>
                <p><strong>${senderName}</strong> mentioned you in an internal note.</p>
                <p><strong>Comment:</strong><br/>${escapeHtml(String(note)).replace(/\n/g, '<br/>')}</p>
                <p><a href="${pageLink}">Open Job in CRM</a></p>
                ${customerLink ? `<p><a href="${customerLink}">Open Customer in CRM</a></p>` : ''}
              `,
              text: `Hi ${mentionedUser.full_name || 'there'},\n\n${senderName} mentioned you in an internal note.\n\nComment:\n${note}\n\nOpen Job in CRM: ${pageLink}${customerLink ? `\nOpen Customer in CRM: ${customerLink}` : ''}`,
            })
          )
        )

        const failedCount = emailResults.filter((r) => r.status === 'rejected').length
        if (failedCount > 0) {
          console.error(`Failed sending ${failedCount} @mention email(s)`)
        }
      }
    } catch (mentionEmailError) {
      console.error('Failed sending @mention emails:', mentionEmailError)
      // Keep note save successful even if email fails.
    }

    // Return the note with user info
    return NextResponse.json({ 
      note: {
        ...newNote,
        user: { full_name: profile.full_name }
      }
    })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/notes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
