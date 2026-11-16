import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { resolveOrgProfile } from '@/lib/org-profile'
import { mergeOrgSettings } from '@/lib/org-settings'
import { defaultProposalContent, parseProposalContentPatch, PROPOSAL_CONTENT_SETTINGS_KEY, resolveProposalContent } from '@/lib/proposal-content'
import { resolveOrgBrand } from '@/lib/org-brand'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function owner(request: Request | null) {
  if (request && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  if (!isSuperAdmin(profile as never)) return { error: NextResponse.json({ error: 'Only owners can change proposal content' }, { status: 403 }) } as const
  return { admin: createServiceClient(), orgId: profile.org_id } as const
}

/** What Settings shows: the words in use, the profile's defaults (for "Reset"), and the name `{company}` becomes. */
async function read(admin: ReturnType<typeof createServiceClient>, orgId: string) {
  const { data } = await admin.from('orgs').select('name, settings').eq('id', orgId).maybeSingle()
  const org = (data ?? null) as { settings?: unknown } | null
  const profile = resolveOrgProfile(org?.settings)
  const brand = data ? resolveOrgBrand(data as never) : null
  return {
    content: resolveProposalContent(org, profile),
    defaults: { ...defaultProposalContent(profile.id), proposalWord: profile.terms.proposal },
    companyName: brand?.shortName ?? '',
  }
}

/** Settings → Proposal content (owners): the cover subtitle and the process / why-us pages of the proposal PDF. */
export async function GET() {
  const o = await owner(null)
  if ('error' in o) return o.error
  return NextResponse.json(await read(o.admin, o.orgId))
}

export async function PATCH(request: Request) {
  const o = await owner(request)
  if ('error' in o) return o.error
  const { data } = await o.admin.from('orgs').select('settings').eq('id', o.orgId).maybeSingle()
  const profile = resolveOrgProfile((data as { settings?: unknown } | null)?.settings)
  const parsed = parseProposalContentPatch(await request.json().catch(() => null), defaultProposalContent(profile.id))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await mergeOrgSettings(o.admin, o.orgId, { ...parsed.set }, { path: [PROPOSAL_CONTENT_SETTINGS_KEY], remove: parsed.remove })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json(await read(o.admin, o.orgId))
}
