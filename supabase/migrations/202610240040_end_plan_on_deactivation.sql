-- Deactivating a user ends their open pay-plan assignments automatically (last covered day = the deactivation day;
-- user_payroll_active_history already records the first inactive day as tomorrow). Reactivation does NOT restore a
-- plan: someone assigns a new one. Replaces the function from 202608050002; the trigger is unchanged. Additive.
CREATE OR REPLACE FUNCTION record_user_payroll_active_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  today_et DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO user_payroll_active_history (
      org_id, user_id, is_active, effective_from
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.active,
      today_et + 1
    )
    ON CONFLICT (user_id, effective_from) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      created_at = NOW();

    IF NEW.active IS FALSE THEN
      UPDATE user_comp_plans
         SET effective_to = today_et
       WHERE user_id = NEW.id
         AND org_id = NEW.org_id
         AND effective_from <= today_et
         AND (effective_to IS NULL OR effective_to > today_et);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- Rollback: re-run the function body from 202608050002_org_manager_override_and_self_gen_rates.sql.
