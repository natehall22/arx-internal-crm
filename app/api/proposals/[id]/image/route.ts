import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// POST - Upload property image for proposal
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify proposal belongs to user's org
    const { data: proposal, error: proposalError } = await adminClient
      .from('proposals')
      .select('id, org_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get the form data
    const formData = await request.formData()
    const file = formData.get('image') as File || formData.get('file') as File
    const imageType = formData.get('type') as string || 'property' // 'property' or 'inspection'
    const imageIndex = formData.get('index') as string || '0'
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type — accept anything that looks like an image, including
    // iPhone HEIC/HEIF photos (which arrive with mime image/heic or, when the
    // browser omits the mime, only as a .heic filename).
    const fileName = file.name || 'upload.jpg'
    const mime = (file.type || '').toLowerCase()
    const looksLikeImage =
      mime.startsWith('image/') ||
      /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(fileName)

    if (!looksLikeImage) {
      return NextResponse.json({
        error: 'Invalid file type. Please upload an image (JPG, PNG, WEBP, HEIC).',
      }, { status: 400 })
    }

    // Validate file size (max 10MB — matches inspection-photos bucket; full-res
    // iPhone photos routinely exceed 5MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({
        error: 'File too large. Maximum size is 10MB',
      }, { status: 400 })
    }

    const nameLower = fileName.toLowerCase()
    const isHeicByName = nameLower.endsWith('.heic') || nameLower.endsWith('.heif')
    const contentType =
      mime.startsWith('image/') && mime.length > 0
        ? mime
        : /\.png$/i.test(fileName)
          ? 'image/png'
          : isHeicByName
            ? 'image/heic'
            : 'image/jpeg'

    // Generate file path based on type
    const fileExt = fileName.split('.').pop() || 'jpg'
    const timestamp = Date.now()
    const filePath = imageType === 'inspection'
      ? `proposals/${profile.org_id}/${params.id}/inspection-${imageIndex}-${timestamp}.${fileExt}`
      : `proposals/${profile.org_id}/${params.id}/property-${timestamp}.${fileExt}`

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // For property images, delete old ones first
    if (imageType === 'property') {
      const { data: existingFiles } = await adminClient.storage
        .from('files')
        .list(`proposals/${profile.org_id}/${params.id}`, {
          search: 'property-'
        })

      if (existingFiles && existingFiles.length > 0) {
        const oldFiles = existingFiles.filter(f => f.name.startsWith('property-'))
        for (const oldFile of oldFiles) {
          await adminClient.storage
            .from('files')
            .remove([`proposals/${profile.org_id}/${params.id}/${oldFile.name}`])
        }
      }
    }

    // Upload new image
    const { error: uploadError } = await adminClient.storage
      .from('files')
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
    }

    // Get public URL with cache-busting timestamp
    const { data: urlData } = adminClient.storage
      .from('files')
      .getPublicUrl(filePath)

    // Add cache-busting parameter to prevent browser caching issues
    const imageUrl = `${urlData.publicUrl}?t=${timestamp}`

    // For property images, update proposal with cover image URL
    if (imageType === 'property') {
      const { error: updateError } = await adminClient
        .from('proposals')
        .update({ cover_image_url: imageUrl })
        .eq('id', params.id)

      if (updateError) {
        console.error('Update error:', updateError)
        return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
      }

      return NextResponse.json({ 
        success: true,
        cover_image_url: imageUrl,
      })
    }

    // For inspection photos, just return the URL
    return NextResponse.json({ 
      success: true,
      url: imageUrl,
      type: imageType,
      index: imageIndex,
    })
  } catch (error) {
    console.error('Image upload error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to upload image' 
    }, { status: 500 })
  }
}

// DELETE - Remove property image from proposal
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify proposal belongs to user's org
    const { data: proposal } = await adminClient
      .from('proposals')
      .select('id, org_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Delete image files from storage
    const { data: existingFiles } = await adminClient.storage
      .from('files')
      .list(`proposals/${profile.org_id}/${params.id}`, {
        search: 'property-'
      })

    if (existingFiles && existingFiles.length > 0) {
      const propertyFiles = existingFiles.filter(f => f.name.startsWith('property-'))
      for (const propertyFile of propertyFiles) {
        await adminClient.storage
          .from('files')
          .remove([`proposals/${profile.org_id}/${params.id}/${propertyFile.name}`])
      }
    }

    // Clear cover image URL from proposal
    await adminClient
      .from('proposals')
      .update({ cover_image_url: null })
      .eq('id', params.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Image delete error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete image' 
    }, { status: 500 })
  }
}
