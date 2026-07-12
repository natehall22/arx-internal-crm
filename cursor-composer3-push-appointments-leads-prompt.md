# Composer 3 — Build: Push Notifications, Appointment Card, Lead List (ARX Sales iOS)

You are the implementation agent for the **ARX Sales** native SwiftUI iOS app in the `arx-internal-crm` monorepo, branch `ios/canvass-modernization`. This prompt was written against the actual codebase — items marked **VERIFIED** are checked facts; items marked **VERIFY** you must confirm in-code before wiring. Build the phases **in order**; each must be green (clean build + review) before the next.

Three features, decided scope (do not expand it):
1. **Appointment visibility** — a read-only "next appointment" card. NOT a Calendar tab (explicitly rejected).
2. **Lead list** — a "My Leads" list view alongside the canvass map.
3. **Push notifications** — APNs, from zero (no push infra exists today).

Explicitly out of scope, do not build: team messaging, route planning, a Calendar tab, any modification to scheduling/round-robin/calendar-sync/payroll-attribution logic.

## Where things live
- iOS app: `ARX Sales/ARX Sales/*.swift`, project `ARX Sales/ARX Sales.xcodeproj`. Pre-launch — no legacy builds in the field; refactor Swift freely.
- Backend: same repo, Next.js 14 App Router, live and shared with the web CRM — **additive/non-breaking only**. New mobile behavior goes in new `/api/mobile/*` routes; never fork logic inside shared routes.
- Read before coding: `APIClient.swift` (all models + request/post helpers + the `// MARK: - Sisu` section for call conventions), `DashboardView.swift`, `SisuView.swift`, `ContentView.swift`, `FloatingTabBar.swift` (AppTab/TabBarConfig), `AppSettings.swift`, `ARX_SalesApp.swift` (auth-state listener that configures the offline queue — push token lifecycle hooks in here too).

## Non-negotiable repo rules (violating any fails review)
1. New API routes: `requireAuthApi()` from `lib/auth.ts` — it **THROWS**; wrap in try/catch → 401. Never raw `supabase.auth.getUser()`. Copy the shape of `app/api/mobile/territories/route.ts` or `app/api/sisu/incentives/route.ts`.
2. Schema: **additive/nullable only**; SQL files under `supabase/migrations/`; **never run `supabase db push`** — Nathan applies migrations via Supabase MCP `apply_migration`. List pending migrations prominently in your handoff notes.
3. Crons: if you add one, copy the existing pattern — `vercel.json` entry + `Authorization: Bearer ${CRON_SECRET}` (503 if unset, 401 on mismatch).
4. Contrast: explicit dark text `#2c2c2a` (`AppSettings.darkText`) on light surfaces; never generic gray for values; text on imagery gets an opaque scrim. WCAG AA.
5. Tests: backend changes get jest coverage following `lib/__tests__/sisu-mobile-auth.test.ts` / `lib/__tests__/mobile-capabilities.test.ts` mocking style (mock `@/lib/auth`, `@supabase/supabase-js`, `next/server`). Run `npx tsc --noEmit` (clean) and `npm test` (all green; baseline 57 suites / 353 tests — compare structurally, the count moves).
6. iOS: keep the existing architecture — SwiftUI views + lightweight `ObservableObject` VMs + `APIClient` static funcs with colocated snake_case-CodingKeys models. Zero new warnings (project is warning-clean; `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` is set — mark cross-actor data payloads `nonisolated` like `SaveLeadRequest` already is).
7. Build check: `xcodebuild -project "ARX Sales/ARX Sales.xcodeproj" -scheme "ARX Sales" -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' clean build`.
8. Every phase: proactive bug-review + collateral-impact sweep before calling it done.

---

# Phase 1 — Next-appointment card (zero backend work — VERIFIED)

**VERIFIED:** `GET /api/appointments?filter=upcoming` is already iOS-callable: its auth helper (`getAccessTokenFromApiRequest` in `lib/supabase-api-request-auth.ts`) prefers the `Authorization: Bearer` header. For non-manager reps it already scopes to `closer_user_id.eq.<me> OR canvasser_user_id.eq.<me>`, and the response enriches each appointment with `closer`/`setter` user objects. **VERIFY** the exact response JSON shape (field names, date format, address/lead fields) by reading `app/api/appointments/route.ts` lines ~60–170 before writing the Swift model — do not guess it from this summary.

**Build:**
- `APIClient.upcomingAppointments()` + a `MobileAppointment` model (only the fields the card needs: scheduled time, address, homeowner/lead name, appointment type, closer/setter names).
- A `NextAppointmentCard` on **Dashboard** and **Sisu** (both home-screen variants — a rep only ever sees one): shows the single next upcoming appointment (soonest `scheduled_for` in the future) — time ("Today 2:30 PM" / "Tomorrow 9:00 AM" / weekday+time), address, homeowner name — with two actions: Directions (address-based, reuse the `openDirections(to:)` pattern from `OpportunitiesView.swift`, honoring the `NavigationAppSetting`) and Call if a phone number is present in the response (**VERIFY**).
- Tapping the card body expands to the next 3–5 upcoming appointments inline (disclosure), still read-only. No editing, no cancelling, no rescheduling from iOS — that machinery is off-limits.
- Empty state: hide the card entirely when there are no upcoming appointments (don't show an empty shell).
- Load it additively like Sisu's incentives fetch: failure hides the card, never blanks the screen.

**Done when:** card renders on both home screens with real data; zero backend diffs; build clean.

# Phase 2 — "My Leads" list (one small new backend route)

**VERIFIED:** `/api/leads` (web) is cookie-auth only (local `getSessionFromRequest` — no Bearer path) → iOS cannot call it, and you must NOT modify it. Create **`GET /api/mobile/leads`** instead:
- `requireAuthApi()` pattern. Service-role client. Org-scoped.
- Returns the caller's own leads: `getAttributedCanvassLeadUserId(lead) === profile.id` OR `owner_user_id === profile.id` (**VERIFY** — read `lib/canvass-lead-attribution.ts` and mirror how `pin_attributed_user_id` precedence is applied elsewhere; attribution rules are payroll-adjacent, so consume the existing helper, never reimplement it).
- Fields: `id, lat, lng, address_text, homeowner_name, phone, canvass_disposition, canvass_notes, status, created_at, updated_at`. Order `updated_at desc`. Cap at ~500 rows with a `hasMore` flag — no pagination UI in v1.
- Jest: 401 unauthenticated + response-shape test.

**iOS build:**
- `LeadListView.swift` — presented from a list button in the Canvass bottom-left control group (next to layers/time-scrubber; look at how `showLayersSheet` is wired in `CanvassView.swift` and match it), as a sheet with `.large` detent.
- Rows: homeowner/address, disposition chip (reuse `CanvassDisposition.find` colors), relative time ("2d ago"). Searchable (name/address/phone). Filter chips by disposition group: All / Hot & Go-backs / Scheduled / Other (**VERIFY** disposition ids against `CanvassDisposition.all` in `APIClient.swift`).
- Tap a row → dismiss the sheet and fly the map to that pin (`CanvassMapCoordinator.shared.flyToCoordinate`) and open its `LeadSheetView` — reuse the existing `onPinTap` flow rather than inventing a parallel one (**VERIFY** how `selectedPin`/`showLeadSheet` are set in `CanvassView.swift` and route through the same state).
- Swipe actions: Call (if phone), Directions — same patterns as `OpportunitiesView.swift`.

**Done when:** list shows the rep's leads, search/filter work, row-tap lands on the map pin with the sheet open; only backend diff is the new mobile route + tests.

# Phase 3 — Push notifications (the big one: APNs from zero)

**VERIFIED:** no push infrastructure exists anywhere (no device-token table, no APNs code, no web-push). There IS an existing in-app `notifications` table the backend already inserts into at several well-defined sites — `app/api/appointments/[id]/route.ts` (reassignment), `app/api/setter/inspection-results/route.ts`, `app/api/sisu/sync/route.ts`, `app/api/subs/work-orders/[id]/complete/route.ts` (**VERIFY** each insert's payload shape before hooking it).

### 3a. Migration (write the SQL; do NOT apply it — flag for Nathan)
`supabase/migrations/<next>_mobile_device_tokens.sql`:
```sql
CREATE TABLE IF NOT EXISTS mobile_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  device_token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  environment text NOT NULL DEFAULT 'production',  -- 'sandbox' | 'production'
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_token)
);
ALTER TABLE mobile_device_tokens ENABLE ROW LEVEL SECURITY;
```
(**VERIFY** the org_id FK convention and RLS-policy shape against a recent migration like `110_canvass_territories.sql` and copy it.)

### 3b. Token registration route
`POST /api/mobile/push-token` (register/refresh: upsert on `(user_id, device_token)`, update `last_seen_at`) and `DELETE` (sign-out: remove that token). `requireAuthApi()`. Jest for 401 + upsert-idempotency.

### 3c. APNs sender
`lib/push-apns.ts` — token-based APNs auth (JWT signed with the `.p8` key over HTTP/2 to `api.push.apple.com` / `api.sandbox.push.apple.com`). Env vars: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (p8 contents), `APNS_BUNDLE_ID` (**VERIFIED bundle id: `com.arx.ARX-Sales`**), `APNS_ENVIRONMENT`. Prefer a minimal maintained lib (e.g. `apns2`) over hand-rolling HTTP/2 — but **VERIFY it actually works on Vercel's Node runtime** (serverless HTTP/2 client support is the risk; if it doesn't work, fall back to `fetch` against APNs' HTTP/3-capable endpoint is NOT an option — document what you find and pick the workable path; worst case, route sends through a single cron using the one runtime that works rather than inline sends). Handle per-token errors: on `410 Unregistered` / `BadDeviceToken`, delete that row. Never let a push failure break the calling request — fire-and-forget with logged errors.

### 3d. Send triggers (v1 — exactly two, resist adding more)
1. **Appointment assigned/reassigned to you**: hook where `app/api/appointments/[id]/route.ts` already inserts the in-app notification (**VERIFY** the reassignment code path; and check whether initial round-robin assignment in the canvass scheduling flow also inserts a notification — if it does, hook that same helper, but do NOT modify any scheduling logic itself, only append a push send after the existing insert).
2. **SPIFF qualified**: **VERIFY** where SPIFF qualification is detected (`app/api/sisu/sync/route.ts` inserts notifications — read it). If qualification only materializes during that sync, send from there.

Factor the hook as one shared `sendPushToUser(userId, title, body, payload)` in `lib/push-apns.ts` so future triggers are one-liners. v1 sends are best-effort: no retry queue, no read receipts, no notification-preferences UI (all future work — say so in handoff notes).

### 3e. iOS side
- `PushManager.swift`: request `UNUserNotificationCenter` authorization **after sign-in, not at cold launch** (an unexplained permission prompt before login is a guaranteed decline); on grant → `registerForRemoteNotifications`; on token callback → POST to `/api/mobile/push-token`; on sign-out (hook the existing `signedOut` branch in `ARX_SalesApp.swift`'s auth listener, where the offline queue is already reconfigured) → DELETE the token then clear local state.
- SwiftUI lifecycle needs a `UIApplicationDelegateAdaptor` for the APNs token callbacks — add a minimal `AppDelegate` in `ARX_SalesApp.swift`.
- Tapping a notification: appointment pushes select the home tab (the card is there); SPIFF pushes select the Sisu tab if visible. Deep-linking into specific records is future work — don't build routing infrastructure for v1.
- Entitlements: add Push Notifications capability + `aps-environment` entitlement to the Xcode project. This plus the APNs key are **human steps** (below) — code them as far as possible, then stop and list what Nathan must do.

### Human steps for Nathan (put this list at the END of your handoff notes, verbatim-actionable)
1. Apple Developer portal: create an APNs Auth Key (.p8), note Key ID + Team ID.
2. Vercel env: set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID=com.arx.ARX-Sales`, `APNS_ENVIRONMENT`.
3. Xcode: confirm the Push Notifications capability shows on the target with the ARX team signing; rebuild to device.
4. Apply the migration via Supabase MCP `apply_migration`.
5. Field test: sign in on device → accept permission → have an appointment assigned → confirm push arrives.

**Done when:** build clean; token registers on sign-in and deletes on sign-out (verifiable in the table once migration applies); both triggers send (testable only after Nathan's human steps — be explicit in notes about what you could not verify without APNs credentials); backend tests green; zero changes to scheduling logic itself.

---

## Definition of done — every phase
1. Clean `xcodebuild` (zero errors, zero new warnings) + `npx tsc --noEmit` + `npm test` all green.
2. Bug-review + collateral-impact sweep (what else touches the same tables/routes — e.g. the web notifications bell reads the `notifications` table you're hooking; don't change its rows' shape).
3. Commit per phase with a clear message. **Do not push.**
4. Handoff notes: files changed, endpoints added, migrations awaiting apply, the human-steps list, and anything deferred.

Start with Phase 1. Read `app/api/appointments/route.ts` in full first.
