-- record_job_payment also respects the plan (orgs.plan_entitlements, migration 202611270010). NOT APPLIED — file only.
-- Same function as 202611220020 with ONE change: no QuickBooks outbox row unless the company is ENTITLED to quickbooks (plan NULL =
-- everything allowed, so ARX and every existing company behave exactly as before; a plan map without quickbooks = no rows). This is
-- the same rule as lib/integrations.ts `enqueueIntegrationEvent` (via loadOrgFeatures). Reads the plan through to_jsonb(orgs) so the
-- function also works if this file is applied before 202611270010 (no column yet = no plan = allowed). The payment itself is
-- always recorded. Replaces the function in place (same signature, same grants). Apply AFTER 202611220020.
-- Down (manual): re-run 202611220020.
begin;
set local lock_timeout = '5s';

create or replace function public.record_job_payment(
  p_org uuid, p_job uuid, p_paid_at date, p_amount_cents integer, p_payment_type text, p_method text, p_payer text,
  p_note text, p_created_by uuid, p_idempotency_key text default null, p_event_type text default 'payment.recorded'
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.production_jobs%rowtype;
  v_pay public.job_payments%rowtype;
  v_dup boolean := false;
  v_key text;
  v_on boolean;
begin
  if p_event_type not in ('payment.recorded', 'payment.refunded', 'payment.disputed', 'payment.voided') then
    raise exception 'record_job_payment: unknown event %', p_event_type using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'Enter an amount' using errcode = '22023';
  end if;
  select * into v_job from public.production_jobs where id = p_job and org_id = p_org;
  if not found then
    raise exception 'record_job_payment: job not found' using errcode = 'P0002';
  end if;
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('job_payments:key:' || p_job::text || ':' || p_idempotency_key, 0));
    select * into v_pay from public.job_payments where job_id = p_job and idempotency_key = p_idempotency_key;
    v_dup := found;
  end if;
  if not v_dup then
    insert into public.job_payments (job_id, paid_at, amount_cents, payment_type, method, payer, note, created_by, idempotency_key)
    values (p_job, p_paid_at, p_amount_cents, p_payment_type, p_method, p_payer, nullif(btrim(p_note), ''), p_created_by, p_idempotency_key)
    returning * into v_pay;
  end if;
  -- QuickBooks is per company and off by default: a company that has not switched it on gets no outbox row (same rule as
  -- lib/integrations.ts `enqueueIntegrationEvent`) and not in the company's plan = no outbox row. The payment itself is always recorded.
  select coalesce((o.settings->'features'->>'quickbooks')::boolean, false)
         and (to_jsonb(o)->'plan_entitlements' is null or jsonb_typeof(to_jsonb(o)->'plan_entitlements') = 'null'
              or (to_jsonb(o)->'plan_entitlements'->>'quickbooks') = 'true')
    into v_on from public.orgs o where o.id = p_org;
  if not coalesce(v_on, false) then
    return jsonb_build_object('payment', to_jsonb(v_pay), 'duplicate', v_dup);
  end if;
  v_key := p_org::text || ':job_payments:' || v_pay.id::text || ':' || p_event_type || ':v1';
  insert into public.integration_outbox (org_id, provider, event_type, entity_table, entity_id, idempotency_key, payload, status)
  values (p_org, 'quickbooks', p_event_type, 'job_payments', v_pay.id, v_key,
    jsonb_build_object(
      'payment', jsonb_build_object('id', v_pay.id, 'job_id', p_job, 'customer_id', v_job.customer_id, 'amount_cents', v_pay.amount_cents,
        'paid_at', v_pay.paid_at, 'payment_type', v_pay.payment_type, 'method', v_pay.method, 'payer', v_pay.payer),
      '_meta', jsonb_build_object('idempotency_key', v_key, 'event_type', p_event_type, 'entity_table', 'job_payments',
        'entity_id', v_pay.id, 'version', 1, 'enqueued_at', now())),
    'pending')
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('payment', to_jsonb(v_pay), 'duplicate', v_dup);
end;
$$;
revoke all on function public.record_job_payment(uuid, uuid, date, integer, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_job_payment(uuid, uuid, date, integer, text, text, text, text, uuid, text, text) to service_role;

commit;
