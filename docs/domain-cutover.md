# Moving the CRM to arxcapitol.com

Old address: `arx-internal-crm.vercel.app`. New: `arxcapitol.com`, later `<company>.arxcapitol.com` per company.
The old address keeps **serving** (no redirect) for the whole overlap.

## What the code does now (branch `feat/app-domain-cutover`)
- Every link (customer, staff email, crew invite, OAuth callback, copied links) comes from ONE helper, `getAppUrl(org?)` in
  `lib/app-url.ts`: the company's own address when one is passed (`org.appUrl` — nothing stores it yet), else
  `NEXT_PUBLIC_APP_URL`. **There is no fallback host.** Missing/malformed = logged error; routes whose whole job is a link
  (contract create/send, change order "send to customer", report email, review link, employee agreement, admin password
  reset) refuse with a 500 *before* writing anything; flows where the link is extra (signing confirmations, sale alert,
  notifications) finish and leave the link out. `/api/health` is unchanged.
- The hardcode ratchet has a `host` group: no `vercel.app` / `arxcapitol.com` literal may be added to app code.
- `/canvass` on any address that is not `NEXT_PUBLIC_APP_URL`'s host (not localhost, not a Vercel preview) shows
  "We've moved": it sends the knock queue (localStorage), job photos (`arx-job-photos`) and report photos
  (`arx-report-pending`) saved on that phone — they belong to the old address and can't be read from the new one — and
  only when the count is zero shows "Tap to continue at arxcapitol.com" (same path). It never redirects by itself.
- Nothing redirects: `/api/*`, `/r`, `/crew`, signing pages, everything keeps working on the old address.
- Logout clears the real session cookie (single and chunked) and redirects relatively, so it stays on whichever host it
  was opened on. Sessions are per host: **everyone signs in once on the new address.**
- iOS reads its server from build setting `CRM_BASE_URL` (Info.plist `CRMBaseURL`), currently the old address.
- Weather worker scripts require `WEATHER_SWATHS_INGEST_URL`; there is no default host.

## Config checklist (outside the repo)
| # | Where | Change | Keep old during overlap? |
|---|---|---|---|
| 1 | GitHub repo variables | `WEATHER_SWATHS_INGEST_URL` = `https://arxcapitol.com/api/cron/weather-swaths-ingest`, `LIDAR_INGEST_URL` = `https://arxcapitol.com/api/cron/lidar-ingest`. **Check both are set before merging** — the weather worker no longer has a default. | n/a |
| 2 | Vercel → Domains | Add `arxcapitol.com` (and `www` → apex). Later `*.arxcapitol.com` (wildcard needs Vercel nameservers). Leave `arx-internal-crm.vercel.app` attached with **no redirect**. | yes |
| 3 | Vercel → Settings → Environment Variables | `NEXT_PUBLIC_APP_URL=https://arxcapitol.com` for Production **and** Preview (no value = links fail loudly there). Redeploy: NEXT_PUBLIC values are baked in at build. Keep "Automatically expose System Environment Variables" ON (the hand-off skips previews via `NEXT_PUBLIC_VERCEL_ENV`). | n/a |
| 4 | Vercel env | `GOOGLE_REDIRECT_URI` = `https://arxcapitol.com/api/auth/google/callback`, or delete it (it is then derived from the app address). | n/a |
| 5 | Google Cloud → OAuth client | Add redirect URI `https://arxcapitol.com/api/auth/google/callback` (keep the old one). OAuth consent screen → Authorized domains: add `arxcapitol.com`; update home/privacy links. Stored refresh tokens keep working. | yes |
| 6 | Supabase → Auth → URL configuration | Site URL `https://arxcapitol.com`. Redirect URLs: add `https://arxcapitol.com/reset-password` and `https://*.arxcapitol.com/reset-password`; keep the old host's entry. Check email templates that use `{{ .SiteURL }}`. | yes |
| 7 | Google Cloud → Maps JS key | HTTP referrers: add `https://arxcapitol.com/*` and `https://*.arxcapitol.com/*`. | yes |
| 8 | Website (arxroofing.com Vercel project) | `NEXT_PUBLIC_CRM_PUBLIC_ESTIMATE_URL` → `https://arxcapitol.com` (instant estimate). | old keeps working |
| 9 | Lead sources (Zapier/Facebook/forms) | Re-point any `…/api/webhooks/leads?token=…` URL to the new host (Admin → Campaigns now shows the new address). | yes |
| 10 | iOS (Xcode) | Build setting `CRM_BASE_URL` → `https://arxcapitol.com`, ship via TestFlight/App Store. Old builds keep calling the old host. | yes |

## Cutover order
1. GitHub variables (#1) — they work on either host.
2. Domain live in Vercel (#2); confirm `https://arxcapitol.com/api/health` answers.
3. Allow-lists (#5, #6, #7) — before any link points at the new host.
4. Set `NEXT_PUBLIC_APP_URL` / `GOOGLE_REDIRECT_URI` (#3, #4) and deploy this branch.
5. Smoke test on the new host: sign in, admin password reset email, Google Calendar connect, assign a crew (invite crew link),
   create + sign a contract, share a report `/r` link, review link, canvass knock offline → online. On the old host: `/canvass`
   shows "We've moved", the link appears only after the queue empties; `/api/*`, `/r`, `/crew` still answer.
6. Website + webhooks (#8, #9), then iOS (#10).
7. Tell reps: open the canvass app once on the old icon, wait for "Everything is sent", tap through, sign in, add the new
   address to the home screen, delete the old icon.

## How long the old address keeps serving
At least **60 days**, and until all of these are true:
- Vercel logs show no `/canvass` page loads on the old host for 14 days (every rep has handed off).
- No iOS build with the old `CRM_BASE_URL` is still in use.
- 30 days past the last crew day of any invite created before step 4 (crew links in old invites point at the old host).
- No external caller still posts to the old host (webhooks, GitHub workflows — check function logs).

## When redirects (308) may start — separate change, not built
- **Page routes first** (`/dashboard`, `/leads`, …): 308 to the same path on the new host. Exclude `/canvass` until the
  first condition above holds.
- **GET customer links** (`/r/…`, `/crew/…`, `/contracts/sign/…`, `/change-orders/sign/…`, `/api/files/signed/…`): may 308
  once the overlap ends — customers' old emails keep working through the redirect. Keep the old domain attached forever
  for this; never let it lapse.
- **`/api/*` last, or never**: a 308 on a POST drops the `Authorization` header in many clients when the host changes
  (Python `requests`, some mobile stacks), and old iOS builds call it directly. Only after every API caller is on the new host.
- Cookies do not follow a redirect to another host: anyone redirected signs in again.

## Per-company addresses (later)
`getAppUrl(org)` already takes the company: when a company's own address is stored, pass it as `org.appUrl` and every
link follows. Host → company routing (which company a request is for) is a separate task. Each new company host also
needs entries #5–#7 (the wildcards above cover them).
