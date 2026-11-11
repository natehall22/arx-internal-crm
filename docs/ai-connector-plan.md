# AI connector plan

Goal: let a person use their own AI app (Claude, ChatGPT) with the CRM. The AI acts as that person, sees only what they can see, and every step is logged. A company owner turns it on; it is off for everyone until they do.

## How it works (all phases)
- One MCP address per company: `https://<company>.<app domain>/mcp`.
- Our own sign-in (OAuth 2.1): the person approves the AI app once on a plain consent screen. The AI gets a short-lived key (1 hour) plus a refresh key. Keys are random, stored hashed, and bound to one person, one company and one address. Turning the person off, turning the company switch off, or revoking the app stops it at once.
- The AI never gets a bigger key than the person has. Each tool calls the same permission checks the screens use. Field roles (setters, canvassers, inside sales) never see money or production.
- Text written by customers is handed to the AI marked as untrusted data, not instructions.
- Every tool call is written to an audit log. Rate limits per person and per company.

## Phases
1. **Foundation + read-only (this branch).** Sign-in server, MCP endpoint, one auth function, audit log, rate limits, owner screen (switch, connected people, revoke, audit), "Connected AI apps" for each person, read tools: find customer, customer, find job, job summary, visits/schedule, invoices, notes thread, allowed reports. Tests include company-B-key-on-company-A-ids and field-role checks.
2. **Writes with preview + confirm.** The AI proposes a change (add a note, log a call, reschedule a visit); we show a preview and a one-time confirm key; only then is it saved, through the existing save paths. Never: payroll, payments, deletes, outbound sends, permissions, cancelling jobs.
3. **Uploads + receipts.** The AI can file a photo or PDF (up to 10 MB) on a customer or job through the existing documents code; a receipt becomes a draft cost line the person confirms.
4. **Real-app testing + security review.** Test in a Claude custom connector and ChatGPT developer mode, run an independent security review, then pilot with ARX, then the next company.

Scopes: `crm:read` now; `crm:write` (phase 2) and `crm:upload` (phase 3) are added later and are always capped by the person's role.
