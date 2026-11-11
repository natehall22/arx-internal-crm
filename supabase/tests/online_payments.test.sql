-- DB test for 202611120020_online_payments on top of the invoice migrations. THROWAWAY local Postgres only
-- (run-online-payments.sh). Runs the customer-invoices test first (it builds the schema), then applies 122 + this
-- migration twice and asserts: idempotent payment writer, refund writer (negative rows, never over the net paid, status
-- back down), negative applications allowed / zero refused, the void guard counts the NET paid, the new tables refuse
-- anon/authenticated, one live Stripe account per company.
\set ON_ERROR_STOP 1
\i supabase/tests/customer_invoices.test.sql
\i supabase/migrations/122_job_payments_idempotency.sql
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
  ASSERT NOT has_function_privilege('authenticated', 'public.record_customer_invoice_refund(uuid, uuid, integer, date, text, text, text)', 'EXECUTE'), 'P7 refund fn';
  ASSERT NOT has_function_privilege('anon', 'public.record_customer_invoice_payment(uuid, uuid, integer, date, text, text, uuid, text)', 'EXECUTE'), 'P7 payment fn';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE relname = 'online_payments'), 'P7 RLS on';

  RAISE NOTICE 'REPORT: online payments assertions passed';
END $t$;
