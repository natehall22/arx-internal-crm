# Background jobs with many companies in one database (2026-11-10)

ONE app + ONE shared database serves every company. Every Vercel cron, GitHub Actions worker and webhook below was
checked for: which companies it runs for, whether every read/write stays in the company being processed, whose
settings/time zone/recipients it uses, and whether a retry or a second copy can double-send.

**Which companies a job runs for has one answer: `loadCronOrgs` / `loadCronOrgIds` (`lib/cron-orgs.ts`).**
A company runs only if it has at least one ACTIVE user, and, when env `DEPLOYMENT_ORG_ID` is set (a fenced copy),
only that company. Leftover test orgs (0 active users) are therefore never processed. New cron → use it.

| Job | Trigger | Runs for | Notes |
|---|---|---|---|
| morning-update (+ checkups, scheduled reports, setter field update) | cron `30 9-13 * * 1-6` UTC | `loadCronOrgs` loop | 5:30am in each company's `orgs.timezone`; once-a-day claim keyed to that company's date (resend-today uses the same date). Recipients are the company's own active users. |
| promote-insurance-follow-ups | hourly | `loadCronOrgs` loop | One pass per company (the 8,000-row cap is per company, not shared); every query is by that company's ids / `org_id`. |
| storm-opportunity-alerts | daily | deals of `loadCronOrgIds` companies | Writes carry the deal's own `org_id`; dedupe by unique alert row. Storm footprint is still ONE global box (env `WEATHER_FOOTPRINT_*`, Charlotte) — a company elsewhere gets no storm hits until footprints are per company. |
| sync-setter-ramp | hourly | companies with active enrollments ∩ `loadCronOrgIds` | |
| founder-contacts-digest | nightly | contacts of `loadCronOrgIds` companies | Grouped per person AND company; sent only to a person still active in that company. |
| referral-partners | nightly | SQL `referral_partners_run_expiry`, all rows | Each notification carries the partner's own `org_id` and goes to its assigned rep; idempotent (`FOR UPDATE`, `expiry_warned_at`). |
| instant-estimate-accuracy | nightly | the one website-estimate company (`PUBLIC_ESTIMATE_ORG_ID`) | Explicit env only (no built-in company id); must equal `DEPLOYMENT_ORG_ID` on a fenced copy. |
| cleanup-inspection-photos / cleanup-report-photos | nightly | all companies | Same retention for everyone (30 days result photos; report photos 30 days after PDF / 90 without). |
| weather-refresh, weather-swaths-ingest (Actions), lidar-ingest (Actions) | daily / hourly | global | Shared public data; rows have `org_id` NULL. Never company-owned. |
| `POST /api/webhooks/leads` | website / lead tools | the lead source token's company | Owner and email = the source's auto-assign user, else `web_leads_owner_id`, else the company's longest-standing active admin — each only if an active user of that company (`resolveCompanyRecipient`, `lib/company-recipient.ts`). |
| `POST /api/webhooks/abc-supply` | ABC | the company whose send carries the confirmation number | Zero or ambiguous matches are ignored. |
| `/api/public/estimate/*` | website estimate | `PUBLIC_ESTIMATE_ORG_ID` | One company per deployment today. |

## How a second company's website posts leads
1. In that company's CRM: Settings → Campaigns & lead sources → add a lead source (e.g. "Website form"), webhook on;
   optionally pick who it auto-assigns to (must be one of that company's active users).
2. Copy that source's webhook URL: `https://<app>/api/webhooks/leads?token=<source token>`.
3. The website form POSTs JSON (`name` or `first_name`/`last_name`, `phone`, `email`, `address`…) to that URL, from
   the browser or its server. The token alone decides the company — a body `org_id` is ignored. Any `https://` site
   may call it from the browser (no cookies are used).
The shared `WEBHOOK_SECRET` key only works on a fenced copy and only for that copy's company; don't hand it out.

## Internal alert recipients
No email goes to a hardcoded address (guarded by `lib/__tests__/no-hardcoded-recipients.test.ts`). Person-level
alerts (web lead, canvass "inspection booked with no closer", adjuster-meeting calendar failure) go to
`resolveCompanyRecipient` (`lib/company-recipient.ts`): a configured active user of the record's company, else its
longest-standing active admin, else nobody. In-app feedback goes to `resolveCompanyInboxEmail` (`orgs.email`, else that
admin) and requires sign-in. Exception: trial-signup (a CRM prospect with no company yet) goes to the product owner.
The retired env `ADJUSTER_MEETING_ALERT_EMAIL_TO` is no longer read.
