import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireAuthApi } from '@/lib/auth'
import { FILES_OBJECT_BUCKET, orgLogoHref } from '@/lib/files/files-object'
import { mergeOrgSettings } from '@/lib/org-settings'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const LOGO_EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** Admin of an org, or a 401/403/404 response. */
async function requireLogoAdmin(): Promise<{ orgId: string } | NextResponse> {
  let profile: { org_id?: string | null; role?: string | null }
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!profile?.org_id) return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can change the company logo' }, { status: 403 })
  }
  return { orgId: profile.org_id }
}

async function removeLogoObjects(admin: SupabaseClient, orgId: string, prefix = 'logo.') {
  const { data: existingFiles } = await admin.storage.from(FILES_OBJECT_BUCKET).list(`org/${orgId}`, { search: 'logo' })
  const names = (existingFiles ?? []).filter((f) => f.name.startsWith(prefix)).map((f) => `org/${orgId}/${f.name}`)
  if (names.length > 0) await admin.storage.from(FILES_OBJECT_BUCKET).remove(names)
}

/**
 * Store the logo in BOTH places readers look (`orgs.logo_url`, then `orgs.settings.logo_url` — storedOrgLogo), so clearing
 * the column can never fall back to an older logo left in settings.
 */
async function writeOrgLogo(admin: SupabaseClient, orgId: string, value: string | null): Promise<string | null> {
  const { data: org, error: readError } = await admin.from('orgs').select('settings').eq('id', orgId).single()
  if (readError) return readError.message
  const settings = { ...((org?.settings as Record<string, unknown> | null) ?? {}) }
  if (value) settings.logo_url = value
  else delete settings.logo_url
  const { error } = await admin.from('orgs').update({ logo_url: value, settings }).eq('id', orgId)
  return error?.message ?? null
}

/** The optional dark-background logo lives only in `orgs.settings.logo_dark_url` (no column), written per key. */
async function writeDarkLogo(admin: SupabaseClient, orgId: string, value: string | null): Promise<string | null> {
  const { error } = value ? await mergeOrgSettings(admin, orgId, { logo_dark_url: value }) : await mergeOrgSettings(admin, orgId, {}, { remove: ['logo_dark_url'] })
  return error
}

const isDarkVariant = (v: unknown) => v === 'dark'

// POST - Upload company logo (admin only). Stores the storage path (`org/<orgId>/logo.<ext>?v=<ts>`), never a public URL;
// readers link to it through orgLogoHref → GET /api/org-logo/<orgId>.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireLogoAdmin()
    if (auth instanceof NextResponse) return auth
    const { orgId } = auth
    const adminClient = createServiceClient()

    const formData = await request.formData()
    const file = formData.get('logo') as File
    const dark = isDarkVariant(formData.get('variant'))

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const fileExt = LOGO_EXT_BY_TYPE[file.type]
    if (!fileExt) {
      return NextResponse.json({
        error: 'Invalid file type. Allowed: PNG, JPG, WEBP, SVG'
      }, { status: 400 })
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({
        error: 'File too large. Maximum size is 2MB'
      }, { status: 400 })
    }

    const filePath = `org/${orgId}/${dark ? 'logo-dark' : 'logo'}.${fileExt}`
    const buffer = Buffer.from(await file.arrayBuffer())

    // Old logo may have a different extension.
    await removeLogoObjects(adminClient, orgId, dark ? 'logo-dark.' : 'logo.')

    const { error: uploadError } = await adminClient.storage
      .from(FILES_OBJECT_BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
    }

    // `?v=` makes the stored value change on every upload, so orgLogoHref's cache tag changes too (the path does not).
    const storedValue = `${filePath}?v=${Date.now()}`
    const updateError = dark ? await writeDarkLogo(adminClient, orgId, storedValue) : await writeOrgLogo(adminClient, orgId, storedValue)
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      logo_url: dark
        ? orgLogoHref(orgId, { logo_url: storedValue, settings: { logo_dark_url: storedValue } }, { variant: 'dark' })
        : orgLogoHref(orgId, { logo_url: storedValue }),
    })
  } catch (error) {
    console.error('Logo upload error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to upload logo'
    }, { status: 500 })
  }
}

// DELETE - Remove company logo (admin only)
export async function DELETE(request?: NextRequest) {
  try {
    const auth = await requireLogoAdmin()
    if (auth instanceof NextResponse) return auth
    const { orgId } = auth
    const adminClient = createServiceClient()

    const dark = isDarkVariant(new URL(request?.url ?? 'http://x').searchParams.get('variant'))
    await removeLogoObjects(adminClient, orgId, dark ? 'logo-dark.' : 'logo.')
    const updateError = dark ? await writeDarkLogo(adminClient, orgId, null) : await writeOrgLogo(adminClient, orgId, null)
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logo delete error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to delete logo'
    }, { status: 500 })
  }
}
