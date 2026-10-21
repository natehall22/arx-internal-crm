import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { canReadJobNotes, resolveOpsAccess } from '@/lib/ops-access'
import { mentionCandidates, resolveNoteMentions } from '@/lib/note-mentions'
import { resolveAppUrl } from '@/lib/job-trades'
import { buildMentionEmail } from '@/lib/note-mention-email'

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

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    let authUser
    try {
      ;({ profile, authUser } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Same people the job page lets in (it redirects anyone without job-board access).
    if (!canReadJobNotes(await resolveOpsAccess(adminClient, authUser.id, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    let profile
    let authUser
    try {
      ;({ profile, authUser } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Same people the job page lets in (it redirects anyone without job-board access).
    if (!canReadJobNotes(await resolveOpsAccess(adminClient, authUser.id, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, org_id, job_number, address_text, customer_id')
      .eq('id', params.id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const { note, mentioned_user_ids, customer_name } = body

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
        .select('id, full_name, email, active, role, custom_role_id')
        .eq('org_id', profile.org_id)
        .not('email', 'is', null)

      // The one candidate list for mentions (active, named, has email). The composer
      // sends only the ids picked from its dropdown; recipients are resolved here.
      const allUsers = mentionCandidates(orgUsers || [])
      const explicitMentionIds = Array.isArray(mentioned_user_ids)
        ? mentioned_user_ids.filter((id: any) => typeof id === 'string')
        : []

      // Exact `@Full Name` matches only (longest name wins); a picked id disambiguates
      // two users with the same name. Never a prefix match — "@Ste" pings nobody.
      const mentionedUsers = resolveNoteMentions(note, allUsers, explicitMentionIds)

      if (mentionedUsers.length > 0) {
        const transporter = getMailTransport()
        // Links come only from the configured app URL — never the request's Origin
        // header or a client-sent page URL, which a caller can point at any domain.
        const appUrl = resolveAppUrl()

        const emailResults = await Promise.allSettled(
          mentionedUsers.map(async (mentionedUser: any) => {
            // Everyone active can be mentioned, but the email only carries the note
            // text if THIS recipient may read job notes (same rule as the job page).
            const recipientCanReadNote = canReadJobNotes(
              await resolveOpsAccess(adminClient, mentionedUser.id, {
                role: mentionedUser.role,
                custom_role_id: mentionedUser.custom_role_id ?? null,
              })
            )
            const mail = buildMentionEmail({
              appUrl,
              jobId: params.id,
              jobNumber: job.job_number ?? null,
              jobAddress: job.address_text ?? null,
              customerId: job.customer_id ?? null,
              customerName: typeof customer_name === 'string' ? customer_name : null,
              senderName: profile.full_name || 'ARX Team',
              recipientName: mentionedUser.full_name,
              note: String(note),
              recipientCanReadNote,
            })
            return transporter.sendMail({ from: getCrmEmailFrom(), to: mentionedUser.email, ...mail })
          })
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
