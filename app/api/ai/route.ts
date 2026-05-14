import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export type AIAction =
  | 'job_next_action'
  | 'job_profit_risk'
  | 'job_packet_summary'
  | 'notes_summary'
  | 'collection_followup_email'
  | 'change_order_draft'
  | 'chat'

type AIRequestBody = {
  action: string
  context: Record<string, any>
}

/** Structured CRM actions use JSON mode; align with other server routes (e.g. detect-roof). */
const STRUCTURED_MODEL = 'gpt-4o'

const SYSTEM_PROMPTS: Record<AIAction, string> = {
  job_next_action:
    "You are an operations assistant for a roofing company called ARX Roofing & Exteriors. Analyze the job state provided and return ONLY a JSON object with this shape: { action: string (max 15 words, specific instruction), priority: 'urgent' | 'normal' | 'low', reason: string (one sentence) }. No markdown, no explanation, just the JSON.",
  job_profit_risk:
    "You are a financial analyst for a roofing contractor. Analyze the job financials provided and return ONLY a JSON object: { riskLevel: 'high' | 'medium' | 'low', estimatedMarginPercent: number, warning: string | null, suggestion: string }. No markdown, just JSON.",
  job_packet_summary:
    'You are writing a job briefing for a roofing installation crew. Return ONLY a JSON object: { bullets: string[] } where bullets is an array of 3-5 specific, practical instructions for the crew. Be concrete. No fluff. No markdown in the bullets themselves.',
  notes_summary:
    'You are summarizing internal job notes for a roofing operations manager. Return ONLY a JSON object: { summary: string } where summary is 2-3 plain sentences capturing key decisions, status, and any outstanding items.',
  collection_followup_email:
    'You are writing a payment follow-up email for ARX Roofing & Exteriors. The job is complete. Be professional and warm. Return ONLY a JSON object: { subject: string, body: string }. The body should be 3-4 sentences. No markdown.',
  change_order_draft:
    'You are a roofing project manager at ARX Roofing & Exteriors. Draft a change order from the plain-language description provided. Return ONLY a JSON object: { title: string, description: string, notes: string }. Be professional and specific.',
  chat: 'You are an AI assistant built into the ARX Roofing & Exteriors CRM. Help with CRM tasks: leads, opportunities, jobs, scheduling, pricing, and team management. Be concise and practical. Return plain text responses.',
}

function isAIAction(action: string): action is AIAction {
  return action in SYSTEM_PROMPTS
}

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Server AI configuration missing' }, { status: 500 })
    }

    const body = (await request.json()) as AIRequestBody
    const { action, context } = body || {}

    if (!action || !isAIAction(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (typeof context !== 'object' || context === null || Array.isArray(context)) {
      return NextResponse.json({ error: 'Invalid context' }, { status: 400 })
    }

    const openai = getOpenAI()
    const userContent = JSON.stringify(context)

    if (action === 'chat') {
      const completion = await openai.chat.completions.create({
        model: STRUCTURED_MODEL,
        max_tokens: 1024,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.chat },
          { role: 'user', content: userContent },
        ],
      })
      const rawText = completion.choices[0]?.message?.content?.trim() ?? ''
      return NextResponse.json({ result: rawText })
    }

    const completion = await openai.chat.completions.create({
      model: STRUCTURED_MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS[action] },
        { role: 'user', content: userContent },
      ],
    })

    const rawText = completion.choices[0]?.message?.content?.trim() ?? ''

    try {
      const parsed = JSON.parse(rawText)
      return NextResponse.json({ result: JSON.stringify(parsed) })
    } catch {
      return NextResponse.json({ result: rawText })
    }
  } catch (error) {
    console.error('AI route error:', error)
    return NextResponse.json({ error: 'Failed to process AI request' }, { status: 500 })
  }
}
