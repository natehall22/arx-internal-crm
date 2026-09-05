import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function GET() {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // RLS-bound client: this dump deliberately shows what the *caller's own* policies
    // return for their comp-plan rows, which is the point of the endpoint.
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

    // Get ALL user_comp_plans for this user (no filters)
    const { data: allAssignments, error: assignError } = await supabase
      .from('user_comp_plans')
      .select('*')
      .eq('user_id', profile.id)

    // Get user_comp_plans with org_id filter
    const { data: orgAssignments, error: orgAssignError } = await supabase
      .from('user_comp_plans')
      .select('*, comp_plans(*)')
      .eq('user_id', profile.id)
      .eq('org_id', profile.org_id)

    // Try to get the most recent assignment
    const { data: latestAssignment, error: latestError } = await supabase
      .from('user_comp_plans')
      .select('*, comp_plans(*)')
      .eq('user_id', profile.id)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
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
