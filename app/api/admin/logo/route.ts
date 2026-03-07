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

// POST - Upload company logo (admin only)
export async function POST(request: NextRequest) {
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

    // Get user profile and check admin access
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Only admins can upload logo
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can upload company logo' }, { status: 403 })
    }

    // Get the form data
    const formData = await request.formData()
    const file = formData.get('logo') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ 
        error: 'Invalid file type. Allowed: PNG, JPG, WEBP, SVG' 
      }, { status: 400 })
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ 
        error: 'File too large. Maximum size is 2MB' 
      }, { status: 400 })
    }

    // Generate file path
    const fileExt = file.name.split('.').pop() || 'png'
    const filePath = `org/${profile.org_id}/logo.${fileExt}`

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Delete old logo if exists (different extension)
    const { data: existingFiles } = await adminClient.storage
      .from('files')
      .list(`org/${profile.org_id}`, {
        search: 'logo'
      })

    if (existingFiles && existingFiles.length > 0) {
      const oldFiles = existingFiles.filter(f => f.name.startsWith('logo.'))
      for (const oldFile of oldFiles) {
        await adminClient.storage
          .from('files')
          .remove([`org/${profile.org_id}/${oldFile.name}`])
      }
    }

    // Upload new logo
    const { error: uploadError } = await adminClient.storage
      .from('files')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = adminClient.storage
      .from('files')
      .getPublicUrl(filePath)

    const logoUrl = urlData.publicUrl

    // Update org with logo URL
    // Try direct column first, fall back to settings
    let { error: updateError } = await adminClient
      .from('orgs')
      .update({ logo_url: logoUrl })
      .eq('id', profile.org_id)

    if (updateError && updateError.message.includes('column')) {
      // Column doesn't exist, store in settings
      const { data: org } = await adminClient
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      const { error: settingsError } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...(org?.settings || {}),
            logo_url: logoUrl,
          }
        })
        .eq('id', profile.org_id)

      if (settingsError) {
        return NextResponse.json({ error: settingsError.message }, { status: 500 })
      }
    } else if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      logo_url: logoUrl,
    })
  } catch (error) {
    console.error('Logo upload error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to upload logo' 
    }, { status: 500 })
  }
}

// DELETE - Remove company logo (admin only)
export async function DELETE(request: NextRequest) {
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
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can remove company logo' }, { status: 403 })
    }

    // Delete logo files from storage
    const { data: existingFiles } = await adminClient.storage
      .from('files')
      .list(`org/${profile.org_id}`, {
        search: 'logo'
      })

    if (existingFiles && existingFiles.length > 0) {
      const logoFiles = existingFiles.filter(f => f.name.startsWith('logo.'))
      for (const logoFile of logoFiles) {
        await adminClient.storage
          .from('files')
          .remove([`org/${profile.org_id}/${logoFile.name}`])
      }
    }

    // Clear logo URL from org
    let { error: updateError } = await adminClient
      .from('orgs')
      .update({ logo_url: null })
      .eq('id', profile.org_id)

    if (updateError && updateError.message.includes('column')) {
      // Column doesn't exist, clear from settings
      const { data: org } = await adminClient
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      const settings = org?.settings || {}
      delete settings.logo_url

      await adminClient
        .from('orgs')
        .update({ settings })
        .eq('id', profile.org_id)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logo delete error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete logo' 
    }, { status: 500 })
  }
}
