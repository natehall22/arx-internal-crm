import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const BUCKET = 'pricebook-item-images'
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
// Matches the role gate on the sibling pricebook_items mutation endpoints in /api/admin/pricing
const ADMIN_ROLES = new Set(['admin', 'operations'])

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const itemId = params.id

  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ADMIN_ROLES.has(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceClient()

  const { data: item } = await admin
    .from('pricebook_items')
    .select('id, org_id')
    .eq('id', itemId)
    .eq('org_id', profile.org_id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Price item not found' }, { status: 404 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and GIF are allowed' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File must be under 5 MB' }, { status: 400 })
  }

  const mimeSubtype = file.type.split('/')[1]
  if (!mimeSubtype) {
    return NextResponse.json({ error: 'Invalid MIME type' }, { status: 400 })
  }
  const ext = mimeSubtype.replace('jpeg', 'jpg')
  const storagePath = `${profile.org_id}/${itemId}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  // Clean up any previous upload under a different extension so switching
  // file types (e.g. jpg -> png) doesn't leave an orphaned object behind
  const otherExts = ['jpg', 'png', 'webp', 'gif'].filter((e) => e !== ext)
  if (otherExts.length > 0) {
    await admin.storage
      .from(BUCKET)
      .remove(otherExts.map((e) => `${profile.org_id}/${itemId}.${e}`))
  }

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: true,
      cacheControl: '604800', // 7 days
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(storagePath)

  const { error: updateError } = await admin
    .from('pricebook_items')
    .update({ image_url: publicUrl })
    .eq('id', itemId)
    .eq('org_id', profile.org_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ image_url: publicUrl })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const itemId = params.id

  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ADMIN_ROLES.has(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceClient()

  const { data: item } = await admin
    .from('pricebook_items')
    .select('id, org_id, image_url')
    .eq('id', itemId)
    .eq('org_id', profile.org_id)
    .single()

  if (!item) {
    return NextResponse.json({ error: 'Price item not found' }, { status: 404 })
  }

  if (item.image_url) {
    for (const ext of ['jpg', 'png', 'webp', 'gif']) {
      await admin.storage.from(BUCKET).remove([`${profile.org_id}/${itemId}.${ext}`])
    }
  }

  const { error: updateError } = await admin
    .from('pricebook_items')
    .update({ image_url: null })
    .eq('id', itemId)
    .eq('org_id', profile.org_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
