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
2. "Enter as owner" or "Enter as a specific user" (`POST /api/support/enter`) checks staff row, live grant / always-on and the target user, writes the `enter` log row (no log = no entry) and sets the cookie `arx_support`: signed (key derived from the service key), httpOnly, host-only, at most 8 hours and never past the grant. When the current address may not serve that company (company fence), the answer is a one-minute hand-off link to the company's own address (`/api/support/handoff`), which sets the cookie there.
3. `resolveAuth` (`lib/auth.ts`) is the only place the cookie becomes a profile. EVERY request re-checks staff row, staff account active, live grant (or always-on) and the acting-as user (same company, active). Ending a grant therefore kicks support out on the next request. The company fence (`DEPLOYMENT_ORG_ID`, host) applies to the ACTING profile's company: a company's copy or address admits support into that company only. Anything short of fully valid = no support powers (the ordinary path runs).
4. View mode (default): middleware answers every write (POST/PUT/PATCH/DELETE, API or server action) with 403 "Support view mode" before any route runs; `requireAuthApi` refuses too (backstop, fails closed if the method header is missing). Only exit and upgrade stay open. "Switch to full" in the banner (`POST /api/support/upgrade`) logs `upgrade` first, then reissues the cookie as full. Full mode logs every write (`write`, method + route) before it runs; a write that cannot be logged is refused. Staff can never change the company's own Support access settings.
5. Outbound blocks (`lib/support/send-guard.ts`, decided on the signed cookie of the REQUEST, so crons and webhooks are untouched), each logged `blocked_send`: customer emails (the mail door `lib/demo-org-mail.ts` refuses), texts, customer messages (`loadSendContext`), payment links, Stripe writes, supplier orders, calendar invitations (`calendarSendUpdates` answers `none`), push, QuickBooks outbox enqueue. Same single doors the demo company uses; a support session refuses instead of faking "sent".
6. Banner: `components/support/SupportBanner.tsx` in the root layout (every page): "Support access — viewing {Company} as {User} (view only | full)", Switch to full, Exit (logs `exit`, clears the cookie).
7. The company sees its own log (who, when, as whom, what) in Settings → Support access. The log is append-only: the app role can only read and add rows, and an update trigger refuses changes.

## Other auth paths (checked)
- `requireAuth` / `requireAuthApi` / `getAuthContext`: support-aware (above).
- Hand-rolled-cookie routes (Known Redundancy 3b, ~40 files) and raw `auth.getUser` paths/pages: never read the support cookie (test-enforced). They authenticate the real Supabase token only, so a support session can never act as another company there. Consequence: with the support cookie on, these still show the staff member's OWN company data (or sign-in on a customer's address, where staff have no Supabase cookie), so a few screens look empty or wrong in a support session, and their writes (full mode) are not in the support log (they act as the staff member in the staff member's own company). Fix by moving them onto `requireAuthApi` (3b).
- Customer portal, crew / signing / pay links, AI connector tokens, iPhone Bearer tokens, cron secret, webhooks: unrelated lanes; none consult the cookie.
- Browser-client pages that rely on RLS alone: a support session has no Supabase token, so they load nothing.

## Known gaps / follow-ups
- Hand-off links are not single-use (60 seconds, signed, bound to one company and re-checked in the database).
- `requireAuthApi` called twice in one request writes two `write` rows.
- A GET route with side effects is not stopped by view mode.
- In full mode, as owner, staff can do anything an owner can (including users and passwords): logged, not blocked. Decide whether to block those routes.
- The banner sits above the sticky Nav (it can cover it by its own height while scrolling).
- Needs a shared database between the operator's copy and a customer's copy (hand-off runs against one DB). Per-copy databases would need staff rows in each.
- Pre-launch: legal terms for support access (customer consent wording).
