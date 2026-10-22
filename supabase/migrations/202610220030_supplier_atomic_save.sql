-- Suppliers: one atomic save+log, and the "one active default supplier per trade" rule enforced by the database.
-- Additive. Replaces the API's two separate writes (vendors row, then supplier_audit_log row) and its
-- read-then-write default-trade check, which two owners saving at once could both pass.
--
--  * save_supplier(): creates/updates a supplier AND writes its change-log row in ONE transaction. The old->new
--    diff is computed here, from the row as it is under the lock, so a concurrent save can never be logged wrongly
--    or clobbered. Stale forms (updated_at moved) are refused.
--  * trigger vendors_one_default_per_trade: no two ACTIVE, non-deleted suppliers in a company may both be the
--    default for the same trade — for ANY writer, not just the API.
--  * unique index: supplier names are unique per company (case-insensitive), ignoring deleted ones.
-- Errors are raised with stable messages the API maps to plain English:
--   supplier_name_required | supplier_not_found | supplier_stale | supplier_name_taken | supplier_default_clash:<other name>

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_org_name_ci
  ON vendors (org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.vendors_one_default_per_trade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE clash text;
BEGIN
  IF NEW.deleted_at IS NULL AND COALESCE(NEW.active, true) AND COALESCE(array_length(NEW.default_for_trades, 1), 0) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('supplier:' || NEW.org_id::text));
    SELECT v.name INTO clash
    FROM vendors v
    WHERE v.org_id = NEW.org_id AND v.id <> NEW.id AND v.deleted_at IS NULL AND v.active
      AND v.default_for_trades && NEW.default_for_trades
    LIMIT 1;
    IF clash IS NOT NULL THEN
      RAISE EXCEPTION 'supplier_default_clash:%', clash USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendors_one_default_per_trade ON vendors;
CREATE TRIGGER trg_vendors_one_default_per_trade
  BEFORE INSERT OR UPDATE OF active, default_for_trades, deleted_at, org_id ON vendors
  FOR EACH ROW EXECUTE FUNCTION public.vendors_one_default_per_trade();

CREATE OR REPLACE FUNCTION public.save_supplier(
  p_org uuid, p_actor uuid, p_id uuid, p_expected_updated_at timestamptz, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old vendors;
  v_name text := btrim(COALESCE(p_input->>'name', ''));
  v_new jsonb;
  v_oldj jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_action text;
  v_id uuid;
  v_updated timestamptz;
  f record;
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'supplier_name_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier:' || p_org::text));

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_old FROM vendors WHERE id = p_id AND org_id = p_org AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_not_found'; END IF;
    IF p_expected_updated_at IS NOT NULL AND v_old.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'supplier_stale';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM vendors WHERE org_id = p_org AND deleted_at IS NULL AND lower(name) = lower(v_name) AND (p_id IS NULL OR id <> p_id)) THEN
    RAISE EXCEPTION 'supplier_name_taken';
  END IF;

  v_new := jsonb_build_object(
    'name', v_name,
    'active', COALESCE((p_input->>'active')::boolean, true),
    'order_email', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'order_email', '')), '')),
    'order_cc_emails', COALESCE(p_input->'order_cc_emails', '[]'::jsonb),
    'account_number', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'account_number', '')), '')),
    'default_branch', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'default_branch', '')), '')),
    'default_delivery_notes', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'default_delivery_notes', '')), '')),
    'default_for_trades', COALESCE(p_input->'default_for_trades', '[]'::jsonb),
    'connection_type', CASE WHEN p_input->>'connection_type' = 'api' THEN 'api' ELSE 'email' END
  );

  IF v_old.id IS NOT NULL THEN
    v_oldj := jsonb_build_object(
      'name', v_old.name, 'active', v_old.active, 'order_email', to_jsonb(v_old.order_email),
      'order_cc_emails', to_jsonb(COALESCE(v_old.order_cc_emails, '{}'::text[])),
      'account_number', to_jsonb(v_old.account_number), 'default_branch', to_jsonb(v_old.default_branch),
      'default_delivery_notes', to_jsonb(v_old.default_delivery_notes),
      'default_for_trades', to_jsonb(COALESCE(v_old.default_for_trades, '{}'::text[])),
      'connection_type', to_jsonb(COALESCE(v_old.connection_type::text, 'email'))
    );
  END IF;

  FOR f IN SELECT * FROM (VALUES
      ('name', 'Name'), ('active', 'Active'), ('order_email', 'Order email'), ('order_cc_emails', 'CC emails'),
      ('account_number', 'Account number'), ('default_branch', 'Branch'), ('default_delivery_notes', 'Delivery notes'),
      ('default_for_trades', 'Default for trades'), ('connection_type', 'How orders are sent')
    ) AS t(k, label)
  LOOP
    IF v_oldj IS NULL THEN
      -- a new supplier: list what was set
      IF f.k IN ('name', 'active') OR COALESCE(v_new->f.k, 'null'::jsonb) NOT IN ('null'::jsonb, '[]'::jsonb) THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', f.k, 'label', f.label, 'old', NULL, 'new', v_new->f.k));
      END IF;
    ELSIF COALESCE(v_oldj->f.k, 'null'::jsonb) IS DISTINCT FROM COALESCE(v_new->f.k, 'null'::jsonb) THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', f.k, 'label', f.label, 'old', v_oldj->f.k, 'new', v_new->f.k));
    END IF;
  END LOOP;

  IF v_old.id IS NOT NULL AND jsonb_array_length(v_changes) = 0 THEN
    RETURN jsonb_build_object('id', v_old.id, 'updated_at', v_old.updated_at, 'changes', '[]'::jsonb, 'unchanged', true);
  END IF;

  IF v_old.id IS NULL THEN
    INSERT INTO vendors (org_id, name, active, order_email, order_cc_emails, account_number, default_branch,
                         default_delivery_notes, default_for_trades, connection_type, created_by)
    VALUES (p_org, v_name, (v_new->>'active')::boolean, v_new->>'order_email',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'order_cc_emails')), '{}'),
            v_new->>'account_number', v_new->>'default_branch', v_new->>'default_delivery_notes',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'default_for_trades')), '{}'),
            (v_new->>'connection_type')::supplier_connection_type, p_actor)
    RETURNING id, updated_at INTO v_id, v_updated;
    v_action := 'created';
  ELSE
    UPDATE vendors SET
      name = v_name, active = (v_new->>'active')::boolean, order_email = v_new->>'order_email',
      order_cc_emails = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'order_cc_emails')), '{}'),
      account_number = v_new->>'account_number', default_branch = v_new->>'default_branch',
      default_delivery_notes = v_new->>'default_delivery_notes',
      default_for_trades = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'default_for_trades')), '{}'),
      connection_type = (v_new->>'connection_type')::supplier_connection_type,
      updated_at = now()
    WHERE id = v_old.id
    RETURNING id, updated_at INTO v_id, v_updated;
    v_action := CASE
      WHEN v_old.active AND NOT (v_new->>'active')::boolean THEN 'deactivated'
      WHEN NOT v_old.active AND (v_new->>'active')::boolean THEN 'reactivated'
      ELSE 'updated' END;
  END IF;

  INSERT INTO supplier_audit_log (org_id, vendor_id, action, changed_by, changes)
  VALUES (p_org, v_id, v_action, p_actor, v_changes);

  RETURN jsonb_build_object('id', v_id, 'updated_at', v_updated, 'changes', v_changes, 'unchanged', false, 'action', v_action);
END;
$$;

REVOKE ALL ON FUNCTION public.save_supplier(uuid, uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_supplier(uuid, uuid, uuid, timestamptz, jsonb) TO service_role;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.save_supplier(uuid, uuid, uuid, timestamptz, jsonb);
--   DROP TRIGGER IF EXISTS trg_vendors_one_default_per_trade ON vendors;
--   DROP FUNCTION IF EXISTS public.vendors_one_default_per_trade();
--   DROP INDEX IF EXISTS uq_vendors_org_name_ci;
