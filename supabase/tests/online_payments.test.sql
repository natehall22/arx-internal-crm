-- DB test for 202611120020_online_payments on top of the invoice migrations. THROWAWAY local Postgres only
-- (run-online-payments.sh). Runs the customer-invoices test first (it builds the schema), then applies 122 + this
-- migration twice and asserts: idempotent payment writer, refund writer (negative rows, never over the net paid, status
-- back down), negative applications allowed / zero refused, the void guard counts the NET paid, the new tables refuse
-- anon/authenticated, one live Stripe account per company.
\set ON_ERROR_STOP 1
\i supabase/tests/customer_invoices.test.sql
\i supabase/migrations/122_job_payments_idempotency.sql
-- The QuickBooks outbox as 055 defines it (only the columns record_job_payment writes + the unique key).
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TABLE integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id), provider text NOT NULL, event_type text NOT NULL,
  entity_table text NOT NULL, entity_id uuid NOT NULL, idempotency_key text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}',
  status outbox_status NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
\i supabase/migrations/202611120020_online_payments.sql
\i supabase/migrations/202611120020_online_payments.sql

DO $t$
DECLARE
  o1 uuid := '00000000-0000-0000-0000-000000000001'; o2 uuid := '00000000-0000-0000-0000-000000000002';
  ca uuid := '10000000-0000-0000-0000-00000000000a';
  u1 uuid := '90000000-0000-0000-0000-000000000001';
  inv uuid; j1 uuid; ji uuid; r jsonb; r2 jsonb; ok boolean; jp uuid;
BEGIN
  INSERT INTO job_invoices (job_id, org_id, customer_id, invoice_kind, status, total_cents) VALUES (null, o1, ca, 'service', 'sent', 10000) RETURNING id INTO inv;

  -- P1 the payment writer with a processor key: once only, second call returns the first payment
  r := record_customer_invoice_payment(o1, inv, 4000, '2026-11-12', 'card', 'Paid online by Visa •••• 4242', null, 'stripe:pi_1');
  ASSERT r->>'status' = 'partially_paid' AND (r->>'duplicate')::boolean = false, 'P1 first ' || r::text;
  r2 := record_customer_invoice_payment(o1, inv, 4000, '2026-11-12', 'card', null, null, 'stripe:pi_1');
  ASSERT r2->>'payment_id' = r->>'payment_id' AND (r2->>'duplicate')::boolean, 'P1 duplicate returns the first';
  ASSERT (SELECT count(*) FROM job_payments WHERE idempotency_key = 'stripe:pi_1') = 1, 'P1 one row';
  ASSERT (SELECT sum(applied_cents) FROM invoice_payments WHERE invoice_id = inv) = 4000, 'P1 applied once';
  -- the same key in ANOTHER company is another payment (keys are per company)
  ok := false; BEGIN PERFORM record_customer_invoice_payment(o2, inv, 1, '2026-11-12', 'card', null, null, 'stripe:pi_1'); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'P1 other company refused';
  -- the unique index backs the key even outside the function
  ok := false; BEGIN INSERT INTO job_payments (job_id, org_id, customer_id, paid_at, amount_cents, payment_type, method, payer, idempotency_key) VALUES (null, o1, ca, '2026-11-12', 1, 'other', 'card', 'other', 'stripe:pi_1'); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'P1 unique index';
  -- old 7-argument calls ("Mark paid") still work
  r := record_customer_invoice_payment(o1, inv, 6000, '2026-11-12', 'check', null, u1);
  ASSERT r->>'status' = 'paid', 'P1 mark paid 7 args';

  -- P2 refund: negative payment + negative application, idempotent, status back down, never over the net paid
  r := record_customer_invoice_refund(o1, inv, 3000, '2026-11-13', 'card', 'Refund (Stripe re_1)', 'stripe-refund:re_1');
  ASSERT r->>'status' = 'partially_paid', 'P2 status ' || r::text;
  ASSERT (SELECT amount_cents FROM job_payments WHERE idempotency_key = 'stripe-refund:re_1') = -3000, 'P2 negative payment';
  ASSERT (SELECT sum(applied_cents) FROM invoice_payments WHERE invoice_id = inv) = 7000, 'P2 net applied';
  r := record_customer_invoice_refund(o1, inv, 3000, '2026-11-13', 'card', null, 'stripe-refund:re_1');
  ASSERT (r->>'duplicate')::boolean AND (SELECT count(*) FROM job_payments WHERE idempotency_key = 'stripe-refund:re_1') = 1, 'P2 duplicate';
  ok := false; BEGIN PERFORM record_customer_invoice_refund(o1, inv, 7001, '2026-11-13', 'card', null, 'stripe-refund:re_big'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P2 over net refused';
  ok := false; BEGIN PERFORM record_customer_invoice_refund(o1, inv, 1, '2026-11-13', 'card', null, null); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P2 key required';
  -- P3 money still on it → can't void; refunded to zero → can
  ok := false; BEGIN UPDATE job_invoices SET status = 'void', void_reason = 'x' WHERE id = inv; EXCEPTION WHEN check_violation THEN ok := true; END; ASSERT ok, 'P3 void refused with money on it';
  PERFORM record_customer_invoice_refund(o1, inv, 7000, '2026-11-13', 'card', null, 'stripe-refund:re_2');
  ASSERT (SELECT status FROM job_invoices WHERE id = inv) = 'sent', 'P3 fully refunded reads open';
  UPDATE job_invoices SET status = 'void', void_reason = 'refunded' WHERE id = inv;
  ASSERT (SELECT status FROM job_invoices WHERE id = inv) = 'void', 'P3 void after full refund';

  -- P4 job invoices: a negative application is allowed, zero is not
  INSERT INTO production_jobs (org_id, job_number, customer_id) VALUES (o1, '26-0900', ca) RETURNING id INTO j1;
  INSERT INTO job_invoices (job_id, created_by, total_cents, status) VALUES (j1, u1, 5000, 'sent') RETURNING id INTO ji;
  INSERT INTO job_payments (job_id, paid_at, amount_cents, payment_type, method, payer, idempotency_key) VALUES (j1, '2026-11-12', -100, 'deposit', 'card', 'homeowner', 'stripe-refund:re_j') RETURNING id INTO jp;
  INSERT INTO invoice_payments (invoice_id, job_payment_id, applied_cents) VALUES (ji, jp, -100);
  ok := false; BEGIN INSERT INTO invoice_payments (invoice_id, job_payment_id, applied_cents) VALUES (ji, jp, 0); EXCEPTION WHEN check_violation OR unique_violation THEN ok := true; END; ASSERT ok, 'P4 zero refused';
  -- job keys stay unique per job
  ok := false; BEGIN INSERT INTO job_payments (job_id, paid_at, amount_cents, payment_type, method, payer, idempotency_key) VALUES (j1, '2026-11-12', -100, 'deposit', 'card', 'homeowner', 'stripe-refund:re_j'); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'P4 job key unique';

  -- P5 one live Stripe account per company; a disconnected one stays for refunds; account ids unique
  INSERT INTO payment_accounts (org_id, account_id, status) VALUES (o1, 'acct_A1', 'disconnected');
  INSERT INTO payment_accounts (org_id, account_id, status) VALUES (o1, 'acct_A2', 'active');
  ok := false; BEGIN INSERT INTO payment_accounts (org_id, account_id, status) VALUES (o1, 'acct_A3', 'onboarding'); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'P5 one live account';
  ok := false; BEGIN INSERT INTO payment_accounts (org_id, account_id, status) VALUES (o2, 'acct_A2', 'active'); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'P5 account id unique';

  -- P6 one autopay charge per invoice per attempt
  INSERT INTO online_payments (org_id, account_id, kind, invoice_id, amount_cents, attempt) VALUES (o1, 'acct_A2', 'autopay', ji, 100, 1);
  ok := false; BEGIN INSERT INTO online_payments (org_id, account_id, kind, invoice_id, amount_cents, attempt) VALUES (o1, 'acct_A2', 'autopay', ji, 100, 1); EXCEPTION WHEN unique_violation THEN ok := true; END; ASSERT ok, 'P6 autopay attempt unique';
  INSERT INTO online_payments (org_id, account_id, kind, invoice_id, amount_cents, attempt) VALUES (o1, 'acct_A2', 'autopay', ji, 100, 2);

  -- P7 browser roles get nothing on the new tables and functions
  ASSERT NOT has_table_privilege('anon', 'public.online_payments', 'SELECT'), 'P7 anon table';
  ASSERT NOT has_table_privilege('authenticated', 'public.payment_accounts', 'SELECT'), 'P7 authenticated table';
  ASSERT NOT has_table_privilege('authenticated', 'public.customer_payment_methods', 'SELECT'), 'P7 cards';
  ASSERT NOT has_function_privilege('authenticated', 'public.record_customer_invoice_refund(uuid, uuid, integer, date, text, text, text, integer)', 'EXECUTE'), 'P7 refund fn';
  ASSERT NOT has_function_privilege('anon', 'public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid, text)', 'EXECUTE'), 'P7 payment fn';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE relname = 'online_payments'), 'P7 RLS on';

  -- P8 record_job_payment: payment + outbox in one transaction; same key = same payment; a lost outbox row comes back
  r := record_job_payment(o1, j1, '2026-11-12', 5000, 'deposit', 'card', 'homeowner', 'Paid online', null, 'stripe:pi_job', 'payment.recorded');
  ASSERT NOT (r->>'duplicate')::boolean, 'P8 first';
  jp := (r->'payment'->>'id')::uuid;
  ASSERT (SELECT count(*) FROM integration_outbox WHERE entity_id = jp AND event_type = 'payment.recorded') = 1, 'P8 outbox written with the payment';
  DELETE FROM integration_outbox WHERE entity_id = jp;
  r := record_job_payment(o1, j1, '2026-11-12', 5000, 'deposit', 'card', 'homeowner', null, null, 'stripe:pi_job', 'payment.recorded');
  ASSERT (r->>'duplicate')::boolean AND (r->'payment'->>'id')::uuid = jp, 'P8 duplicate returns the first';
  ASSERT (SELECT count(*) FROM job_payments WHERE idempotency_key = 'stripe:pi_job') = 1, 'P8 one payment';
  ASSERT (SELECT count(*) FROM integration_outbox WHERE entity_id = jp) = 1, 'P8 lost outbox row re-queued';
  ok := false; BEGIN PERFORM record_job_payment(o2, j1, '2026-11-12', 1, 'other', 'card', 'homeowner', null, null, null, 'payment.recorded'); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'P8 other company';
  ok := false; BEGIN PERFORM record_job_payment(o1, j1, '2026-11-12', 1, 'other', 'card', 'homeowner', null, null, null, 'payment.bogus'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P8 event list';
  -- a failing outbox insert rolls the payment back (one transaction)
  ALTER TABLE integration_outbox ADD CONSTRAINT no_more CHECK (event_type <> 'payment.refunded');
  ok := false; BEGIN PERFORM record_job_payment(o1, j1, '2026-11-12', -100, 'deposit', 'card', 'homeowner', null, null, 'stripe-refund:re_tx', 'payment.refunded'); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok AND NOT EXISTS (SELECT 1 FROM job_payments WHERE idempotency_key = 'stripe-refund:re_tx'), 'P8 payment rolled back with its outbox row';
  ALTER TABLE integration_outbox DROP CONSTRAINT no_more;

  -- P9 apply_job_invoice_payment: locked, never over the payment's rest nor the invoice balance; once per payment
  DECLARE ji2 uuid; jp2 uuid; jr uuid; BEGIN
    INSERT INTO job_invoices (job_id, created_by, total_cents, status) VALUES (j1, u1, 4000, 'sent') RETURNING id INTO ji2;
    ok := false; BEGIN PERFORM apply_job_invoice_payment(o1, ji2, jp, 4001, u1); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P9 over balance refused';
    r := apply_job_invoice_payment(o1, ji2, jp, 4000, u1);
    ASSERT r->>'status' = 'paid', 'P9 paid ' || r::text;
    r := apply_job_invoice_payment(o1, ji2, jp, 4000, u1);
    ASSERT (r->>'duplicate')::boolean AND (SELECT count(*) FROM invoice_payments WHERE invoice_id = ji2) = 1, 'P9 once per payment';
    ok := false; BEGIN PERFORM apply_job_invoice_payment(o2, ji2, jp, 1, u1); EXCEPTION WHEN no_data_found THEN ok := true; END; ASSERT ok, 'P9 other company';
    -- the payment's last 1000 can't go on a second invoice beyond what it has left
    INSERT INTO job_invoices (job_id, created_by, total_cents, status) VALUES (j1, u1, 9000, 'sent') RETURNING id INTO jp2;
    ok := false; BEGIN PERFORM apply_job_invoice_payment(o1, jp2, jp, 1001, u1); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P9 over payment rest refused';
    -- refund back off: only a negative payment, never more than its amount or the net paid
    r := record_job_payment(o1, j1, '2026-11-13', -1500, 'deposit', 'card', 'homeowner', null, null, 'stripe-refund:re_job', 'payment.refunded');
    jr := (r->'payment'->>'id')::uuid;
    ASSERT (SELECT event_type FROM integration_outbox WHERE entity_id = jr) = 'payment.refunded', 'P9 refund outbox event';
    ok := false; BEGIN PERFORM apply_job_invoice_payment(o1, ji2, jr, -1501, null); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P9 refund over its amount';
    ok := false; BEGIN PERFORM apply_job_invoice_payment(o1, jp2, jp, -100, null); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P9 positive payment cannot be taken back';
    r := apply_job_invoice_payment(o1, ji2, jr, -1500, null);
    ASSERT r->>'status' = 'partially_paid' AND (SELECT sum(applied_cents) FROM invoice_payments WHERE invoice_id = ji2) = 2500, 'P9 refund re-opens by its amount';
  END;

  -- P10 no-job refund: the money row is the whole refund, only `unapply` comes off the invoice
  DECLARE inv3 uuid; BEGIN
    INSERT INTO job_invoices (job_id, org_id, customer_id, invoice_kind, status, total_cents) VALUES (null, o1, ca, 'service', 'sent', 2000) RETURNING id INTO inv3;
    PERFORM record_customer_invoice_payment(o1, inv3, 2000, '2026-11-12', 'card', null, null, 'stripe:pi_3');
    r := record_customer_invoice_refund(o1, inv3, 500, '2026-11-13', 'card', null, 'stripe-refund:re_3', 0);
    ASSERT (SELECT amount_cents FROM job_payments WHERE idempotency_key = 'stripe-refund:re_3') = -500, 'P10 money row';
    ASSERT (SELECT status FROM job_invoices WHERE id = inv3) = 'paid' AND (SELECT sum(applied_cents) FROM invoice_payments WHERE invoice_id = inv3) = 2000, 'P10 invoice stays paid';
    ok := false; BEGIN PERFORM record_customer_invoice_refund(o1, inv3, 100, '2026-11-13', 'card', null, 'stripe-refund:re_4', 200); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END; ASSERT ok, 'P10 unapply over refund refused';
  END;

  -- P11 link attempts: atomic per link, window resets
  DECLARE l uuid; i int; BEGIN
    INSERT INTO payment_links (org_id, kind, token_hash, invoice_id, expires_at) VALUES (o1, 'invoice', 'h-limit', inv, now() + interval '1 day') RETURNING id INTO l;
    FOR i IN 1..3 LOOP ASSERT payment_link_take_attempt(l, 3, 900), 'P11 within limit ' || i; END LOOP;
    ASSERT NOT payment_link_take_attempt(l, 3, 900), 'P11 over limit';
    UPDATE payment_links SET attempt_window_start = now() - interval '1 hour' WHERE id = l;
    ASSERT payment_link_take_attempt(l, 3, 900), 'P11 new window';
    ASSERT NOT payment_link_take_attempt(gen_random_uuid(), 3, 900), 'P11 unknown link';
  END;
  ASSERT NOT has_function_privilege('authenticated', 'public.record_job_payment(uuid, uuid, date, integer, text, text, text, text, uuid, text, text)', 'EXECUTE'), 'P7 job writer';
  ASSERT NOT has_function_privilege('anon', 'public.apply_job_invoice_payment(uuid, uuid, uuid, integer, uuid)', 'EXECUTE'), 'P7 apply';

  -- P12 second review columns: saved currency per attempt, reversal flag
  ASSERT (SELECT data_type FROM information_schema.columns WHERE table_name = 'online_payments' AND column_name = 'currency') = 'text', 'P12 currency column';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'online_payments' AND column_name = 'reversal_flag'), 'P12 reversal flag';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'online_payments' AND column_name = 'reversed_at'), 'P12 reversed at';

  RAISE NOTICE 'REPORT: online payments assertions passed';
END $t$;
