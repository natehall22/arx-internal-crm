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
  const prefixByType: Record<string, string> = {
    lead: '/leads/',
    opportunity: '/opportunities/',
    project: '/projects/',
    job: '/ops/jobs/',
  }
  const prefix = prefixByType[context.type]
  if (!prefix) {
    return text
  }
  // Replace only placeholders under this record's path prefix — never splice the full record URL
  // (that used to turn `/ops/jobs/[id]` into `/ops/jobs/ops/jobs/<uuid>`).
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const segmentRe = new RegExp(`${escaped}\\[id\\]`, 'g')
  return text.replace(segmentRe, `${prefix}${context.id}`)
}

const COMMON_GUIDE = `
## ARX CRM — where things go

### Sales pipeline
- **Add a lead**: Leads → **New Lead** (\`/leads/new\`) or Canvass map (\`/canvass\`) — drop a pin and disposition.
- **Work a lead**: Leads → open the lead (\`/leads/[id]\`). Notes, status, and contact info live on that page.
- **Schedule an inspection**: From the lead detail page, use **Schedule inspection** (or **Calendar** \`/calendar\` / **Appointments** \`/appointments\`).
- **Opportunities (post-inspection)**: **Opportunities** (\`/opportunities\`) — pipeline after an inspection is set.
- **Roof Report (inspection photo PDF for homeowner)**: Opportunity detail → **Roof Report** card → **Start Roof Report** / **Open Report Builder** → \`/opportunities/[id]/report\`. Field roof-report photos live here — **not** Job Board **Photos & files**.
- **Opportunity measure**: \`/opportunities/[id]/measure\` (print: \`/opportunities/[id]/measure/print\`).
- **Close / contract**: Opportunity detail (\`/opportunities/[id]\`) → send/upload contract. Won deals create a **project**.
- **Proposals**: **Proposals** (\`/proposals\`) or builder (\`/proposals/builder\`). Tie to opportunity when building pricing.
- **Proposal inspection photos (PDF, max 6)**: open proposal \`/proposals/[id]\` → **Inspection Photos** section. Distinct from Roof Report Builder and from job production photos.
- **Projects (sold jobs)**: **Projects** (\`/projects\`) — post-close production handoff; links to ops jobs.
- **Customers**: **Customers** (\`/customers\`) → customer detail \`/customers/[id]\`.
- **Referrals**: On a lead with source referral → **Referral Information** card on \`/leads/[id]\`. Referrer payouts / linked deals → customer \`/customers/[id]\` (**Referrals** tab).
- **Pricebook**: **Pricebook** (\`/pricebook\`) — catalog used by proposal builder.
- **Inside Sales**: **Inside Sales** (\`/inside-sales\`) — didn’t-sit, handoff, knockback, storm, and **insurance** follow-up calling (call-center workflow).
- **Insurance follow-up (closer outcome)**: After close feedback marks **Insurance Follow Up**, scheduling uses the insurance follow-up appointment type; ongoing dials surface on **Inside Sales** (\`/inside-sales\`) — there is no separate insurance page.
- **Close feedback**: \`/appointments/close-feedback\` (post-appointment closer outcome form).
- Do **not** send users to \`/jobs\` for production — that redirects to **Projects**; production job file is \`/ops/jobs/[id]\`.

### Operations (Steve / ops team)
- **Job Board**: **Job Board** (\`/ops\`) — all production jobs, status columns, materials, scheduling. Ops dashboard: \`/ops/dashboard\`; production calendar: \`/ops/calendar\`.
- **Single job file**: Job Board → open job (\`/ops/jobs/[id]\`) — tabs: **Overview**, **Materials**, **Financials** (permissioned), **Photos & files**, **Notes**.
- **Photo types on a job**: \`/ops/jobs/[id]\` → **Photos & files** — production / final install photos, Job Files Workspace, cost lines. **Not** for the customer Roof Report built during inspection.
- **Materials Order List (computed takeoff)**: **Materials** tab → **Materials Order List** card; print \`/ops/jobs/[id]/material-order/print\`. Supplier sheet from measurements — separate from **+ Add Material Order** cost rows (\`/ops/jobs/[id]/orders\`).
- **Job materials brief / sold add-ons**: Sold proposal adders (gutters, decking, etc.) show on the ops job brief card for visibility; ordering adders may still be manual ops practice — do not claim adders auto-flow into supplier PO unless asked.
- **Crew / sub assignment**: Job **Overview** tab → **Schedule now** or **Reassign crew or sub** (schedule modal).
- **Labor cost**: Job → **Materials** tab → **Labor Cost** card (not the read-only **Financials** profitability summary).
- **Material orders / material cost**: **Materials** tab → **+ Add Material Order** inline, or full list at \`/ops/jobs/[id]/orders\`; orders roll up to total materials cost.
- **Itemized cost lines** (permit, dump, misc): Job → **Photos & files** tab → **Job Files Workspace** → add a **cost line**.
- **Notes tab**: \`/ops/jobs/[id]\` → **Notes**.
- **Ops measure**: \`/ops/jobs/[id]/measure\`.
- **Work orders**: **Financials** tab → **Work Orders** card (**+ New Work Order**), or **Work Orders** (\`/work-orders\`) board.
- **Sub portal**: Subs see assigned jobs at \`/subs/jobs\` and work orders at \`/subs/work-orders\`.

### Commissions & payroll
- **My commissions**: **Commissions** (\`/commissions/statement\`) or Dashboard widgets.
- **Team commissions**: \`/commissions/team\` (managers).
- **Commission estimator**: \`/commissions/estimator\`.
- **Payroll / bonuses (admin)**: **Admin → Payroll** (\`/admin/payroll\`) — subpages include \`/admin/payroll/periods\`, statements, weekly; start at the payroll hub unless the user asks for a specific subpage.

### Canvassing (setters)
- **Door knocking map**: **Canvass** (\`/canvass\`) — pins, dispositions, offline queue, territories.
- **Territories**: \`/canvass/territories\` or Admin → Canvass Territories (\`/admin/canvass-territories\`).
- **Canvass stats / settings**: \`/canvass/stats\`, \`/canvass/settings\`.
- **444 program / Incentives**: **Sisu** (\`/sisu\`) — door/inspection counts and weekly bonuses; admin 444 hub \`/admin/sisu/444\`.
- **Setter ramp (444 onboarding)**: **Admin → Sisu → Setter Ramp** (\`/admin/sisu/setter-ramp\`) — new setter onboarding and ramp targets.

### Tools & admin
- **Roof measure (aerial)**: **Tools → Roof Measure** (\`/tools/roof-measure\`).
- **Reports**: **Reports** (\`/reports\`), custom builder (\`/reports/builder\`), coaching (\`/reports/coaching\`).
- **Notifications**: \`/notifications\`.
- **Settings (personal)**: **Settings** (\`/settings\`) — calendar, **AI Assistant toggle**.
- **Admin hub**: \`/admin\` — users, teams, integrations.
- **Admin pricing** (\`/admin/pricing\`) vs staff **Pricebook** (\`/pricebook\`) — pricebook for day-to-day proposal pricing; admin pricing for org config.

### Photos — which upload goes where
- **Roof report / inspection documentation PDF photos** → Opportunity → **Roof Report** → Report Builder \`/opportunities/[id]/report\`
- **Proposal PDF inspection photos (max 6)** → Proposal \`/proposals/[id]\` → **Inspection Photos**
- **Job / production / final install photos & job files** → Job Board job \`/ops/jobs/[id]\` → **Photos & files**
- If the user says “photos” / “upload pictures” without context, **ask which of the three** (or infer from page context). Never send roof-report uploads to Job Board by default.

### Typical flow
Canvass pin → Lead → Schedule inspection → Opportunity → Proposal → Contract signed → Project → Ops job → Complete → Collected → Payroll.

### AI assistant rules (Phase 1)
- You help users **find** features and **explain** where data belongs. You do **not** change CRM data yet.
- When answering "where does X go?", give the menu path, the page URL pattern, and the specific field or section name.
- If the user is on a record (lead/opportunity/project/job), reference that record when relevant.
- If unsure, say which page to check rather than guessing.
`.trim()

const NAVIGATION_PROMPT_RULES = `
Navigation answer rules (always follow):
- Never emit empty markdown links or markdown links with blank labels/URLs. Prefer plain backtick paths like \`/ops/jobs/...\`. If you lack a concrete id, keep the \`[id]\` placeholder inside backticks — do not invent a link.
- Only cite App Router paths that appear in the navigation guide above (or the Current record URL appendix). Never invent routes (no separate insurance page, no \`/jobs\` for production).
- If the user asks about photos/uploads without specifying type, disambiguate among (a) Roof Report Builder on the opportunity (\`/opportunities/[id]/report\`), (b) Proposal Inspection Photos max 6 on \`/proposals/[id]\`, (c) Job **Photos & files** on \`/ops/jobs/[id]\`. Do not send roof-report work to Job Board.
`.trim()

const ROLE_HINTS: Record<string, string> = {
  admin: 'This user is an admin — they can access Admin, Payroll, user management, and all ops/financial fields.',
  owner: 'This user is an owner — full access including Admin, Payroll, and job financials.',
  operations:
    'This user is operations — prioritize Ops (\`/ops\`), job files, labor/material costs, work orders, crew/sub assignment, and distinguish roof-report photos (opportunity) from job **Photos & files**.',
  sales_manager: 'This user is a sales manager — emphasize Dashboard, Opportunities, team commissions, and scheduling.',
  regional_manager: 'This user is a regional manager — emphasize territories, team performance, and commissions.',
  sales_rep: 'This user is a sales rep — emphasize Leads, Opportunities, Proposals, and their commission statement.',
  setter_manager: 'This user is a setter manager — emphasize Canvass territories, setter team performance, and inspections.',
  regional_setter_manager: 'This user is a regional setter manager — emphasize territories, setter teams, and 444 program metrics.',
  rep: 'This user is a sales rep — emphasize Leads, Opportunities, Proposals, and commissions.',
  custom: 'This user has a custom role — ask what they are trying to do and map them to the closest CRM workflow.',
  setter: 'This user is a setter — emphasize Canvass (\`/canvass\`), leads, and scheduling inspections.',
  inside_sales:
    'This user is inside sales — emphasize **Inside Sales** (`/inside-sales`), insurance and didn’t-sit/knockback queues, leads, and scheduling.',
  call_center:
    'This user is call center — emphasize **Inside Sales** (`/inside-sales`), insurance queue, lead follow-up, and appointments.',
  canvasser: 'This user is a canvasser — emphasize Canvass (\`/canvass\`), leads, and scheduling inspections.',
  closer:
    'This user is a closer — emphasize Opportunities, Roof Report Builder (`/opportunities/[id]/report`), close feedback (`/appointments/close-feedback`), appointments/calendar, and contracts.',
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

${NAVIGATION_PROMPT_RULES}

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
- Territories: \`/canvass/territories\` or Admin → Canvass Territories (\`/admin/canvass-territories\`)`
  }

  const matchesRoofReport =
    lower.includes('roof report') ||
    lower.includes('report builder') ||
    lower.includes('inspection report') ||
    lower.includes('photo documentation') ||
    (lower.includes('roof') &&
      lower.includes('report') &&
      /\b(photo|photos|pdf|upload|where|how)\b/.test(lower)) ||
    (/\breport\b/.test(lower) &&
      /\b(photo|photos|upload|picture|pictures)\b/.test(lower) &&
      !/\b(proposal|job|production|final|completion)\b/.test(lower))

  if (matchesRoofReport) {
    return paveRecordPath(
      `Roof report photos (customer photo-documentation PDF):
1. Open the opportunity (\`/opportunities/[id]\`)
2. Find the **Roof Report** card
3. Click **Start Roof Report** or **Open Report Builder** → \`/opportunities/[id]/report\`

This is NOT the Job Board **Photos & files** tab. Job production photos go on \`/ops/jobs/[id]\` → **Photos & files**. Proposal PDF photos (max 6) go on \`/proposals/[id]\` → **Inspection Photos**.`,
      context
    )
  }

  const matchesJobProductionPhotos =
    /\b(final photo|completion photo|production photo|job photo|photos & files)\b/.test(lower) ||
    (/\b(photo|photos|picture|pictures)\b/.test(lower) &&
      /\b(job|ops|install|production|final|completion)\b/.test(lower)) ||
    (context?.type === 'job' && /\b(photo|photos|picture|pictures)\b/.test(lower))

  if (matchesJobProductionPhotos) {
    return paveRecordPath(
      `Job / production photos:
1. Open the job (\`/ops/jobs/[id]\`) → **Photos & files** tab
2. Upload final/install photos there (Final Photos / Job Files Workspace)

Roof report photos for the homeowner PDF are NOT here — those are Opportunity → **Roof Report** → \`/opportunities/[id]/report\`.`,
      context
    )
  }

  const matchesProposalInspectionPhotos =
    (lower.includes('proposal') && /\b(photo|photos)\b/.test(lower)) ||
    (/\binspection photos\b/.test(lower) && !lower.includes('roof report'))

  if (matchesProposalInspectionPhotos) {
    return `Proposal inspection photos (up to 6, shown on the proposal PDF):
1. Open the proposal (\`/proposals/[id]\`)
2. Use the **Inspection Photos** section

For the full customer Roof Report PDF, use Opportunity → **Roof Report** → \`/opportunities/[id]/report\` instead.`
  }

  const matchesAmbiguousPhotos =
    /\b(upload photo|upload photos)\b/.test(lower) ||
    (/\b(photo|photos|picture|pictures)\b/.test(lower) &&
      !/\b(final|completion|production|job|ops|install|proposal)\b/.test(lower))

  if (matchesAmbiguousPhotos) {
    return paveRecordPath(
      `In ARX, photos go to different places:

1. **Roof report** (inspection documentation PDF) → Opportunity → **Roof Report** → \`/opportunities/[id]/report\`
2. **Proposal inspection photos** (max 6 on the PDF) → Proposal → **Inspection Photos** → \`/proposals/[id]\`
3. **Job / production / final photos** → Job Board → job → **Photos & files** → \`/ops/jobs/[id]\`

Tell me which kind you mean (or open that record and ask again) and I will give exact clicks.`,
      context
    )
  }

  if (
    lower.includes('inside sales') ||
    lower.includes('call center') ||
    lower.includes('insurance follow') ||
    lower.includes('insurance queue') ||
    lower.includes('didnt sit') ||
    lower.includes("didn't sit") ||
    lower.includes('knockback')
  ) {
    return `Inside Sales / call follow-ups:
- Open **Inside Sales** (\`/inside-sales\`) for didn’t-sit, handoff, knockback, storm, and **insurance** queues
- Closer outcome **Insurance Follow Up** is captured in close feedback; ongoing dials are worked from Inside Sales — there is no separate insurance page`
  }

  if (
    lower.includes('referral') ||
    lower.includes('referrals') ||
    lower.includes('referrer') ||
    lower.includes('referral bonus')
  ) {
    return paveRecordPath(
      `Referrals:
1. On the **lead** (\`/leads/[id]\`) — **Referral Information** card when source is referral (link the referrer)
2. On the **customer** (\`/customers/[id]\`) — **Referrals** tab to manage referred deals and payout status`,
      context
    )
  }

  if (/\b(pricebook|price book)\b/.test(lower)) {
    return `Day-to-day pricing catalog: **Pricebook** (\`/pricebook\`). Proposal builder (\`/proposals/builder\`) pulls from it. Org pricing admin config is under **Admin** (\`/admin/pricing\`) for admins.`
  }

  if (
    /\bcustomers?\b/.test(lower) &&
    !lower.includes('roof report') &&
    !lower.includes('signing')
  ) {
    return `Customers live at **Customers** (\`/customers\`). Open a customer (\`/customers/[id]\`) for profile, jobs history, and the **Referrals** tab.`
  }

  if (
    lower.includes('inspection') ||
    lower.includes('appointment') ||
    (/\bschedule\b/.test(lower) &&
      !/\b(sub|crew|job|install|production)\b/.test(lower) &&
      !/\binsurance\b/.test(lower))
  ) {
    return paveRecordPath(
      `Scheduling inspections:
1. Open the **lead** (\`/leads/[id]\`) and use **Schedule inspection**, or
2. Use **Calendar** (\`/calendar\`) or **Appointments** (\`/appointments\`) to see upcoming visits
3. Closers are assigned automatically via round-robin when scheduling from a lead`,
      context
    )
  }

  if (
    lower.includes('proposal') ||
    lower.includes('estimate') ||
    (lower.includes('price') && !/\b(pricebook|price book)\b/.test(lower))
  ) {
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

  // No generic "where / how do i / find" catch-all. It matched almost any real question
  // and answered with a static directory listing. Unmatched questions return null so the
  // caller can reach the model, which already has this whole guide in its system prompt.
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
        'Where do I link a referral on this lead?',
      ]
    case 'opportunity':
      return [
        'How do I close this opportunity?',
        'Where do I build a proposal for this deal?',
        'What happens after the contract is signed?',
        'Where do I build the Roof Report for this opportunity?',
        'Where do roof report photos go for this deal?',
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
        'Where do production photos go on this job?',
      ]
    default:
      return [
        'Where do I enter labor cost on a job?',
        'How many leads do I have this week?',
        'Where do I find my commissions?',
        'How do I schedule an inspection?',
        'Where do roof report photos go?',
      ]
  }
}
