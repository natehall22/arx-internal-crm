import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import type { DefinitionChange } from '@/lib/custom-fields'
import { loadCustomFieldDefinitions, saveDefinitionChange } from '@/lib/custom-fields-db'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function owner() {
  try {
    const { profile } = await requireAuthApi()
    return isSuperAdmin(profile) ? (profile as { id: string; org_id: string }) : null
  } catch {
    return null
  }
}

/** GET — every custom field of the company, on and off (owners only). `ready: false` until migration 202611110020. */
export async function GET() {
  const profile = await owner()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { ready, definitions } = await loadCustomFieldDefinitions(createServiceClient(), profile.org_id)
  return NextResponse.json({ ready, definitions })
}

/**
 * POST — one change to the list (owners only). The one write path for custom_field_definitions.
 * body: { action: 'add', entity, label, field_type, options?, required? } | { action: 'update', id, label?, options?, required? }
 *     | { action: 'setActive', id, active } | { action: 'reorder', entity, order: id[] }
 */
export async function POST(request: Request) {
  const profile = await owner()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as DefinitionChange | null
  if (!body || typeof body !== 'object' || typeof (body as { action?: unknown }).action !== 'string') {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }
  const result = await saveDefinitionChange(createServiceClient(), profile.org_id, profile.id, body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ready: true, definitions: result.value })
}
