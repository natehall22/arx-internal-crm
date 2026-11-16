# Support access (how the product owner and support staff enter a customer company)

One audited door, modelled on Salesforce "Grant Account Login Access" + "Login As". No passwords are shared. Migration `202611260010_support_access.sql` (apply before the code).

## Rules
- Every company except the operator's own must GRANT access first (Settings → Support access, owners only): 1 day, 1 week, 1 month or 1 year. The owner can end it any time. One live grant per company.
- The operator's own company is always on: `orgs.support_access_always = true`, set only by the server or a direct SQL session (guard trigger, same pattern as `is_demo`). A company user cannot set it.
- Only people in `platform_support_staff` can use `/support`. The table has no policies and no browser access; rows are added by SQL.

## Add a staff member / turn the operator's company on (SQL, operator only)
```sql
insert into public.platform_support_staff (user_id, added_by)
values ('<users.id of the staff member>', '<users.id of whoever adds them>');

update public.orgs set support_access_always = true where id = '<operator company id>';
```
Staff are ordinary users of the operator's company; deactivating the user (or deleting the row) ends their access on the next request.

## How it works
1. Staff sign in to the operator's own company address and open `/support` (a 404 for anyone else; it exists only where the operator's company is served).
2. "Enter as owner" or "Enter as a specific user" (`POST /api/support/enter`) checks staff row, live grant / always-on and the target user, writes the `enter` log row (no log = no entry) and sets the cookie `arx_support`: signed (key derived from the service key), httpOnly, host-only, at most 8 hours and never past the grant. When the current address may not serve that company (host fence; a client header never decides), the answer is a one-minute, single-use hand-off link to the company's own address (`/api/support/handoff`), which sets the cookie there. Its one-time id is written with the `enter` log row (`support_access_log.handoff_id`, unique), so a second use is a 404.
3. `resolveAuth` (`lib/auth.ts`) is the only place the cookie becomes a profile. EVERY request re-checks staff row, staff account active, live grant (or always-on) and the acting-as user (same company, active). Ending a grant therefore kicks support out on the next request. The company fence (`DEPLOYMENT_ORG_ID`, host) applies to the ACTING profile's company: a company's copy or address admits support into that company only. Anything short of fully valid = no support powers (the ordinary path runs).
4. View mode (default): middleware answers every write (POST/PUT/PATCH/DELETE, API or server action) with 403 "Support view mode" before any route runs; `requireAuthApi` refuses too (backstop, fails closed if the method header is missing). Only exit and upgrade stay open. The same rule (`supportRequestRefusal`, lib/support/token.ts) runs in middleware and in `resolveAuth` for every entry point (`requireAuthApi`, `requireAuth` in server actions, `getAuthContext`). "Switch to full" in the banner (`POST /api/support/upgrade`) logs `upgrade` first, then reissues the cookie as full. Full mode logs every write (`write`, method + route) before it runs; a write that cannot be logged is refused. One `write` row per request. Refused in EVERY mode (they would leave a credential that outlives the grant): connecting Google or QuickBooks, approving an AI app (`/api/auth/google*`, `/api/integrations/quickbooks*`, `/api/oauth*`, `/oauth*`, any method incl. GET). Refused even in full mode: the company's own Support access settings, users and passwords (`/api/admin/users`), AI connector keys (`/api/admin/ai-connector`), push devices (`/api/mobile/push-token`).
5. Outbound blocks (`lib/support/send-guard.ts`, decided on the signed cookie of the REQUEST, so crons and webhooks are untouched), each logged `blocked_send`: customer emails (the mail door `lib/demo-org-mail.ts` refuses), texts, customer messages (`loadSendContext`), payment links, Stripe writes, supplier orders, calendar invitations (`calendarSendUpdates` answers `none`), push, QuickBooks outbox enqueue. Same single doors the demo company uses; a support session refuses instead of faking "sent".
6. Banner: `components/support/SupportBanner.tsx` in the root layout (every page): "Support access — viewing {Company} as {User} (view only | full)", Switch to full, Exit (logs `exit`, clears the cookie).
7. The company sees its own log (who, when, as whom, what) in Settings → Support access. The log is append-only: the app role can only read and add rows, and an update trigger refuses changes.

## Other auth paths (checked)
- `requireAuth` / `requireAuthApi` / `getAuthContext`: support-aware (above).
- Hand-rolled-cookie / raw `auth.getUser` routes and pages (Known Redundancy 3b, `SUPPORT_OWN_TOKEN_ROUTES` in lib/support/token.ts): they authenticate the browser's own Supabase token, so they would show or change the STAFF member's own company. Inside a support session (view AND full) middleware refuses them: API 403 "Not available in support access", pages show that message. The list is derived from the files by the test, so a new hand-rolled route that is not on it fails. Moving a route onto `requireAuthApi` takes it off the list (it then works in support).
- Customer portal, crew / signing / pay links, AI connector tokens, cron secret, webhooks: unrelated lanes; none consult the cookie. A request with an `Authorization: Bearer` header (iPhone app) ignores the support cookie in `resolveAuth` (middleware still refuses its writes if a support cookie rides along: the safe side).
- On the current single address (`APP_BASE_DOMAIN` unset) the fence is open: `/support` works and Enter sets the cookie on that address. Staff keep their own Supabase cookie there: the hand-rolled routes/pages are refused (above), but client components and pages that query Supabase directly with the browser client (RLS, e.g. Nav, widgets) and routes using `createRequestScopedClient` (AI chat) still use the staff member's own token.
- Browser-client pages that rely on RLS alone: a support session has no Supabase token, so they load nothing.

## Known gaps / follow-ups
- A GET route with side effects is not stopped by view mode (the credential ones above are). Examples: lazy row creation on board loads.
- In full mode, as owner, staff can do everything else an owner can (logged). Users / passwords / keys are blocked (above); relax that list in `SUPPORT_NO_WRITE_PATHS` if support must add users for a customer.
- The banner sits above the sticky Nav (it can cover it by its own height while scrolling).
- Needs a shared database between the operator's copy and a customer's copy (hand-off runs against one DB). Per-copy databases would need staff rows in each.
- Pre-launch: legal terms for support access (customer consent wording).
