import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: Request) {
  const { profile } = await requireAuth()
  const supabase = createClient()
  const body = await request.json().catch(() => ({}))
  const { searchParams } = new URL(request.url)
  const estimateId = body.estimate_id || searchParams.get('estimate_id')

  if (!estimateId) {
    return NextResponse.json({ error: 'estimate_id required' }, { status: 400 })
  }

  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, projects(*)')
    .eq('id', estimateId)
    .eq('org_id', profile.org_id)
    .single()

  if (!estimate) {
    return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
  }

  const { data: lines } = await supabase
    .from('estimate_lines')
    .select('*')
    .eq('estimate_id', estimateId)
    .order('sort_order', { ascending: true })

  // Build prompt for AI
  const linesText = lines?.map((l) => {
    return `${l.name}: ${l.qty} ${l.unit}${l.is_labor ? ' (labor)' : ''}`
  }).join('\n') || ''

  const prompt = `Write a professional, customer-friendly scope of work for a roofing estimate. Be clear, concise, and use plain language.

Project Details:
- Address: ${estimate.projects.address_text || 'N/A'}
- Roof squares: ${estimate.projects.roof_squares || 0}
- Siding squares: ${estimate.projects.siding_squares || 0}
- Windows: ${estimate.projects.total_windows || 0}
- Vents: ${estimate.projects.vents_count || 0}
- Layers: ${estimate.projects.layers || 1}

Estimate Lines:
${linesText}

Write a scope of work that:
1. Lists all work to be performed
2. Mentions materials included
3. Mentions any special considerations (steep roof, high work, etc.)
4. Is professional and customer-friendly
5. Is 3-5 paragraphs in length

Scope of Work:`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.7,
    })

    const scopeText = completion.choices[0]?.message?.content || ''

    // Update estimate with scope
    await supabase
      .from('estimates')
      .update({ scope_text: scopeText })
      .eq('id', estimateId)

    return NextResponse.json({ scope_text: scopeText })
  } catch (error: any) {
    console.error('AI error:', error)
    return NextResponse.json(
      { error: 'Failed to generate scope', details: error.message },
      { status: 500 }
    )
  }
}
