import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

type RoofSection = {
  id?: string
  type?: string
  area_sqft?: number
  length_ft?: number
}

type EstimateConfig = {
  roofType: string
  wasteFactor: number
  layers: number
  manufacturer: string
  productLine: string
  preferredColor?: string
  replaceDecking: 'always' | 'if_needed' | 'never'
}

type PricebookItem = {
  id: string
  category?: string | null
  name?: string | null
  description?: string | null
  unit?: string | null
  unit_price?: number | null
  active?: boolean | null
}

type GeneratedLineItem = {
  pricebook_item_id: string | null
  category: string
  name: string
  quantity: number
  unit: string
  unit_price: number
  total_price: number
  is_labor: boolean
  is_taxable: boolean
  sort_order: number
}

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

const normalizeCategory = (value: string): 'roofing' | 'siding' | 'windows' | 'addons' => {
  const v = (value || '').toLowerCase()
  if (v === 'roofing' || v === 'siding' || v === 'windows' || v === 'addons') return v
  return 'addons'
}

const normalizeUnit = (value: string): 'square' | 'each' | 'lf' | 'sheet' | 'job' => {
  const v = (value || '').toLowerCase()
  if (v === 'square' || v === 'each' || v === 'lf' || v === 'sheet' || v === 'job') return v
  if (v === 'sq') return 'square'
  if (v === 'linear_feet' || v === 'foot' || v === 'feet') return 'lf'
  return 'each'
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function deterministicMath(roofSections: RoofSection[], wasteFactor: number) {
  const facets = roofSections.filter((s) => (s.type || '').toLowerCase() === 'facet')
  const ridgesLf = roofSections
    .filter((s) => (s.type || '').toLowerCase() === 'ridge')
    .reduce((sum, s) => sum + (Number(s.length_ft) || 0), 0)
  const valleysLf = roofSections
    .filter((s) => (s.type || '').toLowerCase() === 'valley')
    .reduce((sum, s) => sum + (Number(s.length_ft) || 0), 0)
  const stepFlashingLf = roofSections
    .filter((s) => (s.type || '').toLowerCase() === 'step_flash')
    .reduce((sum, s) => sum + (Number(s.length_ft) || 0), 0)
  const wallFlashingLf = roofSections
    .filter((s) => (s.type || '').toLowerCase() === 'wall_flash')
    .reduce((sum, s) => sum + (Number(s.length_ft) || 0), 0)

  const totalAreaSqft = facets.reduce((sum, s) => sum + (Number(s.area_sqft) || 0), 0)
  const totalSquares = totalAreaSqft / 100
  const squaresWithWaste = totalSquares * (1 + wasteFactor / 100)
  const bundles = Math.ceil(squaresWithWaste * 3)
  const underlaymentRolls = Math.ceil((squaresWithWaste * 100) / 400)
  const starterRolls = Math.ceil((ridgesLf + valleysLf + 60) / 100)
  const ridgeCapBundles = Math.ceil((ridgesLf + valleysLf) / 33)
  const flashingLf = stepFlashingLf + wallFlashingLf

  return {
    totalAreaSqft: round2(totalAreaSqft),
    totalSquares: round2(totalSquares),
    squaresWithWaste: round2(squaresWithWaste),
    ridgesLf: round2(ridgesLf),
    valleysLf: round2(valleysLf),
    flashingLf: round2(flashingLf),
    stepFlashingLf: round2(stepFlashingLf),
    wallFlashingLf: round2(wallFlashingLf),
    bundles,
    underlaymentRolls,
    starterRolls,
    ridgeCapBundles,
  }
}

function findPricebookItemByKeyword(items: PricebookItem[], keywords: string[]): PricebookItem | null {
  const lowered = keywords.map((k) => k.toLowerCase())
  return (
    items.find((item) => {
      const haystack = `${item.name || ''} ${item.description || ''} ${item.category || ''}`.toLowerCase()
      return lowered.every((kw) => haystack.includes(kw))
    }) || null
  )
}

function deterministicFallbackLines(math: ReturnType<typeof deterministicMath>, items: PricebookItem[]) {
  const shingles = findPricebookItemByKeyword(items, ['shingle']) || findPricebookItemByKeyword(items, ['install'])
  const underlayment = findPricebookItemByKeyword(items, ['underlayment'])
  const starter = findPricebookItemByKeyword(items, ['starter'])
  const ridgeCap = findPricebookItemByKeyword(items, ['ridge'])
  const drip = findPricebookItemByKeyword(items, ['drip'])
  const valley = findPricebookItemByKeyword(items, ['valley'])
  const step = findPricebookItemByKeyword(items, ['step', 'flash'])
  const wall = findPricebookItemByKeyword(items, ['wall', 'flash'])

  const candidates = [
    {
      item: shingles,
      category: 'roofing',
      name: shingles?.name || 'Shingles / install',
      quantity: math.squaresWithWaste,
      unit: shingles?.unit || 'square',
      unit_price: Number(shingles?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: underlayment,
      category: 'roofing',
      name: underlayment?.name || 'Underlayment',
      quantity: math.underlaymentRolls,
      unit: underlayment?.unit || 'each',
      unit_price: Number(underlayment?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: starter,
      category: 'roofing',
      name: starter?.name || 'Starter course',
      quantity: math.starterRolls,
      unit: starter?.unit || 'each',
      unit_price: Number(starter?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: ridgeCap,
      category: 'roofing',
      name: ridgeCap?.name || 'Ridge cap',
      quantity: math.ridgeCapBundles,
      unit: ridgeCap?.unit || 'each',
      unit_price: Number(ridgeCap?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: drip,
      category: 'roofing',
      name: drip?.name || 'Drip edge',
      quantity: math.ridgesLf + math.valleysLf > 0 ? Math.ceil((math.ridgesLf + math.valleysLf) / 10) : 0,
      unit: drip?.unit || 'each',
      unit_price: Number(drip?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: valley,
      category: 'roofing',
      name: valley?.name || 'Valley metal',
      quantity: math.valleysLf,
      unit: valley?.unit || 'lf',
      unit_price: Number(valley?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: step,
      category: 'addons',
      name: step?.name || 'Step flashing',
      quantity: math.stepFlashingLf,
      unit: step?.unit || 'lf',
      unit_price: Number(step?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
    {
      item: wall,
      category: 'addons',
      name: wall?.name || 'Wall flashing',
      quantity: math.wallFlashingLf,
      unit: wall?.unit || 'lf',
      unit_price: Number(wall?.unit_price) || 0,
      is_labor: false,
      is_taxable: true,
    },
  ]

  return candidates
    .filter((line) => line.quantity > 0 && line.unit_price >= 0)
    .map((line, index) => ({
      pricebook_item_id: line.item?.id || null,
      category: line.category,
      name: line.name,
      quantity: round2(line.quantity),
      unit: line.unit,
      unit_price: round2(line.unit_price),
      total_price: round2(line.quantity * line.unit_price),
      is_labor: line.is_labor,
      is_taxable: line.is_taxable,
      sort_order: index,
    }))
}

export async function POST(request: Request) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const body = await request.json().catch(() => ({}))
    const { opportunityId, roofSections, config } = body as {
      opportunityId?: string
      roofSections?: RoofSection[]
      config?: EstimateConfig
    }

    if (!opportunityId) {
      return NextResponse.json({ error: 'opportunityId is required' }, { status: 400 })
    }
    if (!Array.isArray(roofSections)) {
      return NextResponse.json({ error: 'roofSections is required' }, { status: 400 })
    }
    if (!config) {
      return NextResponse.json({ error: 'config is required' }, { status: 400 })
    }

    const facetSections = roofSections.filter((s) => (s.type || '').toLowerCase() === 'facet')
    if (
      facetSections.length > 0 &&
      facetSections.some((s) => !Number(s.area_sqft) || Number(s.area_sqft) <= 0)
    ) {
      return NextResponse.json(
        { error: 'Each roof facet must have a positive area (sq ft) before generating an estimate.' },
        { status: 400 }
      )
    }

    const math = deterministicMath(roofSections, Number(config.wasteFactor) || 12)

    const { data: opportunity } = await supabase
      .from('opportunities')
      .select('id, org_id, address_text, project_type, roof_squares, layers, notes')
      .eq('id', opportunityId)
      .eq('org_id', profile.org_id)
      .single()

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    let pricebookItemsQuery = supabase
      .from('pricebook_items')
      .select('id, name, description, category, unit, unit_price, is_labor, is_taxable, active')
      .eq('org_id', profile.org_id)
      .eq('active', true)

    const manufacturerToken = (config.manufacturer || '').trim().toLowerCase()
    let { data: pricebookItems } = await pricebookItemsQuery.limit(300)
    pricebookItems = pricebookItems || []

    if (manufacturerToken) {
      const narrowed = pricebookItems.filter((item) =>
        `${item.name || ''} ${item.description || ''}`.toLowerCase().includes(manufacturerToken)
      )
      if (narrowed.length > 0) {
        pricebookItems = narrowed
      }
    }

    let aiData: { matchedLineItems?: any[]; aiFlags?: string[]; scopeSummary?: string } = {}
    if (process.env.OPENAI_API_KEY) {
      const openai = getOpenAI()
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are an estimating assistant. Return JSON only: {"matchedLineItems":[],"aiFlags":[],"scopeSummary":""}. Match items to the supplied pricebook by id when possible, prefer requested manufacturer, add missing accessories, and flag risks.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              opportunity,
              config,
              deterministic: math,
              pricebook: pricebookItems.map((item) => ({
                id: item.id,
                category: item.category,
                name: item.name,
                description: item.description,
                unit: item.unit,
                unit_price: item.unit_price,
              })),
            }),
          },
        ],
        max_tokens: 1800,
      })

      aiData = safeJsonParse<any>(completion.choices?.[0]?.message?.content || '') || {}
    }

    const aiMatched = Array.isArray(aiData.matchedLineItems) ? aiData.matchedLineItems : []
    const aiFlags = Array.isArray(aiData.aiFlags) ? aiData.aiFlags.filter((f) => typeof f === 'string') : []
    const scopeSummary = typeof aiData.scopeSummary === 'string' ? aiData.scopeSummary : ''

    const normalizedFromAI: GeneratedLineItem[] = aiMatched
      .map((item, idx) => {
        const matchedById = pricebookItems.find((p) => p.id === item.pricebook_item_id) || null
        const matchedByName =
          matchedById ||
          (typeof item.description === 'string'
            ? pricebookItems.find((p) =>
                `${p.name || ''} ${p.description || ''}`.toLowerCase().includes(item.description.toLowerCase())
              ) || null
            : null)

        const quantity = round2(Number(item.quantity) || 0)
        const unitPrice = round2(Number(item.unit_price ?? matchedByName?.unit_price ?? 0))
        const name = String(item.name || item.description || matchedByName?.name || '').trim()
        const unit = String(item.unit || matchedByName?.unit || 'each')
        const category = String(item.category || matchedByName?.category || 'roofing')

        if (!name || quantity <= 0) return null

        return {
          pricebook_item_id: matchedByName?.id || null,
          category,
          name,
          quantity,
          unit,
          unit_price: unitPrice,
          total_price: round2(quantity * unitPrice),
          is_labor: Boolean(item.is_labor ?? (matchedByName as any)?.is_labor ?? false),
          is_taxable: Boolean(item.is_taxable ?? (matchedByName as any)?.is_taxable ?? true),
          sort_order: idx,
        }
      })
      .filter(Boolean) as GeneratedLineItem[]

    const lineItems = normalizedFromAI.length > 0 ? normalizedFromAI : deterministicFallbackLines(math, pricebookItems)
    const subtotal = round2(lineItems.reduce((sum, line) => sum + line.total_price, 0))
    const overheadPct = 15
    const overheadAmount = round2(subtotal * (overheadPct / 100))
    const total = round2(subtotal + overheadAmount)

    let linkedProjectId: string | null = null
    if (opportunity.address_text) {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('address_text', opportunity.address_text)
        .limit(1)
      linkedProjectId = projects?.[0]?.id || null
    }

    if (!linkedProjectId) {
      return NextResponse.json(
        { error: 'No linked project found for this opportunity. Create/send project first, then generate estimate.' },
        { status: 400 }
      )
    }

    const estimateInsertBase: Record<string, any> = {
      org_id: profile.org_id,
      opportunity_id: opportunityId,
      subtotal,
      overhead_pct: overheadPct,
      overhead_amount: overheadAmount,
      total,
      waste_factor_pct: Number(config.wasteFactor) || 12,
      roof_type: config.roofType || null,
      scope_text: scopeSummary || null,
      ai_flags: aiFlags,
      project_id: linkedProjectId,
    }

    let estimate: any = null
    let estimateError: any = null

    ;({ data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .insert({ ...estimateInsertBase, status: 'draft' })
      .select('*')
      .single())

    if (estimateError || !estimate) {
      return NextResponse.json({ error: estimateError?.message || 'Failed to create estimate' }, { status: 500 })
    }

    const lineRows = lineItems.map((line, idx) => ({
      estimate_id: estimate.id,
      org_id: profile.org_id,
      category: normalizeCategory(line.category),
      name: line.name,
      qty: line.quantity,
      unit: normalizeUnit(line.unit),
      unit_price: line.unit_price,
      is_labor: line.is_labor,
      is_taxable: line.is_taxable,
      pricebook_item_id: line.pricebook_item_id,
      sort_order: idx,
    }))

    const { data: insertedLines, error: linesError } = await supabase
      .from('estimate_lines')
      .insert(lineRows)
      .select('*')

    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 })
    }

    return NextResponse.json({
      estimate: {
        ...estimate,
        status: 'draft',
        ai_draft: true,
      },
      line_items: (insertedLines || []).map((line: any) => ({
        id: line.id,
        category: line.category,
        description: line.name,
        quantity: Number(line.qty) || 0,
        unit: line.unit,
        unit_price: Number(line.unit_price) || 0,
        total_price: Number(line.line_total) || 0,
        notes: null,
      })),
      ai_flags: aiFlags,
      scope_summary: scopeSummary,
      deterministic: math,
    })
  } catch (error) {
    console.error('AI estimate generation error:', error)
    return NextResponse.json({ error: 'Failed to generate estimate' }, { status: 500 })
  }
}
