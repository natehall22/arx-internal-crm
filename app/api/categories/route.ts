import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadOrgCategories, saveCategoryChange } from '@/lib/categories-db'
import type { CategoryChange } from '@/lib/categories'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET — the company's work categories (on and off, in order). Any signed-in person: pickers and filters need the list;
 * a category is a label, not sensitive, so field roles read it too.
 */
export async function GET() {
  let profile: { org_id: string }
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ categories: await loadOrgCategories(createServiceClient(), profile.org_id) })
}

/**
 * POST — one change to the list (owners only). The one write path (lib/categories-db.ts saveCategoryChange).
 * body: { action: 'add', label } | { action: 'rename', slug, label } | { action: 'setActive', slug, active } | { action: 'reorder', order: slug[] }
 */
export async function POST(request: Request) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isSuperAdmin(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as CategoryChange | null
  if (!body || typeof body !== 'object' || typeof (body as { action?: unknown }).action !== 'string') {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }
  const result = await saveCategoryChange(createServiceClient(), profile.org_id, body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ categories: result.categories })
}
