# Payroll statement email — environment variables (staging / production)

Before **Email all statements** or the first production bulk send, confirm these are set on the deployment (Vercel → Project → Settings → Environment Variables, or your host’s equivalent). They are **not** in the repo (secrets stay out of git).

## What “Confirm env” means

Someone with deploy access checks that the running app can:

1. **Send email** (SMTP configured — otherwise the API returns `503 SMTP is not configured`).
2. **Build correct links** in pay statement emails (`View full statement` → your real app URL, not localhost).

No code change is required if these are already set for other CRM emails (contracts, setter notifications, etc.).

---

## Required variables

| Variable | Required for payroll email? | Purpose |
|----------|----------------------------|---------|
| `SMTP_HOST` | **Yes** | Without this, `POST …/send-statements` returns **503**. |
| `SMTP_USER` | Usually | SMTP login (provider-dependent). |
| `SMTP_PASS` | Usually | SMTP password or app password. |
| `SMTP_PORT` | Optional | Default `587` if unset. |
| `SMTP_SECURE` | Optional | Set to `true` for port 465; default treats as `false`. |
| `SMTP_FROM` | Optional | From header; default `ARX Roofing <noreply@arxroofing.com>`. |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Base URL in emails, e.g. `https://your-app.vercel.app` → links to `/commissions/statement/{periodId}`. |

Payroll send uses the same transport as `lib/setter-email.ts` (`getMailTransport()`).

---

## Example (do not commit real values)

```bash
# Staging / production — set in Vercel or host secrets, not in .env committed to git
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="ARX Roofing <noreply@yourdomain.com>"

NEXT_PUBLIC_APP_URL=https://your-staging-or-production-host.com
```

`NEXT_PUBLIC_APP_URL` must match the URL reps use to log in (no trailing slash). Wrong value → email links go to the wrong host.

---

## How to verify (2 minutes)

### 1. SMTP is configured

As a payroll admin, call send (or use the UI):

- **UI:** Admin → Payroll → Consultant statements → locked period → **Email all statements**
- **API:** `POST /api/admin/payroll/periods/{periodId}/send-statements` with admin session

| Result | Meaning |
|--------|---------|
| `503` + `"SMTP is not configured"` | Set `SMTP_HOST` (and usually `SMTP_USER` / `SMTP_PASS`). |
| `200` with `sent` / `failed` arrays | SMTP path is wired; check `failed` for “No email on file”. |
| `409` | Period not locked/paid — env is fine; lock the period first. |

### 2. App URL is correct

After a test send to yourself, open the email and click **View full statement**. It should open:

`{NEXT_PUBLIC_APP_URL}/commissions/statement/{periodId}`

and require login. If the link points at `localhost` or an old hostname, fix `NEXT_PUBLIC_APP_URL` on that environment and redeploy.

### 3. Optional — other email already works

If contract signing or setter emails already send from this environment, SMTP is almost certainly fine; still confirm `NEXT_PUBLIC_APP_URL` for the payroll link host.

---

## Also required for payroll (not email-specific)

These are normal app requirements, not part of “SMTP_*”:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (API routes use service client for payroll tables)

Migration **137** (`payroll_statement_deliveries`) must be applied on the same Supabase project.

---

## Staging checklist order

1. Apply migration **137**
2. **Confirm env** (this doc)
3. P0-A: lock → statement vs export
4. P0-B: dashboard vs statement
5. Email smoke + optional resend

See `docs/payroll-statement-9-10-spec.md` and the WS7 staging script in your PR notes.
