/**
 * Optional `--logo-url` for the demo company: download one image and store it where the admin logo upload does
 * (`org/<org>/logo.<ext>?v=<ts>` in the files bucket, in `orgs.logo_url` AND `orgs.settings.logo_url`), so every reader
 * (`orgLogoHref`) just works. Demo company only; a prospect's own logo is used for THEIR demo and never stored for anyone else.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { assertDemoOrg } from '@/lib/demo-org'
import { FILES_OBJECT_BUCKET } from '@/lib/files/files-object'
import { mergeOrgSettings } from '@/lib/org-settings'

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_BYTES = 2 * 1024 * 1024

export async function setDemoLogoFromUrl(admin: SupabaseClient, orgId: string, url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  await assertDemoOrg(admin, orgId)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('--logo-url is not a web address')
  }
  if (parsed.protocol !== 'https:') throw new Error('--logo-url must be https')
  const res = await fetchImpl(parsed.toString(), { redirect: 'follow' })
  if (!res.ok) throw new Error(`logo download failed (${res.status})`)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const ext = TYPES[type]
  if (!ext) throw new Error('the logo must be a PNG, JPEG or WebP image')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error('the logo must be under 2 MB')
  const path = `org/${orgId}/logo.${ext}`
  const up = await admin.storage.from(FILES_OBJECT_BUCKET).upload(path, bytes, { contentType: type, upsert: true })
  if (up.error) throw new Error(`logo upload: ${up.error.message}`)
  const stored = `${path}?v=${Date.now()}`
  const col = await admin.from('orgs').update({ logo_url: stored }).eq('id', orgId)
  if (col.error) throw new Error(`logo: ${col.error.message}`)
  const set = await mergeOrgSettings(admin, orgId, { logo_url: stored })
  if (set.error) throw new Error(`logo: ${set.error}`)
  return stored
}
