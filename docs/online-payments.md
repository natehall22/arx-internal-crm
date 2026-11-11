# Online payments (Stripe Connect)

Feature switch `onlinePayments` (Settings → feature switches, **default OFF**; ARX unchanged until an owner turns it on).
Migration `202611120020_online_payments.sql` (NOT applied; after `202611100040` → `202611110060`; DB test
`supabase/tests/run-online-payments.sh`). Code: `lib/stripe/api.ts` (the one Stripe door) and `lib/online-payments/*`.

## Decisions

- **Each company connects its own Stripe account; the money is theirs.** Direct charges on the connected account
  (`Stripe-Account` header), so the company is the merchant of record and pays Stripe's fees itself; the platform pays
  nothing. https://docs.stripe.com/connect/direct-charges
- **Account type = Standard behaviour, created with v1 controller properties** (`fees.payer=account`,
  `losses.payments=stripe`, `requirement_collection=stripe`, `stripe_dashboard.type=full`) — Stripe's mapping for Standard
  in https://docs.stripe.com/connect/migrate-to-controller-properties. Accounts v2 is only on a `.preview` API version
  today (https://docs.stripe.com/connect/saas/tasks/create), so it is not used for money.
- **Onboarding = Account Links, not OAuth.** Stripe: "OAuth isn't recommended for new Connect platforms. We recommend
  using Connect Onboarding for Standard accounts" (https://docs.stripe.com/connect/oauth-standard-accounts,
  https://docs.stripe.com/connect/standard-accounts). So there is **no `STRIPE_CONNECT_CLIENT_ID`**. A company that
  already has Stripe signs in with its existing login during onboarding; Stripe makes a separate account for the CRM
  (old payment history stays in the old account). Account links are never emailed (Stripe's rule) — the owner is
  redirected; an expired link comes back to `/api/admin/online-payments/onboarding`, which makes a fresh one.
- **Stripe-hosted Checkout for every card entry** (pay an invoice; save a card = Checkout `mode=setup`, i.e. a
  SetupIntent). Card data never touches the CRM → PCI SAQ-A. We keep Stripe ids + brand / last 4 / expiry only.
- **No surcharge**, ever. Optional platform fee: env `STRIPE_APPLICATION_FEE_BPS` (default 0 = no
  `application_fee_amount` sent; capped at 10%). It is the platform's choice, so it is not a company setting.
- **Pinned API version `2024-06-20`** (`STRIPE_API_VERSION`) so response and webhook shapes don't move. Create the
  webhook endpoint with the same version.
- No SDK: Stripe's API is form-encoded HTTP and we make ~10 kinds of calls (`lib/stripe/api.ts`). `STRIPE_API_BASE`
  points it at stripe-mock if wanted; jest uses fixtures over a mocked `fetch`.

## Money flows (one writer each — nothing new writes money)

| Stripe says | We do |
|---|---|
| Checkout paid / PaymentIntent succeeded | `recordSucceededIntent` (lib/online-payments/record.ts). Job invoice (deposit / final / standard) → `recordJobPayment` (**lib/job-payment-record.ts**, the one job payment writer, now also used by "Add payment": job_payments row + QuickBooks outbox `payment.recorded` + office email) then `applyPaymentToInvoice`. Invoice without a job → `recordCustomerInvoicePayment` (SQL, invoice locked). Key `stripe:<payment intent>`; amount re-read from Stripe (`amount_received`). Paid in full = the usual rule (`lib/job-collection.ts` / invoice balance). |
| Bank (ACH) submitted | row `processing`; nothing recorded until it clears (`checkout.session.async_payment_succeeded`). A clearing payment is subtracted from what the pay page will take. |
| Payment failed | autopay → retry on the company's days + customer email with a pay link + office email; bank bounce → same emails; a declined card inside Checkout is left alone (the customer retries on the page). |
| Refund (`charge.refunded`, `charge.refund.updated`) | every SUCCEEDED refund = one NEGATIVE payment keyed `stripe-refund:<refund id>` + a negative invoice application (balance re-opens). Never a delete. |
| Money that can't go on its invoice (void meanwhile, already paid) | kept (job: counts on the job), row `needs_review`, office emailed. |
| `account.updated` / `account.application.deauthorized` | account status refreshed / marked disconnected. |
| `charge.dispute.created` | office emailed (respond in Stripe). |

Every handler is idempotent (processor-id keys + a recording lease on `online_payments`), and the webhook also records
each event id once (`stripe_webhook_events`). The pay page records too on return (`?session_id=`), as Stripe recommends
(https://docs.stripe.com/checkout/fulfillment) — whichever comes first wins, the other writes nothing.

**Company resolution:** only `event.account` → `payment_accounts.account_id`. An object is accepted only when its
metadata `crm_org_id` equals that company (so neither the event body nor another company's account can pay this
company's invoice). The company's other Stripe sales (no CRM metadata) are skipped before any Stripe read.

## Money review fixes (2026-11-12)

- Webhook events are only marked done once their payment is recorded (409 while another path holds the recording
  lease, 500 on any error — Stripe retries). Recording is idempotent by PaymentIntent.
- Autopay can never charge twice: an unanswered attempt keeps its number, amount and idempotency key; before re-sending,
  Stripe is searched for its PaymentIntent (`metadata['online_payment_id']`).
- Refunds and lost disputes reverse the invoice only by what that payment applied (an overpayment refund changes nothing
  on a paid invoice); disputes: `charge.dispute.closed` lost → negative payment + `payment.disputed`, won → office told.
- `record_job_payment` (payment + outbox, one transaction) and `apply_job_invoice_payment` (invoice locked) in SQL.
- Rate limits on the pay page (per address + per link in SQL) and on staff link creation; cross-site writes refused;
  onboarding refresh changes nothing; payments in another currency are flagged, never recorded.

## Customer side

- `/pay/<token>` (public, no Nav, company brand only, on the company's own address — a token opened on another company's
  address is "not active"). One big **Pay** button → Stripe's page (card, Apple Pay / Google Pay, bank) = 2 taps.
  "Pay a different amount" only when the company allows part payments (min $1). "Save my card for automatic payments"
  on invoices without a job when autopay is on (consent words stored with the card).
- Save-card link (14 days) from the customer's Invoices card: the office never types a card.
- Tokens: 256-bit random, only the SHA-256 stored (`payment_links`).

## Office side

- Settings → **Online payments** (owners): Connect Stripe / Finish setup / Disconnect (the Stripe account and its money
  stay the company's), part payments, bank payments, automatic payments + retry days ([3, 7] by default).
- Invoice modal → **Copy pay link** / **Email pay link** (any invoice, incl. deposits; a draft job invoice is issued first),
  and every online attempt in plain words ("Paid by Visa •••• 4242", "Bank payment processing", "Automatic payment didn't
  go through").
- Customer → Invoices → card on file: email / copy a save-card link, stop automatic payments, remove the card.
- "Email" on a service invoice: with online payments on, a card on file is charged first (the email then says Paid);
  otherwise the email carries the pay link.
- Who: owners (`isSuperAdmin`) connect and set; billing staff (`callerCanAccessJobBilling`) make links and manage cards.

## Deposits

A deposit is a deposit invoice (`createDepositInvoiceV2`) → its pay link. Deposits on a quote BEFORE signing are not
built: there is no job/invoice to hold the money yet (would need a quote-level invoice — decide with quote approval).

## Setup (what a person does in Stripe)

1. **Pick the platform Stripe account** (the CRM's, not a roofing company's operating account — a company connects to
   the platform like any other). Turn on Connect; Settings → Connect → platform profile: SaaS platform, connected
   accounts **pay their own fees**, **direct charges**, full Stripe Dashboard; branding (name, icon, color — onboarding
   requires it).
2. **Test mode first:** Developers → API keys → test secret key → env `STRIPE_SECRET_KEY` (`sk_test_…`).
3. **Webhook:** Developers → Webhooks → add endpoint `https://<app address>/api/webhooks/stripe`, **"Events on
   Connected accounts"**, API version **2024-06-20**, events: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`,
   `charge.dispute.created`, `charge.dispute.closed`, `account.updated`, `account.application.deauthorized` (same list:
   `STRIPE_WEBHOOK_EVENTS` in lib/online-payments/webhook.ts). Signing secret → env `STRIPE_WEBHOOK_SECRET`.
4. Apply migration `202611120020` (after 0040 → 0060). Deploy.
5. In the CRM: feature switches → Online payments ON → Settings → Online payments → **Connect Stripe**, finish Stripe's
   form. In the company's own Stripe dashboard turn on **ACH Direct Debit** (or switch "Bank payments" off).
6. Test: card `4242 4242 4242 4242`; a decline `4000 0000 0000 9995`; refund from the Stripe dashboard; check the invoice.
7. Live: live secret key + a second (live) webhook endpoint with its own secret; reconnect in live mode (test and live
   accounts are separate — the CRM refuses a test account with a live key and vice versa).

## Not built / later

- Platform fee per company (env only today), Stripe Billing subscriptions (autopay charges our own invoices instead —
  one invoice system), Terminal / tap to pay, quote deposits before signing, QuickBooks for payments on invoices without
  a job (same as cash today: the outbox is per job), an autopay mandate for bank accounts (card only).
- `ymdInZone` exists twice (`lib/payroll-week-schedule.ts`, `lib/service-plans.ts`) — used the payroll one; fold.
