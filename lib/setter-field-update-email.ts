import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrgEmailBlastSettings, resolveEmailBlastRecipients } from '@/lib/admin-email-blasts'
import { resolveMorningUpdateActivityWindow } from '@/lib/morning-update-windows'
import { getContactDispositionIdSet, isCanvassDoorLead, isContactDisposition } from '@/lib/sales-metrics'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'

const TIMEZONE = 'America/New_York'
const PAGE_SIZE = 1000

/** A gap longer than this between two quick doors ends the session — the break is not field time. */
const BREAK_GAP_MINUTES = 15
/** A conversation can stretch a gap this far before it still counts as a break. */
const CONTACT_BREAK_GAP_MINUTES = 30
/**
 * Dispositions the org counts as a contact, but which are a quick door for TIF purposes.
 * Scoped to this report only — org-wide contact metrics (dashboards, 444) are unchanged.
 */
const TIF_QUICK_DOOR_DISPOSITIONS = new Set(['renter'])

/**
 * Row shape from canvass_knocks (202608250001_canvass_knocks.sql) — one row per knock,
 * not per lead, so a re-knock of a pre-existing pin is visible here. user_id is already
 * resolved to whoever is credited for THAT specific knock (see app/api/canvass/lead/route.ts),
 * not a frozen pin owner, so this report no longer needs to re-derive attribution.
 */
type DoorRow = {
  created_at: string
  source: string | null
  disposition: string | null
  user_id: string
}

export type SetterFieldDayRow = {
  dateKey: string
  dateLabel: string
  userId: string
  teamId: string | null
  repName: string
  firstKnockAt: string
  lastKnockAt: string
  doors: number
  contacts: number
  nonContacts: number
  creditedMinutes: number
}

export type SetterFieldUpdateReport = {
  teamId: string
  teamName: string
  sentDateLabel: string
  activityLabel: string
  activityKind: 'yesterday' | 'weekend'
  rows: SetterFieldDayRow[]
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function easternDateKey(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** True when the org counts this disposition as a contact AND it earns full conversation credit. */
export function isTifContactDisposition(
  disposition: string | null | undefined,
  contactDispositionIds: Set<string>
): boolean {
  const id = String(disposition || '').toLowerCase().trim()
  if (TIF_QUICK_DOOR_DISPOSITIONS.has(id)) return false
  return isContactDisposition(disposition, contactDispositionIds)
}

export function calculateSessionCappedTif(
  events: Array<{ at: string; contact: boolean; creditMinutes?: number }>
): { creditedMinutes: number; activeElapsedMinutes: number; sessionCount: number } {
  if (events.length === 0) return { creditedMinutes: 0, activeElapsedMinutes: 0, sessionCount: 0 }
  const sorted = [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const duration = (event: { contact: boolean; creditMinutes?: number }) =>
    event.creditMinutes ?? (event.contact ? 20 : 5)
  const weightedMinutes = sorted.reduce((sum, event) => sum + duration(event), 0)
  let activeElapsedMinutes = 0
  let sessionCount = 1

  for (let index = 1; index < sorted.length; index += 1) {
    const gapMinutes =
      (new Date(sorted[index].at).getTime() - new Date(sorted[index - 1].at).getTime()) / 60_000
    const gapTouchesContact = sorted[index - 1].contact || sorted[index].contact
    // A contact buys a longer allowance for the conversation, but not an unlimited one —
    // otherwise a single contact next to a multi-hour gap credits the whole gap as field time.
    const allowedGapMinutes = gapTouchesContact ? CONTACT_BREAK_GAP_MINUTES : BREAK_GAP_MINUTES
    if (gapMinutes > allowedGapMinutes) {
      // End the prior session at the prior knock's credited duration. The break is excluded.
      activeElapsedMinutes += duration(sorted[index - 1])
      sessionCount += 1
    } else {
      activeElapsedMinutes += Math.max(0, gapMinutes)
    }
  }
  activeElapsedMinutes += duration(sorted[sorted.length - 1])
  const cappedActiveMinutes = Math.max(0, Math.floor(activeElapsedMinutes))

  return {
    creditedMinutes: Math.min(weightedMinutes, cappedActiveMinutes),
    activeElapsedMinutes: cappedActiveMinutes,
    sessionCount,
  }
}

export function resolveRecipientManagedTeamIds(
  recipient: { id: string; role: string | null },
  users: Array<{ id: string; team_id: string | null; manager_user_id: string | null }>
): Set<string> {
  const teamIds = new Set(
    users
      .filter((user) => user.manager_user_id === recipient.id && user.team_id)
      .map((user) => String(user.team_id))
  )
  const ownTeamId = users.find((user) => user.id === recipient.id)?.team_id
  if (ownTeamId && ['setter_manager', 'regional_setter_manager'].includes(String(recipient.role || ''))) {
    teamIds.add(String(ownTeamId))
  }
  return teamIds
}

export function summarizeSetterFieldRows(
  doors: DoorRow[],
  users: Array<{ id: string; full_name: string | null; team_id: string | null }>,
  contactDispositionIds: Set<string>
): SetterFieldDayRow[] {
  const usersById = new Map(users.map((user) => [user.id, user]))
  const grouped = new Map<
    string,
    SetterFieldDayRow & { events: Array<{ at: string; contact: boolean; creditMinutes: number }> }
  >()

  for (const door of doors) {
    // canvass_knocks rows are already door-eligible by construction (the write side only
    // ever inserts one that qualifies), but this report additionally excludes call_center —
    // a phone contact isn't a physical door — same as the pre-canvass_knocks version of this
    // report did via isCanvassDoorLead's own source exclusion list.
    if (!isCanvassDoorLead({ source: door.source, canvass_disposition: door.disposition })) continue
    const userId = door.user_id
    const user = userId ? usersById.get(userId) : null
    if (!userId || !user) continue
    const dateKey = easternDateKey(door.created_at)
    const key = `${dateKey}:${userId}`
    const existing = grouped.get(key) || {
      dateKey,
      dateLabel: formatDate(door.created_at),
      userId,
      teamId: user.team_id,
      repName: user.full_name || 'Unnamed rep',
      firstKnockAt: door.created_at,
      lastKnockAt: door.created_at,
      doors: 0,
      contacts: 0,
      nonContacts: 0,
      creditedMinutes: 0,
      events: [],
    }

    const contact = isTifContactDisposition(door.disposition, contactDispositionIds)
    const creditMinutes = contact ? 20 : 5
    existing.doors += 1
    if (contact) {
      existing.contacts += 1
    } else {
      existing.nonContacts += 1
    }
    if (new Date(door.created_at).getTime() < new Date(existing.firstKnockAt).getTime()) {
      existing.firstKnockAt = door.created_at
    }
    if (new Date(door.created_at).getTime() > new Date(existing.lastKnockAt).getTime()) {
      existing.lastKnockAt = door.created_at
    }
    existing.events.push({ at: door.created_at, contact, creditMinutes })
    grouped.set(key, existing)
  }

  return Array.from(grouped.values()).map(({ events, ...row }) => ({
    ...row,
    creditedMinutes: calculateSessionCappedTif(events).creditedMinutes,
  })).sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || b.creditedMinutes - a.creditedMinutes || a.repName.localeCompare(b.repName)
  )
}

export async function fetchSetterFieldUpdateReports(
  supabase: SupabaseClient,
  orgId: string,
  now: Date = new Date()
): Promise<SetterFieldUpdateReport[]> {
  const activity = resolveMorningUpdateActivityWindow(now)
  const [
    { data: org, error: orgError },
    { data: users, error: usersError },
    { data: teams, error: teamsError },
  ] = await Promise.all([
    supabase.from('orgs').select('settings').eq('id', orgId).single(),
    supabase.from('users').select('id, full_name, team_id').eq('org_id', orgId),
    supabase.from('teams').select('id, name').eq('org_id', orgId).order('name'),
  ])
  if (orgError) throw orgError
  if (usersError) throw usersError
  if (teamsError) throw teamsError

  // canvass_knocks, not leads: a re-knock of a pre-existing pin UPDATEs the lead row in
  // place with no new created_at, so a leads.created_at-windowed query silently dropped
  // every re-knock from this report (202608250001_canvass_knocks.sql's root-cause note).
  const doors: DoorRow[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('canvass_knocks')
      .select('created_at, source, disposition, user_id')
      .eq('org_id', orgId)
      .gte('created_at', activity.start.toISOString())
      .lt('created_at', activity.end.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data || []) as DoorRow[]
    doors.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const settings = org?.settings && typeof org.settings === 'object'
    ? org.settings as Record<string, unknown>
    : {}
  const dispositions = Array.isArray(settings.canvass_dispositions)
    ? settings.canvass_dispositions
    : []

  const sentDateLabel = now.toLocaleDateString('en-US', {
      timeZone: TIMEZONE,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  const rows = summarizeSetterFieldRows(
    doors,
    (users || []) as Array<{ id: string; full_name: string | null; team_id: string | null }>,
    getContactDispositionIdSet(dispositions)
  )

  return (teams || []).map((team) => ({
    teamId: String(team.id),
    teamName: String(team.name || 'Unnamed team'),
    sentDateLabel,
    activityLabel: activity.periodLabel,
    activityKind: activity.kind,
    rows: rows.filter((row) => row.teamId === team.id),
  }))
}

export function buildSetterFieldUpdateHtml(report: SetterFieldUpdateReport, test = false): string {
  const grouped = new Map<string, SetterFieldDayRow[]>()
  for (const row of report.rows) grouped.set(row.dateLabel, [...(grouped.get(row.dateLabel) || []), row])

  const sections = Array.from(grouped.entries()).map(([dateLabel, rows]) => {
    const body = rows.map((row) => `
      <tr>
        <td style="padding:9px 6px;color:#111827;font-weight:600;">${escapeHtml(row.repName)}</td>
        <td style="padding:9px 6px;color:#374151;white-space:nowrap;">${escapeHtml(formatTime(row.firstKnockAt))}</td>
        <td style="padding:9px 6px;color:#374151;white-space:nowrap;">${escapeHtml(formatTime(row.lastKnockAt))}</td>
        <td style="padding:9px 6px;color:#374151;text-align:right;">${row.doors}</td>
        <td style="padding:9px 6px;color:#374151;text-align:right;">${row.contacts}</td>
        <td style="padding:9px 6px;color:#111827;font-weight:700;text-align:right;white-space:nowrap;">${(row.creditedMinutes / 60).toFixed(1)} hr</td>
      </tr>`).join('')
    return `
      <h2 style="margin:24px 0 8px;color:#111827;font-size:17px;">${escapeHtml(dateLabel)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="border-bottom:1px solid #d1d5db;color:#6b7280;">
          <th style="padding:7px 6px;text-align:left;">Rep</th><th style="padding:7px 6px;text-align:left;">First knock</th>
          <th style="padding:7px 6px;text-align:left;">Last knock</th>
          <th style="padding:7px 6px;text-align:right;">Doors</th><th style="padding:7px 6px;text-align:right;">Contacts</th>
          <th style="padding:7px 6px;text-align:right;">TIF</th>
        </tr></thead><tbody>${body}</tbody>
      </table>`
  }).join('')

  return `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;">
    ${test ? '<p style="padding:10px 12px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:13px;font-weight:600;">Test email</p>' : ''}
    <h1 style="margin:0 0 6px;color:#111827;font-size:22px;">${escapeHtml(report.teamName)} Setter Time In Field (TIF) Update</h1>
    <p style="margin:0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(report.sentDateLabel)}</p>
    <p style="margin:4px 0 18px;color:#6b7280;font-size:14px;">Field activity: ${escapeHtml(report.activityLabel)}</p>
    <p style="margin:0 0 18px;padding:12px 14px;background:#f3f4f6;color:#374151;border-radius:8px;font-size:13px;"><strong>How TIF works:</strong> Contacts count as 20 minutes and non-contacts count as 5 minutes. Renters count as a quick door (5 minutes), not a contact. Gaps over 15 minutes are removed as breaks — a gap next to a contact gets 30 minutes before it counts as a break. TIF never exceeds recorded active time.</p>
    ${sections || '<p style="padding:18px 0;color:#6b7280;">No credited door activity was recorded for this period.</p>'}
    <p style="margin-top:22px;color:#6b7280;font-size:12px;">Contact status uses the organization’s configured contact dispositions. Doors are credited to whichever rep logged the knock, including a re-knock of a pin someone else originally dropped.</p>
  </div>`
}

export async function sendSetterFieldUpdateEmail(
  supabase: SupabaseClient,
  params: { orgId: string; reports?: SetterFieldUpdateReport[]; testToEmails?: string[] }
): Promise<{ sent: number; skipped: boolean; reason?: string }> {
  if (!process.env.SMTP_HOST) return { sent: 0, skipped: true, reason: 'smtp_not_configured' }
  const isTest = Boolean(params.testToEmails?.length)
  let recipients: Array<{ id: string; email: string; role: string | null }> = []
  // Hand-picked recipients asked for this report by name, so they get every team's report even
  // when they manage no one. Role-targeted recipients still only see the teams they manage.
  let pinnedRecipientIds = new Set<string>()
  if (!isTest) {
    const { data: org, error } = await supabase.from('orgs').select('settings').eq('id', params.orgId).single()
    if (error) throw error
    const settings = getOrgEmailBlastSettings(org.settings)
    pinnedRecipientIds = new Set(settings.setter_field_update?.user_targets || [])
    const resolved = await resolveEmailBlastRecipients(supabase, {
      orgId: params.orgId,
      blastType: 'setter_field_update',
      settings,
    })
    recipients = resolved.users.map((user) => ({ id: user.id, email: user.email, role: user.role }))
  } else {
    recipients = (params.testToEmails || []).map((email) => ({ id: 'test', email, role: null }))
  }
  recipients = Array.from(
    new Map(
      recipients
        .map((recipient) => ({ ...recipient, email: recipient.email.trim().toLowerCase() }))
        .filter((recipient) => recipient.email.includes('@'))
        .map((recipient) => [recipient.email, recipient])
    ).values()
  )
  if (recipients.length === 0) return { sent: 0, skipped: true, reason: 'no_recipients' }

  const reports = params.reports || await fetchSetterFieldUpdateReports(supabase, params.orgId)
  const { data: teamUsers, error: teamUsersError } = await supabase
    .from('users')
    .select('id, team_id, manager_user_id')
    .eq('org_id', params.orgId)
    .eq('active', true)
  if (teamUsersError) throw teamUsersError
  const transporter = getMailTransport()
  let sent = 0
  for (const recipient of recipients) {
    const managedTeamIds = resolveRecipientManagedTeamIds(
      recipient,
      (teamUsers || []) as Array<{ id: string; team_id: string | null; manager_user_id: string | null }>
    )
    const recipientReports = isTest || pinnedRecipientIds.has(recipient.id)
      ? reports
      : reports.filter((report) => managedTeamIds.has(report.teamId))

    for (const report of recipientReports) {
      try {
        await transporter.sendMail({
          from: getCrmEmailFrom(),
          to: recipient.email,
          subject: `${isTest ? '[TEST] ' : ''}${report.teamName} Setter Time In Field (TIF) Update — ${report.sentDateLabel}`,
          html: buildSetterFieldUpdateHtml(report, isTest),
        })
        sent += 1
      } catch (error) {
        console.error('sendSetterFieldUpdateEmail: send failed', recipient.email, report.teamName, error)
      }
    }
  }
  return sent > 0 ? { sent, skipped: false } : { sent: 0, skipped: true, reason: 'send_failed' }
}
