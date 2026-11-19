-- service_plan_save: a plan save that hands a kept visit to a different crew clears that visit's stop_order (migration 202611300193),
-- so a stale stop number is never carried onto another crew's day. The ONLY change from 202611110030 is the stop_order line.
-- Additive (CREATE OR REPLACE, same signature and grants). Rollback: re-run the function from 202611110030.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.service_plan_save(
  p_org_id uuid, p_plan_id uuid, p_expected_updated_at timestamptz, p_patch jsonb, p_remove uuid[], p_updates jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.service_plans;
  v_new public.service_plans;
  v_removed int := 0;
  v_cancelled int := 0;
  v_updated int := 0;
  v_group jsonb;
  v_ids uuid[];
  v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('service_plan:' || p_plan_id::text));
  SELECT * INTO v_plan FROM public.service_plans WHERE id = p_plan_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service plan not found' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_plan.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'service plan changed' USING ERRCODE = '40001';
  END IF;

  v_new := jsonb_populate_record(v_plan, COALESCE(p_patch, '{}'::jsonb) - 'id' - 'org_id' - 'customer_id' - 'created_by' - 'created_at' - 'updated_at');
  UPDATE public.service_plans SET
    name = v_new.name, description = v_new.description, property_id = v_new.property_id, trade = v_new.trade,
    price = v_new.price, previous_price = v_new.previous_price, price_starts_on = v_new.price_starts_on, billing_basis = v_new.billing_basis, taxable = v_new.taxable, pricing = v_new.pricing,
    pricing_inputs = v_new.pricing_inputs, tier_key = v_new.tier_key, steps = v_new.steps, status = v_new.status,
    start_date = v_new.start_date, end_date = v_new.end_date, paused_until = v_new.paused_until, seasons = v_new.seasons,
    preferred_weekday = v_new.preferred_weekday, default_sub_id = v_new.default_sub_id, route_position = v_new.route_position,
    ended_at = v_new.ended_at, template_version = v_new.template_version, updated_by = v_new.updated_by
  WHERE id = p_plan_id
  RETURNING * INTO v_new;

  -- Removed slots: only visits of THIS plan still unstarted right now. With a live photo → cancelled (kept), else deleted.
  WITH target AS (
    SELECT w.id, EXISTS (SELECT 1 FROM public.photos ph WHERE ph.work_order_id = w.id AND ph.deleted_at IS NULL) AS has_photo
      FROM public.work_orders w
     WHERE w.id = ANY (COALESCE(p_remove, '{}')) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id
       AND w.status = 'scheduled' AND w.completed_at IS NULL
  ), cancelled AS (
    UPDATE public.work_orders w SET status = 'cancelled' FROM target t WHERE w.id = t.id AND t.has_photo RETURNING w.id
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;
  DELETE FROM public.work_orders w
   WHERE w.id = ANY (COALESCE(p_remove, '{}')) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id
     AND w.status = 'scheduled' AND w.completed_at IS NULL;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Kept slots: groups of { ids, set: {work_orders columns}, charge: { price, taxable } }; only still-scheduled visits.
  FOR v_group IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
    SELECT array_agg(x::uuid) INTO v_ids FROM jsonb_array_elements_text(v_group->'ids') x;
    UPDATE public.work_orders w SET
      title = COALESCE(v_group->'set'->>'title', w.title),
      description = CASE WHEN v_group->'set' ? 'description' THEN v_group->'set'->>'description' ELSE w.description END,
      trade = COALESCE(v_group->'set'->>'trade', w.trade),
      property_id = COALESCE((v_group->'set'->>'property_id')::uuid, w.property_id),
      address = CASE WHEN v_group->'set' ? 'address' THEN v_group->'set'->>'address' ELSE w.address END,
      city = CASE WHEN v_group->'set' ? 'city' THEN v_group->'set'->>'city' ELSE w.city END,
      state = CASE WHEN v_group->'set' ? 'state' THEN v_group->'set'->>'state' ELSE w.state END,
      zip = CASE WHEN v_group->'set' ? 'zip' THEN v_group->'set'->>'zip' ELSE w.zip END,
      assigned_sub_id = CASE WHEN v_group->'set' ? 'assigned_sub_id' THEN (v_group->'set'->>'assigned_sub_id')::uuid ELSE w.assigned_sub_id END,
      -- A visit handed to another crew no longer has a place in the old crew's day: clear its stop number (it is renumbered on its new day).
      stop_order = CASE WHEN v_group->'set' ? 'assigned_sub_id' AND (v_group->'set'->>'assigned_sub_id')::uuid IS DISTINCT FROM w.assigned_sub_id THEN NULL ELSE w.stop_order END
     WHERE w.id = ANY (v_ids) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id AND w.status = 'scheduled';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_updated := v_updated + v_n;
    IF v_group ? 'charge' THEN
      INSERT INTO public.service_visit_charges (work_order_id, org_id, price, taxable)
      SELECT w.id, p_org_id, (v_group->'charge'->>'price')::numeric, COALESCE((v_group->'charge'->>'taxable')::boolean, false)
        FROM public.work_orders w
       WHERE w.id = ANY (v_ids) AND w.org_id = p_org_id AND w.service_plan_id = p_plan_id AND w.status = 'scheduled'
      ON CONFLICT (work_order_id) DO UPDATE SET price = EXCLUDED.price, taxable = EXCLUDED.taxable;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('plan', to_jsonb(v_new), 'removed', v_removed, 'cancelled', v_cancelled, 'updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.service_plan_save(uuid, uuid, timestamptz, jsonb, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_plan_save(uuid, uuid, timestamptz, jsonb, uuid[], jsonb) TO service_role;

COMMIT;
