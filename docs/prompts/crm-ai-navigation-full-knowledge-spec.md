# CRM AI Navigation — Full Knowledge Spec (LOCKED)

**Status:** LOCKED for Composer implementation  
**Branch target:** `main` (repo `/Users/nathanhall/arx-internal-crm`)  
**Author role:** Brain (Grok) — read-only inventory + this spec only  
**Implementer:** Composer (`composer-2.5-fast`) — apply exactly this file  

---

## 0. Already diagnosed (do not re-derive incorrectly)

1. **Roof report photos** live at **Opportunity → Roof Report → Report Builder**  
   `/opportunities/[id]/report` — **NOT** Job Board **Photos & files**.
2. **Job production / final photos** = `/ops/jobs/[id]` → **Photos & files** tab (also Final Photos card / Job Files Workspace).
3. **Proposal inspection photos** = proposal page `/proposals/[id]` — **Inspection Photos** section, **up to 6**, appear on proposal PDF.
4. **OpenAI path ignores `getNavigationFallbackResponse` today** — when `OPENAI_API_KEY` is set, desire-path answers get invented. Spec: prefer deterministic fallback **BEFORE** calling OpenAI in `app/api/ai/chat/route.ts`.
5. **`paveRecordPath` bug (on HEAD):**  
   `text.replace(/\/\[id\]/g, url)` where `url` is the full record path (e.g. `/ops/jobs/<uuid>`) doubles the path → `/ops/jobs/ops/jobs/<uuid>`.  
   **Must replace `/[id]` with `/${context.id}` only.**  
   Note: working tree already has this fix as an **uncommitted** edit to `lib/ai/crm-navigation-guide.ts` — keep it; do not revert.
6. Model invents empty markdown links `` — prompt must **forbid empty markdown links**; cite paths in **backticks only**.
7. **FAB cookie-auth fix already shipped** (`c1f3039`). Do not redo.
8. **Allowlist still Nathan-only** — leave `lib/ai/chat-allowlist.ts` and call sites alone unless a guide sentence would be wrong without mentioning rollout limits (it should not mention the allowlist).

---

## 1. Goal / non-goals

### Goal
Make the CRM AI navigation assistant accurately know **where things are and how they work** across the full CRM App Router surface that staff actually use — guide text, deterministic fallbacks, system-prompt rules, suggestion chips, and route freshness tests — so users get correct “where does X go?” answers (especially photo destinations and ops vs sales surfaces).

### Non-goals
- No write actions / no CRM mutations from the assistant (Phase 1 read-only safety story stays).
- No provider migration (stay on OpenAI when key present; fallback path when not / when matched).
- No allowlist removal or broaden.
- No FAB / cookie-auth rework.
- No Instant Estimate / public website changes.
- No inventing CRM features that do not exist under `app/`.
- Do not commit or push.
- Leave unrelated untracked files alone (docx, output/, scripts/build-*-review*, migration drafts, `docs/prompts/crm-ai-assistant-completion.md`, `.worktrees/`, etc.).

---

## 2. Exact files to edit

| File | Change |
|---|---|
| `lib/ai/crm-navigation-guide.ts` | Rewrite/expand `COMMON_GUIDE`; keep/ensure `paveRecordPath` fix; add/update fallback matchers + copy; tighten `buildAiChatSystemPrompt` rules; update `generateContextualSuggestions` |
| `app/api/ai/chat/route.ts` | Prefer `getNavigationFallbackResponse` **before** OpenAI fetch when it returns non-null |
| `lib/__tests__/crm-navigation-guide.test.ts` | Add/update cases listed in §9 |

**Do not edit** (unless a compile error forces a tiny import tweak — avoid):  
`lib/ai/chat-allowlist.ts`, `lib/ai/chat-record-url.ts` (unless needed only if path helpers break — they should not), FAB/wrapper components, unrelated AI hardening worktree files under `.worktrees/`.

---

## 3. Route inventory (verified App Router — cite only these)

Canonical staff URLs that exist as `page.tsx` under `app/` (route groups like `(canvass-app)` do not appear in the URL):

### Core sales / pipeline
- `/dashboard`, `/leads`, `/leads/new`, `/leads/[id]`
- `/opportunities`, `/opportunities/[id]`
- `/opportunities/[id]/report` — Roof Report Builder
- `/opportunities/[id]/measure`, `/opportunities/[id]/measure/print`
- `/proposals`, `/proposals/builder`, `/proposals/[id]`
- `/projects`, `/projects/[id]`
- `/customers`, `/customers/[id]` (tabs include **Referrals**)
- `/pricebook`
- `/calendar`, `/appointments`, `/appointments/feedback`, `/appointments/close-feedback`
- `/schedule` — appointment reschedule helper (query `?reschedule=`)
- `/inside-sales` — call-center / insurance / knockback / didn’t-sit queues
- `/estimates/new`, `/estimates/[id]` — legacy estimate pages (exist; prefer **Proposals** in guidance)

### Ops / production
- `/ops` Job Board, `/ops/dashboard`, `/ops/calendar`
- `/ops/jobs/[id]` — tabs: **Overview**, **Materials**, **Financials** (permissioned), **Photos & files**, **Notes**
- `/ops/jobs/[id]/orders` — material / product orders list
- `/ops/jobs/[id]/material-order/print` — materials order sheet print
- `/ops/jobs/[id]/measure`, `/ops/jobs/[id]/measure/print`
- `/work-orders`, `/work-orders/new`, `/work-orders/[id]`
- `/subs`, `/subs/jobs`, `/subs/jobs/[id]`, `/subs/work-orders`
- `/sub-portal/[token]` — token portal (external; do not push as primary staff nav)

### Canvass / incentives
- `/canvass`, `/canvass/territories`, `/canvass/stats`, `/canvass/settings`
- `/sisu` (nav label **Incentives**)
- `/admin/sisu`, `/admin/sisu/444`, `/admin/sisu/setter-ramp`, `/admin/sisu/bonus-approval`, `/admin/sisu/accountability`, `/admin/sisu/incentives`
- `/admin/canvass-territories`

### Commissions / payroll / admin (high-traffic)
- `/commissions/statement`, `/commissions/statement/[periodId]`, `/commissions/team`, `/commissions/estimator`
- `/admin/payroll`, `/admin/payroll/periods`, `/admin/payroll/statements`, `/admin/payroll/weekly`, `/admin/payroll/[periodId]/hours`
- `/admin`, `/admin/users`, `/admin/teams`, `/admin/pricing`, `/admin/integrations`, …
- `/reports`, `/reports/builder`, `/reports/coaching`
- `/settings`, `/notifications`
- `/tools/roof-measure`, `/tools/roof-measure/measurements`

### Redirect traps (do not recommend as destinations)
- `/jobs` → redirects to `/projects`
- `/jobs/[id]` → redirects to `/projects/[id]`  
  Production job file is **`/ops/jobs/[id]`**, not `/jobs/...`.

### Token / public-ish (mention only if user asks “customer signing link”)
- `/contracts/[token]`, `/contracts/sign/[token]`, `/contracts/[token]/rep`
- `/change-orders/sign/[token]`, `/comp-agreements/sign/[token]`, `/r/[token]`, etc.  
Do **not** put these in everyday nav chips.

---

## 4. COMMON_GUIDE — sections to add/rewrite

Replace/expand the current `COMMON_GUIDE` string in `lib/ai/crm-navigation-guide.ts` so it remains one template string, Phase-1 read-only rules kept at the bottom. Composer may paste the bullet content below (keep backtick paths; freshness test extracts `` \`/path\` `` from source).

### Rewrite: Sales pipeline
Keep existing lead/opportunity/proposal/project bullets; **add/clarify**:

- **Roof Report (inspection photo PDF for homeowner):** Opportunity detail → **Roof Report** card → **Start Roof Report** / **Open Report Builder** → \`/opportunities/[id]/report\`. This is where field roof-report photos live. **Not** Job Board Photos & files.
- **Opportunity measure:** \`/opportunities/[id]/measure\` (print: \`/opportunities/[id]/measure/print\`).
- **Proposal inspection photos (PDF, max 6):** open proposal \`/proposals/[id]\` → **Inspection Photos** section. Distinct from Roof Report Builder and from job production photos.
- **Customers:** **Customers** (\`/customers\`) → customer detail \`/customers/[id]\`.
- **Referrals:** On a lead with source referral → **Referral Information** card on \`/leads/[id]\`. Managing referrer payouts / linked deals → customer \`/customers/[id]?tab=referrals\` (**Referrals** tab).
- **Pricebook:** **Pricebook** (\`/pricebook\`) — catalog used by proposal builder.
- **Inside Sales:** **Inside Sales** (\`/inside-sales\`) — queues for didn’t-sit, handoff, knockback, storm, and **insurance** follow-up calling (Philippine / call-center workflow).
- **Insurance follow-up (closer outcome):** After close feedback marks **Insurance Follow Up**, scheduling uses insurance follow-up appointment type; ongoing call work surfaces on **Inside Sales** (\`/inside-sales\`) insurance queue — do not invent a separate `/insurance` page.
- **Close feedback:** \`/appointments/close-feedback\` (post-appointment closer outcome form).
- Do **not** send users to \`/jobs\` for production — that redirects to Projects.

### Rewrite: Operations
Keep labor / material order / cost line / crew / work order accuracy. **Add/clarify**:

- **Photo types on a job:** \`/ops/jobs/[id]\` → **Photos & files** — production / final install photos, Job Files Workspace, cost lines. **Not** for the customer Roof Report built during inspection.
- **Materials Order List (computed takeoff):** Materials tab → **Materials Order List** card; print \`/ops/jobs/[id]/material-order/print\`. This is the supplier sheet from measurements — separate from **+ Add Material Order** cost rows (\`/ops/jobs/[id]/orders\`).
- **Job materials brief / Sold add-ons:** visible on the ops job (brief card) for sold proposal adders (gutters, decking, etc.) — display/visibility; ordering adders may still be manual ops practice. Do not claim adders auto-flow into supplier order PO unless asked and then say brief shows them; cost orders are still Materials tab / orders list.
- **Notes tab** on job: \`/ops/jobs/[id]\` → **Notes**.
- **Ops measure:** \`/ops/jobs/[id]/measure\`.

### Rewrite / expand: Commissions & payroll
- Keep statement / team / \`/admin/payroll\`.
- Add **Commission estimator:** \`/commissions/estimator\`.
- Admin payroll subpages exist (\`/admin/payroll/periods\`, \`statements\`, \`weekly\`) — mention hub \`/admin/payroll\` first; only deep-link if user asks.

### Rewrite: Canvassing
- Keep \`/canvass\`, territories.
- Territories: \`/canvass/territories\` **or** Admin → Canvass Territories \`/admin/canvass-territories\`.
- Canvass stats/settings: \`/canvass/stats\`, \`/canvass/settings\` (optional mention).
- Sisu / Incentives: \`/sisu\`; admin 444 hub \`/admin/sisu/444\`; setter ramp \`/admin/sisu/setter-ramp\` (already present — keep).

### Expand: Tools & admin
- Keep roof measure, reports, settings AI toggle, admin hub.
- Add **Coaching reports:** \`/reports/coaching\`.
- Add **Notifications:** \`/notifications\`.
- Add **Inside Sales** cross-link for call-center roles.
- Admin pricing \`/admin/pricing\` vs staff pricebook \`/pricebook\` — pricebook for day-to-day proposal pricing; admin pricing for org config.

### New section: Photos — which upload goes where (REQUIRED)
Paste as its own `### Photos — which upload goes where` section:

- **Roof report / inspection documentation PDF photos** → Opportunity → **Roof Report** → Report Builder \`/opportunities/[id]/report\`
- **Proposal PDF inspection photos (max 6)** → Proposal \`/proposals/[id]\` → **Inspection Photos**
- **Job / production / final install photos & job files** → Job Board job \`/ops/jobs/[id]\` → **Photos & files**
- If the user just says “photos” / “upload pictures”, **ask which of the three** (or infer from page context: opportunity → roof report; proposal → inspection photos; job → Photos & files). Never send roof-report uploads to Job Board by default.

### Keep: Typical flow + AI assistant rules (Phase 1)
Keep the canvass → … → payroll flow. Keep Phase 1 read-only bullets; strengthen with system-prompt rules in §6 (those live in `buildAiChatSystemPrompt`, not only COMMON_GUIDE).

### ROLE_HINTS tweaks (small)
- `inside_sales` / `call_center`: mention **Inside Sales** \`/inside-sales\` and insurance queue explicitly.
- `closer`: mention Roof Report Builder + close feedback + opportunities.
- `operations`: already good; add photo-type disambiguation one short clause.

---

## 5. `getNavigationFallbackResponse` — new/updated matchers + exact copy

Order matters: put **photo disambiguation** and **roof report** **before** generic “where/how/find” catch-all. Keep existing labor/material/crew/status/pipeline/cost-line/commission/canvass/inspection/proposal/contract matchers unless a conflict requires tightening (photo matcher must not steal “material” or “labor”).

### 5.1 NEW — Roof report / report builder
**Matchers (message lowercased):**  
`roof report`, `report builder`, `inspection report`, `photo documentation`,  
or (`roof` && `report` && (`photo`|`pdf`|`upload`|`where`|`how`)).

**Exact response copy:**

```
Roof report photos (customer photo-documentation PDF):
1. Open the opportunity (`/opportunities/[id]`)
2. Find the **Roof Report** card
3. Click **Start Roof Report** or **Open Report Builder** → `/opportunities/[id]/report`

This is NOT the Job Board **Photos & files** tab. Job production photos go on `/ops/jobs/[id]` → **Photos & files**. Proposal PDF photos (max 6) go on `/proposals/[id]` → **Inspection Photos**.
```

Use `paveRecordPath` when `context.type === 'opportunity'`.

### 5.2 NEW — Photo type disambiguation
**Matchers:**  
(`photo`|`photos`|`picture`|`pictures`|`upload photo`|`upload pictures`)  
AND NOT already handled by roof-report matcher  
AND NOT clearly “final photo” / “completion photo” alone (those can go to job photos — see 5.3).

If message is ambiguous (just “where do photos go” / “upload photos”):

**Exact response copy:**

```
In ARX, photos go to different places:

1. **Roof report** (inspection documentation PDF) → Opportunity → **Roof Report** → `/opportunities/[id]/report`
2. **Proposal inspection photos** (max 6 on the PDF) → Proposal → **Inspection Photos** → `/proposals/[id]`
3. **Job / production / final photos** → Job Board → job → **Photos & files** → `/ops/jobs/[id]`

Tell me which kind you mean (or open that record and ask again) and I will give exact clicks.
```

Pave opportunity id into (1) when `context.type === 'opportunity'`; pave job id into (3) when `context.type === 'job'`. When paving, still keep the other two lines with `[id]` placeholders OR pave only the matching line — simplest approach: call `paveRecordPath` on the whole string (only replaces `/[id]` when context id validates for that context type via `getAiChatRecordUrl` — **today pave only runs when context type has a record URL**, so on job context opportunity paths stay as `/opportunities/[id]` which is correct).

### 5.3 NEW — Job / production photos
**Matchers:**  
(`final photo`|`completion photo`|`production photo`|`job photo`|`photos & files`)  
or (`photo`|`photos`) && (`job`|`ops`|`install`|`production`|`final`|`completion`)  
or `context?.type === 'job'` && (`photo`|`photos`|`picture`).

**Exact response copy:**

```
Job / production photos:
1. Open the job (`/ops/jobs/[id]`) → **Photos & files** tab
2. Upload final/install photos there (Final Photos / Job Files Workspace)

Roof report photos for the homeowner PDF are NOT here — those are Opportunity → **Roof Report** → `/opportunities/[id]/report`.
```

### 5.4 NEW — Proposal inspection photos
**Matchers:**  
(`proposal` && (`photo`|`photos`)) or `inspection photos` (without “roof report”).

**Exact response copy:**

```
Proposal inspection photos (up to 6, shown on the proposal PDF):
1. Open the proposal (`/proposals/[id]`)
2. Use the **Inspection Photos** section

For the full customer Roof Report PDF, use Opportunity → **Roof Report** → `/opportunities/[id]/report` instead.
```

(Do not pave `/proposals/[id]` unless proposal context exists — today context types are only lead/opportunity/project/job/general; leave proposal path as `[id]`.)

### 5.5 NEW — Inside sales / insurance follow-up queue
**Matchers:**  
`inside sales`, `call center`, `insurance follow`, `insurance queue`, `didnt sit`, `didn't sit`, `knockback` (as follow-up queue).

**Exact response copy:**

```
Inside Sales / call follow-ups:
- Open **Inside Sales** (`/inside-sales`) for didn’t-sit, handoff, knockback, storm, and **insurance** queues
- Closer outcome **Insurance Follow Up** is captured in close feedback; ongoing dials are worked from Inside Sales — there is no separate `/insurance` page
```

### 5.6 NEW — Referrals
**Matchers:** `referral`, `referrals`, `referrer`, `referral bonus`.

**Exact response copy:**

```
Referrals:
1. On the **lead** (`/leads/[id]`) — **Referral Information** card when source is referral (link the referrer)
2. On the **customer** (`/customers/[id]?tab=referrals`) — **Referrals** tab to manage referred deals and payout status
```

### 5.7 NEW — Customers / pricebook (lightweight)
**Matchers:** `customer` / `customers` (and not “customer roof report”); `pricebook` / `price book`.

Customers copy:

```
Customers live at **Customers** (`/customers`). Open a customer (`/customers/[id]`) for profile, jobs history, and the **Referrals** tab.
```

Pricebook copy:

```
Day-to-day pricing catalog: **Pricebook** (`/pricebook`). Proposal builder (`/proposals/builder`) pulls from it. Org pricing admin config is under **Admin** (`/admin/pricing`) for admins.
```

### 5.8 KEEP — existing matchers
Retain labor/job cost, material order, crew/sub, job status next steps, pipeline counts, cost lines, commissions/payroll, canvass, inspection scheduling, proposal/estimate/price (tighten “price” so bare “pricebook” hits 5.7 first — put pricebook matcher **above** the broad proposal/estimate/price block), contract/close, and generic where/how/find.

**Tighten proposal matcher:** change  
`lower.includes('proposal') || lower.includes('estimate') || lower.includes('price')`  
to exclude pure pricebook (`pricebook` / `price book`) already handled; keep `price` for proposal pricing questions.

### 5.9 Optional tighten — “schedule”
Existing inspection vs crew split stays. Do not route “schedule insurance follow up” exclusively to lead inspection if message includes `insurance` — prefer 5.5 or mention both close-feedback scheduling and Inside Sales.

---

## 6. System prompt rule additions (`buildAiChatSystemPrompt`)

Append to the returned prompt string (after COMMON_GUIDE / appendices / existing aggregate rules), always on:

1. **Empty links forbidden:** Never emit empty markdown links or markdown links with blank labels/URLs. Prefer plain backtick paths like \`/ops/jobs/...\`. If you lack a concrete id, keep the \`[id]\` placeholder inside backticks — do not invent a link.
2. **Cite only guide paths:** Only cite App Router paths that appear in the navigation guide (or the Current record URL appendix). Never invent routes (no `/insurance`, no `/jobs` for production, no `/photos`).
3. **Photo-type disambiguation:** If the user asks about photos/uploads and does not specify, disambiguate among (a) Roof Report Builder on the opportunity, (b) Proposal Inspection Photos (max 6), (c) Job Photos & files — per the guide. Prefer the matching fallback knowledge; do not send roof-report work to Job Board.
4. Keep existing: no PII repeat; Phase 1 no mutations; aggregate citation rules unchanged.

---

## 7. Chat route — prefer fallback before OpenAI

**File:** `app/api/ai/chat/route.ts`  
**Location:** after `systemPrompt` / messages are prepared, **before** `if (openaiKey) { ... fetch OpenAI ... }`.

### Required behavior
```
const fallback = getNavigationFallbackResponse(trimmedMessage, profile.role, context)
if (fallback) {
  // persist + return JSON { response, conversationId } — same shape as today's no-key path
  // do NOT call OpenAI
}
// else existing OpenAI stream path, else legacy fallback
```

### Acceptance criteria
- When `OPENAI_API_KEY` is set **and** message matches a navigation fallback (e.g. “where do roof report photos go”), response is the **deterministic fallback text**, OpenAI is **not** called.
- When message does **not** match, OpenAI stream path unchanged.
- When no OpenAI key, behavior remains fallback → `generateLegacyFallbackResponse`.
- Persistence still runs for fallback hits (assistant message saved).
- No change to allowlist / `ai_enabled` / RBAC record context.

### Implementation note
Reuse the existing JSON response + `persistAiConversation` block already used when `!openaiKey`. Extract a small local helper if needed to avoid duplication — keep the change minimal.

---

## 8. `paveRecordPath` fix

**Ensure** (HEAD is buggy; WT may already be fixed):

```ts
function paveRecordPath(text: string, context?: AiChatFallbackContext): string {
  if (!context?.id || !getAiChatRecordUrl(context.type, context.id)) {
    return text
  }
  // Replace only the placeholder segment — never splice in the full record URL
  return text.replace(/\/\[id\]/g, `/${context.id}`).replace(/\[id\]/g, context.id)
}
```

**Acceptance:** for job id `550e8400-e29b-41d4-a716-446655440000`, labor-cost fallback contains `/ops/jobs/550e8400-e29b-41d4-a716-446655440000` and **never** `/ops/jobs/ops/jobs/...`. Same for opportunity roof-report paving.

`lib/ai/chat-record-url.ts` stays as-is (`job` → `/ops/jobs/`, etc.).

---

## 9. Suggestion chip updates (`generateContextualSuggestions`)

| Context | Chips (replace array contents) |
|---|---|
| `lead` | Keep schedule / next / become opportunity; **add** one of: `Where do I link a referral on this lead?` |
| `opportunity` | Keep close / proposal / after contract; **add** `Where do I build the Roof Report for this opportunity?` and/or `Where do roof report photos go for this deal?` |
| `project` | Keep ops-job chips (unchanged intent) |
| `job` | Keep labor / material order / crew / status / cost lines; **add** `Where do production photos go on this job?` |
| `default` | Keep labor / leads count / commissions / schedule; **add** `Where do roof report photos go?` |

GET `/api/ai/chat` already returns these — no route change beyond fallback-before-OpenAI on POST.

---

## 10. Tests to add/update

**File:** `lib/__tests__/crm-navigation-guide.test.ts`

Keep existing tests green. Add:

1. **`paveRecordPath` does not double prefix** — labor cost with job context → contains `/ops/jobs/${jobId}`, not `/ops/jobs/ops/jobs/`.
2. **Roof report fallback** — message `where do roof report photos go` → contains `/opportunities/[id]/report`, contains `Roof Report`, does **not** instruct Job Board as the primary destination for roof report (may mention Job Board only as contrast).
3. **Ambiguous photos fallback** — `where do I upload photos` → mentions all three destinations (report, proposal inspection, Photos & files).
4. **Job-context photos** — context job + `where do photos go on this job` → `/ops/jobs/${id}` and Photos & files; mentions roof report is elsewhere.
5. **Inside sales fallback** — `where is inside sales` → `/inside-sales`.
6. **Referrals fallback** — `where do referrals go` → `/customers/` and lead referral card path.
7. **Guide freshness** — existing `cites only App Router routes that exist on disk` must still pass after new backtick paths are added (`/opportunities/[id]/report`, `/inside-sales`, `/customers`, `/customers/[id]`, `/pricebook`, `/admin/canvass-territories`, `/commissions/estimator`, `/reports/coaching`, `/notifications`, `/ops/jobs/[id]/material-order/print` if cited, etc.).
8. **System prompt rules** — `buildAiChatSystemPrompt` output contains ban on empty markdown links and photo disambiguation / cite-only-guide-paths language.
9. **Opportunity suggestions** — `generateContextualSuggestions('opportunity', id)` includes a chip mentioning Roof Report (case-insensitive).
10. **Pricebook vs proposal** — `where is the pricebook` hits pricebook path `/pricebook` (not only proposal builder).

### Optional route-level test (only if cheap)
If there is already a chat route test harness, add “fallback short-circuits OpenAI”; **do not** create heavy OpenAI mocks unless a pattern already exists. Prefer unit-testing `getNavigationFallbackResponse` + a focused test of a tiny extracted `shouldPreferNavigationFallback` if Composer extracts one. **Minimum bar:** guide unit tests above + manual code review that POST checks fallback before `fetch('https://api.openai.com...')`.

---

## 11. Do-not-touch list

- `lib/ai/chat-allowlist.ts` and allowlist call sites  
- FAB / `components/AIAssistantWrapper.tsx` cookie-auth (shipped `c1f3039`)  
- Provider migration / model changes  
- Write-action / tool-calling / CRM mutations  
- `.worktrees/**`  
- Unrelated untracked docs/docx/scripts/migrations/output  
- `supabase/` schema  
- Instant Estimate / public website  
- Broad admin catalog pages that are not staff “where is X” destinations (email blasts, door-drop, print-kit, etc.) — **do not** dump entire admin IA into COMMON_GUIDE; hub `/admin` is enough unless user asks  

---

## 12. Acceptance checklist

- [ ] `npx jest lib/__tests__/crm-navigation-guide.test.ts` passes  
- [ ] Guide freshness test still green — **no dead routes** in backtick paths  
- [ ] `paveRecordPath` never doubles `/ops/jobs/` or `/opportunities/`  
- [ ] OpenAI path: matched navigation fallback returned **without** calling OpenAI  
- [ ] Roof report vs job photos vs proposal photos documented in guide + fallbacks + prompt rules  
- [ ] Inside Sales, Customers/Referrals, Pricebook represented accurately  
- [ ] Phase 1 read-only story intact  
- [ ] Allowlist untouched  
- [ ] No commit/push by Composer unless Nathan explicitly asks  

---

## 13. Working-tree conflict note (for Composer)

As of spec lock:

- Branch: `main`, up to date with `origin/main`
- **Uncommitted** change already present: `lib/ai/crm-navigation-guide.ts` — **only** the `paveRecordPath` fix (3 insertions / 2 deletions vs HEAD)
- Composer must **keep** that fix and layer the rest of this spec on top
- Do not discard WT changes with a hard reset
- Unrelated dirty/untracked files must remain untouched

---

## 14. Ready-for-Composer

**YES** — this spec is locked. Implement exactly §§2–12; verify §12; stop. Do not expand scope into AI hardening Tasks from `crm-ai-assistant-completion.md` unless a separate brief says so.
