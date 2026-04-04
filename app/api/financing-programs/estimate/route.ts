import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeFinancedContractTotal } from '@/lib/financing'

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

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100
}

/**
 * Returns financed contract total and estimated monthly payment for reps.
 * Does not expose dealer_fee_percent.
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const programId = searchParams.get('program_id')
    const totalRaw = searchParams.get('total')
    const baseTotal = roundMoney(parseFloat(totalRaw || '0'))

    if (!programId || baseTotal <= 0) {
      return NextResponse.json(
        { error: 'program_id and positive total are required' },
        { status: 400 }
      )
    }

    const { data: program, error } = await adminClient
      .from('financing_programs')
      .select('id, org_id, lender_name, financing_rate, term_months, dealer_fee_percent')
      .eq('id', programId)
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .maybeSingle()

    if (error || !program) {
      return NextResponse.json({ error: 'Program not found' }, { status: 404 })
    }

    const { financedContractTotal, dealerFeeAmount: _fee } = computeFinancedContractTotal(
      baseTotal,
      program.dealer_fee_percent
    )

    const rate = Number(program.financing_rate) || 0
    const months = Number(program.term_months) || 60
    const monthlyRate = rate / 100 / 12
    let monthly_payment: number
    if (months <= 0) {
      monthly_payment = 0
    } else if (monthlyRate === 0) {
      monthly_payment = roundMoney(financedContractTotal / months)
    } else {
      monthly_payment = roundMoney(
        financedContractTotal *
          ((monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1))
      )
    }

    return NextResponse.json({
      financed_contract_total: financedContractTotal,
      monthly_payment,
      lender_name: program.lender_name,
    })
  } catch (err) {
    console.error('financing-programs estimate:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
