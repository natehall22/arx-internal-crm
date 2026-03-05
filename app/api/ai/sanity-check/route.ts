import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { validateRequiredAdders } from '@/lib/required-adders'
import OpenAI from 'openai'

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
}

export async function GET(request: Request) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const estimateId = searchParams.get('estimate_id')

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

  // Rules-based validation first
  const requiredAdderIssues = validateRequiredAdders(lines || [], estimate.projects)

  const missingItems: string[] = []
  const warnings: string[] = []
  const questionsForRep: string[] = []

  // Check for missing required adders
  requiredAdderIssues.forEach((issue) => {
    if (issue.type === 'missing') {
      missingItems.push(issue.message)
    } else {
      warnings.push(issue.message)
    }
  })

  // Additional rules-based checks
  const laborLines = lines?.filter((l) => l.is_labor) || []
  const materialLines = lines?.filter((l) => !l.is_labor) || []

  if (laborLines.length === 0 && materialLines.length > 0) {
    warnings.push('No labor lines found - verify if this is materials-only')
  }

  if (estimate.projects.roof_squares && estimate.projects.roof_squares > 0) {
    const roofInstallLines = lines?.filter(
      (l) => l.category === 'roofing' && l.name.toLowerCase().includes('install')
    ) || []
    if (roofInstallLines.length === 0) {
      questionsForRep.push('Roof squares specified but no roof install line found - is this correct?')
    }
  }

  // Optional: Use AI for additional suggestions
  let aiSuggestions: string[] = []
  try {
    const prompt = `You are reviewing a roofing estimate. Here are the estimate lines:
${lines?.map((l) => `- ${l.name}: ${l.qty} ${l.unit} @ $${l.unit_price} = $${l.line_total}`).join('\n')}

Project details:
- Roof squares: ${estimate.projects.roof_squares || 0}
- Siding squares: ${estimate.projects.siding_squares || 0}
- Windows: ${estimate.projects.total_windows || 0}
- Vents: ${estimate.projects.vents_count || 0}
- Layers: ${estimate.projects.layers || 1}

Provide 2-3 brief suggestions for missing items or potential issues. Be concise.`

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    })

    aiSuggestions = completion.choices[0]?.message?.content
      ?.split('\n')
      .filter((line) => line.trim().length > 0)
      .slice(0, 3) || []
  } catch (error) {
    console.error('AI error:', error)
    // Continue without AI suggestions
  }

  return NextResponse.json({
    missing_items: missingItems,
    warnings: [...warnings, ...aiSuggestions],
    questions_for_rep: questionsForRep,
  })
}
