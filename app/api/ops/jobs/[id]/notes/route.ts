import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

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

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

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
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

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
    const { note, page_url } = body

    if (!note || typeof note !== 'string' || !note.trim()) {
      return NextResponse.json({ error: 'Note is required' }, { status: 400 })
    }

    // Insert the note
    const { data: newNote, error: insertError } = await adminClient
      .from('production_job_notes')
      .insert({
        job_id: params.id,
        user_id: user.id,
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
      const mentionCandidates = Array.from(
        new Set(
          (note.match(/@([A-Za-z][A-Za-z\s'-]{0,80})/g) || [])
            .map((m: string) => m.slice(1).trim())
            .filter(Boolean)
        )
      )

      if (mentionCandidates.length > 0) {
        const { data: orgUsers } = await adminClient
          .from('users')
          .select('id, full_name, email')
          .eq('org_id', profile.org_id)
          .not('email', 'is', null)

        const mentionedUsers = (orgUsers || []).filter((orgUser: any) => {
          if (!orgUser?.full_name || !orgUser?.email || orgUser.id === user.id) {
            return false
          }
          const mentionPattern = new RegExp(
            `(^|\\s)@${escapeRegExp(orgUser.full_name)}(?=\\s|$|[.,!?;:])`,
            'i'
          )
          return mentionPattern.test(note)
        })

        if (mentionedUsers.length > 0) {
          const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || ''
          const fallbackJobPath = `/ops/jobs/${params.id}`
          const pageLink = typeof page_url === 'string' && page_url.trim()
            ? page_url.trim()
            : `${origin}${fallbackJobPath}`

          const transporter = getMailTransport()
          const senderName = profile.full_name || 'ARX Team'
          const subject = `You were mentioned in a job note`

          await Promise.all(
            mentionedUsers.map((mentionedUser: any) =>
              transporter.sendMail({
                from: 'info@arxroofing.com',
                to: mentionedUser.email,
                subject,
                html: `
                  <p>Hi ${mentionedUser.full_name || 'there'},</p>
                  <p><strong>${senderName}</strong> mentioned you in an internal note.</p>
                  <p><strong>Comment:</strong><br/>${escapeHtml(String(note)).replace(/\n/g, '<br/>')}</p>
                  <p><a href="${pageLink}">Open in CRM</a></p>
                `,
                text: `Hi ${mentionedUser.full_name || 'there'},\n\n${senderName} mentioned you in an internal note.\n\nComment:\n${note}\n\nOpen in CRM: ${pageLink}`,
              })
            )
          )
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
