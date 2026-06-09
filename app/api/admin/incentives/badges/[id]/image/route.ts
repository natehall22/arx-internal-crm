import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BADGE_IMAGES_BUCKET = 'badge-images'
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const ADMIN_ROLES = new Set([
  'admin', 'owner', 'regional_manager', 'regional_setter_manager',
  'sales_manager', 'setter_manager', 'manager', 'operations',
])

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const badgeId = params.id

  // Auth — verify caller is admin in the same org as the badge
  const supabase = createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.has(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify badge belongs to this org
  const { data: badge } = await admin
    .from('incentive_badges')
    .select('id, org_id')
    .eq('id', badgeId)
    .eq('org_id', profile.org_id)
    .single()

  if (!badge) {
    return NextResponse.json({ error: 'Badge not found' }, { status: 404 })
  }

  // Parse multipart form
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and GIF are allowed' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File must be under 10 MB' }, { status: 400 })
  }

  const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
  const storagePath = `${profile.org_id}/${badgeId}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  // Upsert into storage (overwrite previous image for this badge)
  const { error: uploadError } = await admin.storage
    .from(BADGE_IMAGES_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: true,
      cacheControl: '604800', // 7 days
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage
    .from(BADGE_IMAGES_BUCKET)
    .getPublicUrl(storagePath)

  // Write URL back to badge row
  const { error: updateError } = await admin
    .from('incentive_badges')
    .update({ image_url: publicUrl })
    .eq('id', badgeId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ image_url: publicUrl })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const badgeId = params.id

  const supabase = createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.has(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: badge } = await admin
    .from('incentive_badges')
    .select('id, org_id, image_url')
    .eq('id', badgeId)
    .eq('org_id', profile.org_id)
    .single()

  if (!badge) {
    return NextResponse.json({ error: 'Badge not found' }, { status: 404 })
  }

  if (badge.image_url) {
    // Remove all extension variants for this badge
    for (const ext of ['jpg', 'png', 'webp', 'gif']) {
      await admin.storage
        .from(BADGE_IMAGES_BUCKET)
        .remove([`${profile.org_id}/${badgeId}.${ext}`])
    }
  }

  await admin
    .from('incentive_badges')
    .update({ image_url: null })
    .eq('id', badgeId)

  return NextResponse.json({ success: true })
}
