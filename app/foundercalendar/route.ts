import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { FOUNDER_CALENDAR_HTML } from '@/lib/founder-calendar/page-html'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'

/**
 * /foundercalendar — Nathan's founder week: time-blocked schedule, live CRM tally, quick-add
 * contacts. Deliberately unlisted while it's tested: no nav link, owner/admin only, everyone
 * else gets a plain 404. Not signed in → the CRM login, then back here.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx) {
    return NextResponse.redirect(new URL('/login?next=/foundercalendar', request.url))
  }
  if (!isOrgSuperuserRoleSlug(ctx.profile.role)) {
    return new NextResponse('Not found', { status: 404 })
  }
  // The user id (a UUID) namespaces the page's on-phone storage; JSON.stringify keeps it a safe JS string.
  const boot = `<script>window.FW_UID=${JSON.stringify(String(ctx.profile.id).replace(/[^0-9a-fA-F-]/g, ''))}</script>`
  return new NextResponse(FOUNDER_CALENDAR_HTML.replace('<!--FW_BOOT-->', boot), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'same-origin',
    },
  })
}
