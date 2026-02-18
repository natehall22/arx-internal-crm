import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function GET() {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
        },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated', authError }, { status: 401 })
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, full_name, role, org_id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      return NextResponse.json({ error: 'Profile error', profileError }, { status: 400 })
    }

    // Get ALL user_comp_plans for this user (no filters)
    const { data: allAssignments, error: assignError } = await supabase
      .from('user_comp_plans')
      .select('*')
      .eq('user_id', user.id)

    // Get user_comp_plans with org_id filter
    const { data: orgAssignments, error: orgAssignError } = await supabase
      .from('user_comp_plans')
      .select('*, comp_plans(*)')
      .eq('user_id', user.id)
      .eq('org_id', profile.org_id)

    // Try to get the most recent assignment
    const { data: latestAssignment, error: latestError } = await supabase
      .from('user_comp_plans')
      .select('*, comp_plans(*)')
      .eq('user_id', user.id)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
      },
      profile,
      allAssignments: {
        data: allAssignments,
        error: assignError,
      },
      orgAssignments: {
        data: orgAssignments,
        error: orgAssignError,
      },
      latestAssignment: {
        data: latestAssignment,
        error: latestError,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 })
  }
}
