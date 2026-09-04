# ARX CRM AI Assistant — Completion Brief

**Roles:** Grok is the head (plan, sequence, judgment calls, review). Composer is the hands
(edits, tests, builds). Grok should not let Composer start a task whose spec is ambiguous —
resolve it first.

**Repo:** `/Users/nathanhall/arx-internal-crm` (NOT the `arx-website` repo — different project).

---

## 0. Ground truth — verified, do not re-derive

This was investigated in detail. Trust these; re-deriving wastes time and has already produced
one wrong conclusion (see "branch archaeology" below).

**Branch state**
- Working branch: `feat/crm-ai-assistant-hardening`
- Worktree: `/Users/nathanhall/arx-internal-crm/.worktrees/ai-hardening`
- Based on `origin/main` @ `e76a9f0`. Nothing has been pushed.
- First commit on it is a clean cherry-pick of `fb9ebfe` ("Ship Phase 1 read-only AI navigation
  assistant") off the never-merged branch `feat/ai-assistant-phase1-clean`.
- The replay was **conflict-free** despite 84 intervening commits on main — only 2 of those
  touched this file surface and both were roof-measure (`app/api/ai/detect-roof/`), which this
  work does not touch.
- Verified baseline after the replay: `tsc --noEmit` clean, **604 tests / 76 suites passing**,
  `npm run build` exit 0.

**Branch archaeology — important**
There is a local-only branch `wip/crm-ai-assistant-rethink` (commit `28233b9`) whose message
carries a scary "DO NOT SHIP AS-IS" list (F2 permissions bypass, `getUser()` instead of
`requireAuthApi()`, missing `ai_conversations`, no rate cap).

**That branch is superseded. Do not build on it.** It was cut from `main` on Jul 20 and was
re-solving problems that Phase 1 had already solved properly on Jul 11 — it just never knew
Phase 1 existed. Phase 1 already has: `requireAuthApi()`, per-user RBAC gating of record
context, narrowed column selects, PII exclusion, opportunity financial redaction, input
validation, and three test files. The rethink branch has none of that depth.

Its one genuinely unique idea is the `<crm_record_data>` untrusted-data fence (see Task 1).
Use `git show 28233b9 -- <path>` as *reference only*. Never cherry-pick it.

Also note the rethink's framing was backwards: it described F2 as "must fix before this goes
near main," but the vulnerable code was already on main and deployed. Blast radius was small
(only 2 users had AI enabled), and RLS on `leads` is org-level (`org_id = get_user_org_id(...)`),
so the DB was never the control — app-layer permissions are, which is exactly what Phase 1 wired in.

**Production database (Supabase project `anzqkklwcgaoeunzpqjh`, "arx-internal-crm")**
- `ai_conversations` **has been created in prod already** — migration
  `supabase/migrations/202607250001_ai_conversations.sql`, applied and verified: table exists,
  RLS enabled, 4 policies (SELECT/INSERT/UPDATE/DELETE), all scoped to
  `user_id = auth.uid() AND org_id = get_user_org_id(auth.uid())`. **Do not re-apply or alter it
  without a reason.**
- `ai_action_audit` does **not** exist (not needed yet — assistant is read-only).
- `user_settings` has `ai_enabled`, `ai_suggestions_enabled`, `ai_auto_notes` (all NOT NULL bool).
- Org table is `orgs` (not `organizations`). Helper fns: `get_user_org_id(uuid)`,
  `is_admin_or_manager(uuid)`.
- Apply any future migration **via the Supabase MCP `apply_migration`**, not `db push`.

**Nav guide accuracy** — all 30 routes cited in `lib/ai/crm-navigation-guide.ts` resolve
correctly. `/canvass` and `/canvass/territories` live under the `app/(canvass-app)/` route
group, which does not affect the URL — they are valid. The only page that shipped after the
guide was written and is missing from it is `/admin/sisu/setter-ramp`.

**Audience decision:** the assistant ships to **all authenticated CRM users, every role** —
reps, setters, canvassers, inside sales, closers, ops, managers, admins. An earlier
admin/manager-only gate was reversed on purpose: this tool's strength is navigation help, which
is most valuable to new reps/setters and to the ops/job-board team, and least valuable to admins
who already know the CRM. Broad access is safe *because* record context is RBAC-gated per user.

---

## 1. First thing: establish actual state

A background agent was mid-flight on Tasks 1–5 below when this brief was written. Some may be
partly or fully done. **Before touching anything:**

```bash
cd /Users/nathanhall/arx-internal-crm/.worktrees/ai-hardening
git log --oneline origin/main..HEAD
git status
git diff origin/main --stat
npx tsc --noEmit && npm test && npm run build
```

Reconcile what is already done against the task list. Do not redo completed work, and do not
assume anything is done without reading the diff.

---

## 2. Must-do work

### Task 1 — Prompt-injection fencing (highest value)
`getAiChatRecordContextAppendix()` in `lib/ai/chat-record-context.ts` interpolates raw DB strings
(`homeowner_name`, `address_text`, `job_number`, `status`, `source`) directly into the system
prompt. Those are attacker-influenceable — a homeowner name typed into the CRM could read
"ignore previous instructions."

- Fence the record block in `<crm_record_data>` … `</crm_record_data>` with a lead-in instructing
  the model to treat the contents as untrusted data, never instructions, and not to claim access
  to absent fields.
- Keep Phase 1's readable bullet formatting *inside* the fence.
- Neutralize any literal `</crm_record_data>` or `<crm_record_data>` appearing in interpolated
  values, so a crafted field can't close the fence early.
- **Do not regress**: PII exclusion (no phone/email/notes), the `canAccessAiChatRecordContext`
  RBAC gate, or the opportunity financial redaction.
- Extend `lib/__tests__/chat-record-context.test.ts` — cover the fence and the escape case. Add
  tests; don't weaken existing ones.

### Task 2 — Access: all authenticated users
If any admin/manager-only restriction exists in `app/api/ai/chat/route.ts` (POST **and** GET) or
`components/AIAssistantWrapper.tsx`, remove it. Keep `requireAuthApi()`, keep the `ai_enabled`
check, and **keep the per-user RBAC gating of record context** — that is what makes broad access
safe. A setter must still be unable to pull restricted fields via chat context. Clean up any
imports left unused.

### Task 3 — Bound transcript growth
The route stores the full message array in `ai_conversations.messages` forever while sending only
the last `AI_CHAT_MAX_OPENAI_MESSAGES` to the model. Cap persisted messages at the most recent 50
via a named constant in `lib/ai/chat-constants.ts`, with a test.

### Task 4 — Honest AI settings
- `components/jobs/AINextActionBanner.tsx` should respect `ai_suggestions_enabled` instead of
  always rendering.
- In `app/settings/page.tsx`, the `ai_auto_notes` toggle is decorative — nothing consumes it.
  Remove it and make surrounding copy honest (read-only navigation/guidance; no data mutation, no
  auto note-writing). Keep `ai_enabled` and `ai_suggestions_enabled`.
- Reuse `hooks/useAISettings.ts` rather than refetching ad hoc.

### Task 5 — Guide gap
Add `/admin/sisu/setter-ramp` to `COMMON_GUIDE` in `lib/ai/crm-navigation-guide.ts`, matching
existing bullet style.

---

## 3. Bug found — fix the root cause, not just the symptom

**Symptom:** `lib/ai/chat-record-context.ts` selects `contract_value` from `projects`. **That
column does not exist.** PostgREST returns an error, the error is discarded, `data` is null, and
the function returns `''`. Net effect: **the assistant gets zero record context on every project
page, silently.** Confirmed against prod — `contract_value` appears nowhere in the repo except
this one line, so it was never right.

**Root cause:** all four branches (`lead`, `opportunity`, `project`, `job`) destructure only
`{ data }` and ignore `error`. Any column drift silently degrades the assistant to no-context with
no signal. Fix the pattern, not just the one column:

1. Capture and `console.error` the error in each branch (do **not** surface DB errors to the client).
2. Fix the `projects` select. Real columns available: `address_text`, `status`, `project_type`,
   `install_date`, `permits_status`, `product_summary`, `payment_method`, `roof_squares`,
   `sold_roof_squares`, `total_windows`, `opportunity_id`, `scope_of_work`, `notes`, `ops_notes`.
   There is **no** contract-value column on `projects`; monetary value lives on the linked
   opportunity via `opportunity_id` → `opportunities.estimated_value`.
   Suggested replacement context: address, status, project type, install date, permits status,
   sold roof squares. If you surface a dollar value by joining the opportunity, it **must** go
   through the same `shouldRedactOpportunityFinancials` redaction already applied to the
   opportunity branch. Do **not** add `notes`/`ops_notes`/`scope_of_work` — free-text PII is
   deliberately excluded.
3. Add a regression test asserting the project branch returns non-empty context for a project row.

**Verified clean:** `leads`, `opportunities`, and `production_jobs` selects all match prod columns.
Job-board context is correct — leave it alone.

---

## 4. Feature work — ranked, after the above is green

**F1. Guide-freshness test (do this one; small, high leverage).**
Add a test that extracts every `/route` path cited in `lib/ai/crm-navigation-guide.ts` and asserts
a matching page exists in the App Router. Must resolve route groups — `app/(canvass-app)/canvass`
serves `/canvass`. This is what catches guide rot automatically instead of by hand, and it would
have caught the setter-ramp gap. Keep it maintainable: a clear failure message naming the dead path.

**F2. Read-only aggregate answers (biggest perceived-quality win).**
Today the assistant can only see the one record you're standing on, so "how many leads came in
this week," "which jobs are behind," "what's in my pipeline" all bottom out in "go check
`/reports`." That's the main way it feels dumb.
Implement as a **small fixed set of parameterized, permission-scoped queries** — never free-form
SQL, never string-interpolated user input. Each must run through the caller's
`resolveEffectivePermissionNames` and org scope, exactly like record context does. Start with 3–4:
my leads this week, my open opportunities, jobs by status, my commission MTD. Redact financials
for barred roles. Gate behind a flag so it can ship dark.

**F3. Conversation history UI.**
`ai_conversations` now persists but nothing surfaces it. Add a simple recent-conversations list
in the assistant panel (the `ai_conversations_user_updated_idx` index exists for exactly this
query) plus a delete control — the RLS DELETE policy is already in place so users can clear their
own history.

**F4. Streaming responses.**
Non-streaming `gpt-4o-mini` at 600 max tokens feels sluggish. Stream the completion for perceived
speed. Purely a UX change; keep the same guardrails.

**F5. Feedback capture.**
Thumbs up/down per answer, stored with the conversation. Cheapest way to learn what it's actually
bad at instead of guessing. If added, note it changes what's retained — keep it to a rating, not
free-text that could carry customer data.

**F6. Deep links instead of URL patterns.**
The guide teaches `/ops/jobs/[id]`. When record context is present, emit a real clickable link to
that record. Small change, makes answers feel finished.

**Not recommended yet:** write actions / `ai_action_audit`. The whole design is read-only and its
safety story depends on that. Don't cross it without a deliberate audit-and-confirm design.

---

## 5. Definition of done

- `npx tsc --noEmit` clean.
- `npm test` — **no pre-existing test may break**. Baseline 604 passing / 76 suites; new tests add to it.
- `npm run build` exit 0. (Known harmless noise: a `web-worker`/`geotiff` critical-dependency
  warning, `Dynamic server usage (cookies)` prerender probes on cookie-reading routes, and an
  ESLint plugin-conflict warning. All pre-existing, none block.)
- Run a security-focused review pass over the final diff before proposing a merge.
- Report exact counts, not impressions. If something can't be done cleanly, say so plainly rather
  than papering over it.

## 6. Guardrails

- **Never weaken** `canAccessAiChatRecordContext`, the PII exclusion, or the financial redaction.
  Broad access is only safe because those hold.
- Don't push to `origin` or open a PR without Nathan's explicit go-ahead. `main` deploys to
  production via Vercel.
- `.env.local` holds live credentials (Supabase service-role, Google OAuth, OpenAI). Never read
  values into context, never commit or echo them.
- Leave the main checkout's uncommitted files alone (`supabase/.temp/cli-latest`, the `.docx`
  files, `scripts/`, `output/`) — unrelated to this work.
- Migrations go through Supabase MCP `apply_migration`, not `db push`.
- Staying on OpenAI `gpt-4o-mini` for now — a provider migration is explicitly out of scope for
  this pass.
- This repo has an iCloud quirk: duplicate ref files like `.git/refs/heads/main 2` can break
  `git fetch`. Delete the space-numbered duplicates and retry if that happens.
