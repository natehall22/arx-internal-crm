import { getAiChatRecordUrl } from '@/lib/ai/chat-record-url'

export type AiChatFallbackContext = {
  type: string
  id?: string
} | null

/** Swap [id] placeholders for the record the user is on. */
function paveRecordPath(text: string, context?: AiChatFallbackContext): string {
  if (!context?.id || !getAiChatRecordUrl(context.type, context.id)) {
    return text
  }
  const url = getAiChatRecordUrl(context.type, context.id)!
  return text.replace(/\/\[id\]/g, url).replace(/\[id\]/g, context.id)
}

const COMMON_GUIDE = `
## ARX CRM — where things go

### Sales pipeline
- **Add a lead**: Leads → **New Lead** (\`/leads/new\`) or Canvass map (\`/canvass\`) — drop a pin and disposition.
- **Work a lead**: Leads → open the lead (\`/leads/[id]\`). Notes, status, and contact info live on that page.
- **Schedule an inspection**: From the lead detail page, use **Schedule inspection** (or **Calendar** \`/calendar\` / **Appointments** \`/appointments\`).
- **Opportunities (post-inspection)**: **Opportunities** (\`/opportunities\`) — pipeline after an inspection is set.
- **Close / contract**: Opportunity detail (\`/opportunities/[id]\`) → send/upload contract. Won deals create a **project**.
- **Proposals**: **Proposals** (\`/proposals\`) or builder (\`/proposals/builder\`). Tie to opportunity when building pricing.
- **Projects (sold jobs)**: **Projects** (\`/projects\`) — post-close production handoff; links to ops jobs.

### Operations (Steve / ops team)
- **Job Board**: **Job Board** (\`/ops\`) — all production jobs, status columns, materials, scheduling. Ops dashboard: \`/ops/dashboard\`; production calendar: \`/ops/calendar\`.
- **Single job file**: Job Board → open job (\`/ops/jobs/[id]\`) — overview (schedule/crew), materials, photos/files, financials, notes.
- **Crew / sub assignment**: Job **Overview** tab → **Schedule now** or **Reassign crew or sub** (schedule modal).
- **Labor cost**: Job → **Materials** tab → **Labor Cost** card (not the read-only **Financials** profitability summary).
- **Material orders / material cost**: **Materials** tab → **+ Add Material Order** inline, or full list at \`/ops/jobs/[id]/orders\`; orders roll up to total materials cost.
- **Itemized cost lines** (permit, dump, misc): Job → **Photos & files** tab → **Job Files Workspace** → add a **cost line**.
- **Work orders**: **Financials** tab → **Work Orders** card (**+ New Work Order**), or **Work Orders** (\`/work-orders\`) board.
- **Sub portal**: Subs see assigned jobs at \`/subs/jobs\` and work orders at \`/subs/work-orders\`.

### Commissions & payroll
- **My commissions**: **Commissions** (\`/commissions/statement\`) or Dashboard widgets.
- **Team commissions**: \`/commissions/team\` (managers).
- **Payroll / bonuses (admin)**: **Admin → Payroll** (\`/admin/payroll\`).

### Canvassing (setters)
- **Door knocking map**: **Canvass** (\`/canvass\`) — pins, dispositions, offline queue, territories.
- **Territories**: \`/canvass/territories\` or Admin → Canvass Territories.
- **444 program**: **Sisu** (\`/sisu\`) — door/inspection counts and weekly bonuses.
- **Setter ramp (444 onboarding)**: **Admin → Sisu → Setter Ramp** (\`/admin/sisu/setter-ramp\`) — new setter onboarding and ramp targets.

### Tools & admin
- **Roof measure (aerial)**: **Tools → Roof Measure** (\`/tools/roof-measure\`).
- **Reports**: **Reports** (\`/reports\`) and custom builder (\`/reports/builder\`).
- **Settings (personal)**: **Settings** (\`/settings\`) — notifications, calendar, **AI Assistant toggle**.
- **Admin hub**: \`/admin\` — users, teams, pricing, territories, integrations.

### Typical flow
Canvass pin → Lead → Schedule inspection → Opportunity → Proposal → Contract signed → Project → Ops job → Complete → Collected → Payroll.

### AI assistant rules (Phase 1)
- You help users **find** features and **explain** where data belongs. You do **not** change CRM data yet.
- When answering "where does X go?", give the menu path, the page URL pattern, and the specific field or section name.
- If the user is on a record (lead/opportunity/project), reference that record when relevant.
- If unsure, say which page to check rather than guessing.
`.trim()

const ROLE_HINTS: Record<string, string> = {
  admin: 'This user is an admin — they can access Admin, Payroll, user management, and all ops/financial fields.',
  owner: 'This user is an owner — full access including Admin, Payroll, and job financials.',
  operations: 'This user is operations — prioritize Ops (\`/ops\`), job files, labor/material costs, work orders, and crew/sub assignment.',
  sales_manager: 'This user is a sales manager — emphasize Dashboard, Opportunities, team commissions, and scheduling.',
  regional_manager: 'This user is a regional manager — emphasize territories, team performance, and commissions.',
  sales_rep: 'This user is a sales rep — emphasize Leads, Opportunities, Proposals, and their commission statement.',
  setter_manager: 'This user is a setter manager — emphasize Canvass territories, setter team performance, and inspections.',
  regional_setter_manager: 'This user is a regional setter manager — emphasize territories, setter teams, and 444 program metrics.',
  rep: 'This user is a sales rep — emphasize Leads, Opportunities, Proposals, and commissions.',
  custom: 'This user has a custom role — ask what they are trying to do and map them to the closest CRM workflow.',
  setter: 'This user is a setter — emphasize Canvass (\`/canvass\`), leads, and scheduling inspections.',
  inside_sales: 'This user is inside sales — emphasize inbound leads, opportunities, and scheduling.',
  call_center: 'This user is call center — emphasize lead follow-up, appointments, and inside-sales workflows.',
  canvasser: 'This user is a canvasser — emphasize Canvass (\`/canvass\`), leads, and scheduling inspections.',
  closer: 'This user is a closer — emphasize Opportunities, appointments/calendar, contracts, and closing workflow.',
}

export function getRoleNavigationHint(role: string | null | undefined): string {
  if (!role) return ''
  const hint = ROLE_HINTS[role]
  return hint ? `\n\nRole focus: ${hint}` : ''
}

export function buildAiChatSystemPrompt(params: {
  fullName: string
  role: string
  recordContextAppendix?: string
  aggregateContextAppendix?: string
}): string {
  const {
    fullName,
    role,
    recordContextAppendix = '',
    aggregateContextAppendix = '',
  } = params
  const aggregateRules = aggregateContextAppendix
    ? '\nWhen CRM aggregate snapshot data is present, lead with the exact count or dollar amount, then one short how-to. Cite only numbers listed in the aggregate block — never invent counts.'
    : '\nIf the user asks for counts or totals you do not have, point them to the live list page (/leads, /opportunities, /ops, /commissions/statement) — never guess or send them to /reports for basic pipeline counts.'
  const recordRules =
    recordContextAppendix || aggregateContextAppendix
      ? '\nWhen a current record URL or aggregate snapshot is present, lead with the deep link path or the number, then one short how-to — no long lectures.'
      : ''
  return `You are an AI assistant for ARX CRM, used by ARX Roofing & Exteriors (residential storm/insurance roofing).

Your primary job in this version is **navigation and guidance**:
- Tell users what goes where in the CRM
- Explain how to access the right page, section, or field
- Suggest next steps in the sales or ops workflow
- Answer questions about CRM features using the guide below

User: ${fullName}
Role: ${role}
${getRoleNavigationHint(role)}

${COMMON_GUIDE}${recordContextAppendix}${aggregateContextAppendix}${recordRules}${aggregateRules}

Be concise, helpful, and professional. Prefer numbered steps with exact menu names and URL paths. If you do not know something specific about their live data, point them to the right page to verify.

Never repeat or request phone numbers, emails, or private notes. Record context is intentionally minimal.`
}

export function getNavigationFallbackResponse(
  message: string,
  role: string,
  context?: AiChatFallbackContext
): string | null {
  const lower = message.toLowerCase()

  if (
    lower.includes('labor cost') ||
    lower.includes('job cost') ||
    (lower.includes('material cost') && !/\b(order|ordering)\b/.test(lower)) ||
    lower.includes('enter cost') ||
    (/\b(pay|paid)\b/.test(lower) && /\b(sub|labor|job|material|vendor|supplier)\b/.test(lower))
  ) {
    return paveRecordPath(
      `Job costs in ARX go in different places depending on what you mean:

1. **Sub labor total** → Job Board → open the job (\`/ops/jobs/[id]\`) → **Materials** tab → **Labor Cost** card
2. **Materials** → same **Materials** tab — **+ Add Material Order** or \`/ops/jobs/[id]/orders\`
3. **Permits, dump, misc line items** → **Photos & files** tab → **Job Files Workspace** → add a **cost line**

Start at **Job Board** (\`/ops\`) to find the job by address if you are not already on it.`,
      context
    )
  }

  if (
    /\b(material order|materials order|order material|add material order)\b/.test(lower) ||
    (lower.includes('material') && /\b(order|ordering)\b/.test(lower))
  ) {
    return paveRecordPath(
      `Material orders on a job:
1. Open the job (\`/ops/jobs/[id]\`) → **Materials** tab
2. Click **+ Add Material Order** inline, or open the full list at \`/ops/jobs/[id]/orders\`
3. Orders roll up to total materials cost on the job`,
      context
    )
  }

  if (
    /\b(crew|sub\b|subcontractor)\b/.test(lower) &&
    (/\b(assign|schedule|reassign|who|put)\b/.test(lower) ||
      lower.includes('crew') ||
      /\bsub\b/.test(lower))
  ) {
    return paveRecordPath(
      `Crew / sub assignment:
1. Open the job (\`/ops/jobs/[id]\`) → **Overview** tab
2. Click **Schedule now** or **Reassign crew or sub** in the schedule modal
3. Pick the sub/crew and install date`,
      context
    )
  }

  if (
    (/\b(status|what'?s next|next step|what do i do)\b/.test(lower) &&
      (/\b(job|this)\b/.test(lower) || context?.type === 'job')) ||
    (context?.type === 'job' && /\b(next|status|stuck|waiting)\b/.test(lower))
  ) {
    return paveRecordPath(
      `For this ops job, check the **Overview** tab on \`/ops/jobs/[id]\` for current status and schedule. Common next steps by stage:
- **Sold / Material Ordering** → place material order on **Materials** tab
- **Scheduled** → confirm crew/sub assignment on **Overview**
- **In Progress** → upload completion photos on **Photos & files**
- **Complete** → enter final costs (labor, materials, cost lines) before collected`,
      context
    )
  }

  if (
    /\b(pipeline|leads this week|my leads|open opport|how many leads?|how many opp|lead count)\b/.test(
      lower
    )
  ) {
    return `Your pipeline live lists:
- **My leads this week** → **Leads** (\`/leads\`) — filter by your name
- **Open opportunities** → **Opportunities** (\`/opportunities\`)
- **Jobs by status** → **Job Board** (\`/ops\`)

If I have your counts in context I will cite them directly; otherwise open those pages for live numbers.`
  }

  if (
    /\b(permit|dump fee|cost line|misc cost|itemized cost)\b/.test(lower) ||
    (lower.includes('cost line') && /\b(add|enter|where)\b/.test(lower))
  ) {
    return paveRecordPath(
      `Itemized cost lines (permits, dump, misc):
1. Open the job (\`/ops/jobs/[id]\`) → **Photos & files** tab
2. In **Job Files Workspace**, add a **cost line**
3. Labor and material totals stay on the **Materials** tab — cost lines are for permit/dump/misc items`,
      context
    )
  }

  if (
    /\b(commission|commissions|payroll|my pay)\b/.test(lower) ||
    (/\bpaid\b/.test(lower) &&
      /\b(commission|payroll|rep)\b/.test(lower) &&
      !/\b(sub|job|labor|material|vendor|supplier)\b/.test(lower)) ||
    (/\bpay\b/.test(lower) &&
      /\b(commission|payroll|rep)\b/.test(lower) &&
      !/\b(sub|job|labor|material)\b/.test(lower))
  ) {
    if (role === 'admin' || role === 'owner' || role === 'operations') {
      return `Commissions & payroll:
- Reps view statements at **Commissions** (\`/commissions/statement\`)
- Managers: **Commissions → Team** (\`/commissions/team\`)
- Admin payroll approval: **Admin → Payroll** (\`/admin/payroll\`)
- Subcontractor pay stays in **job costs** on the ops job, not rep commission statements.`
    }
    return `Your commissions are under **Commissions** (\`/commissions/statement\`). You can also see summary widgets on the **Dashboard** (\`/dashboard\`). Ask an admin if your comp plan looks wrong.`
  }

  if (lower.includes('canvass') || lower.includes('door') || lower.includes('pin')) {
    return `Canvassing lives at **Canvass** (\`/canvass\`):
- Drop pins on the map and pick a disposition (not home, hot lead, go back, etc.)
- Works offline — pins sync when you are back online
- Territories: \`/canvass/territories\` or Admin → Canvass Territories`
  }

  if (
    lower.includes('inspection') ||
    lower.includes('appointment') ||
    (/\bschedule\b/.test(lower) && !/\b(sub|crew|job|install|production)\b/.test(lower))
  ) {
    return `Scheduling inspections:
1. Open the **lead** (\`/leads/[id]\`) and use **Schedule inspection**, or
2. Use **Calendar** (\`/calendar\`) or **Appointments** (\`/appointments\`) to see upcoming visits
3. Closers are assigned automatically via round-robin when scheduling from a lead`
  }

  if (lower.includes('proposal') || lower.includes('estimate') || lower.includes('price')) {
    return `Proposals & pricing:
- **Proposals** (\`/proposals\`) lists all proposals
- **Proposal builder** (\`/proposals/builder\`) creates pricing from the pricebook
- **Roof measure tool** (\`/tools/roof-measure\`) for aerial square footage
- Tie proposals to the opportunity from the opportunity detail page`
  }

  if (
    /\b(contract|signed|sign contract)\b/.test(lower) ||
    (/\bclose\b/.test(lower) && /\b(opportunity|deal|contract|won)\b/.test(lower))
  ) {
    return `Closing a deal:
1. Open the **opportunity** (\`/opportunities/[id]\`)
2. Send or upload the signed **contract**
3. When marked won, a **project** is created and ops gets a **production job** in **Ops** (\`/ops\`)`
  }

  if (
    lower.includes('where') ||
    lower.includes('how do i') ||
    lower.includes('how to') ||
    lower.includes('find') ||
    lower.includes('access') ||
    lower.includes('navigate') ||
    lower.includes('go to')
  ) {
    return `I can point you to the right place in ARX CRM. Common areas:

- **Leads** → \`/leads\` | **Opportunities** → \`/opportunities\` | **Job Board** → \`/ops\`
- **Canvass map** → \`/canvass\` | **Calendar** → \`/calendar\` | **Commissions** → \`/commissions/statement\`
- **Settings / enable AI** → \`/settings\` (AI Assistant tab)

Tell me what you are trying to do (e.g. "enter labor cost", "schedule inspection", "view commissions") and I will give exact steps.`
  }

  return null
}

export function generateContextualSuggestions(
  contextType: string | null,
  _contextId: string | null
): string[] {
  switch (contextType) {
    case 'lead':
      return [
        'Where do I schedule an inspection for this lead?',
        'What should I do next with this lead?',
        'How does this lead become an opportunity?',
      ]
    case 'opportunity':
      return [
        'How do I close this opportunity?',
        'Where do I build a proposal for this deal?',
        'What happens after the contract is signed?',
      ]
    case 'project':
      return [
        'Where is the ops job for this project?',
        'What are the next steps after a project is created?',
        'How do I open the production job file?',
      ]
    case 'job':
      return [
        'Where do I enter labor cost on this job?',
        'How do I add a material order for this job?',
        'How do I assign a crew or sub on this job?',
        "What does this job's status mean and what's next?",
        'Where do I add permits, dump, or misc cost lines?',
      ]
    default:
      return [
        'Where do I enter labor cost on a job?',
        'How many leads do I have this week?',
        'Where do I find my commissions?',
        'How do I schedule an inspection?',
      ]
  }
}
