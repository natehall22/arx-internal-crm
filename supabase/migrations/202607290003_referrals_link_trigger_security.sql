-- Fix: linking an opportunity failed with a false "does not belong to org" error.
--
-- 202607290002 created both referral triggers as plain (invoker-rights) functions, so
-- their reads of `opportunities` / `projects` were filtered by the caller's RLS. Two
-- consequences, both wrong:
--
--   1. referrals_apply_link_side_effects treated "could not read the row" as "row is in
--      another org" and raised. A caller whose session was not applied (expired token,
--      anon fallback) got:
--        referred_opportunity_id <id> does not belong to org <their own org>
--      naming the org the opportunity actually belongs to. Because it is a BEFORE
--      trigger it also pre-empted RLS's own WITH CHECK, hiding the real cause.
--      Reproduced exactly by running the insert as `anon`.
--
--   2. referrals_mark_installed_from_job read `projects` and updated `referrals` the
--      same way, so a job completing under a restricted caller would silently advance
--      nothing -- a missed payout with no error at all.
--
-- Both are system-level bookkeeping over rows the caller has already been authorised to
-- reach, so they run as SECURITY DEFINER and enforce the org boundary themselves against
-- the true row. EXECUTE is revoked so neither can be invoked directly; trigger firing
-- does not consult EXECUTE privileges.

CREATE OR REPLACE FUNCTION referrals_apply_link_side_effects()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_org_id UUID;
  v_link_added BOOLEAN;
BEGIN
  IF NEW.referred_opportunity_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.referred_opportunity_id IS DISTINCT FROM OLD.referred_opportunity_id)
  THEN
    SELECT o.customer_id, o.org_id
      INTO v_customer_id, v_org_id
      FROM opportunities o
     WHERE o.id = NEW.referred_opportunity_id;

    -- A missing row is not an org violation: the FK rejects a bogus id with a clearer
    -- message than anything raised here, so only a real cross-org link is refused.
    IF FOUND AND v_org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION
        'Cannot link opportunity % to a referral in a different org', NEW.referred_opportunity_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF FOUND THEN
      IF NEW.referred_customer_id IS NULL THEN
        NEW.referred_customer_id := v_customer_id;
      END IF;

      -- referred_lead_id stays underived: deleteCanvassLeadWithDependencies hard-deletes
      -- referrals by that column, so deriving it would let a deleted canvass pin take an
      -- unrelated referral's bonus record with it.

      IF NEW.referred_project_id IS NULL THEN
        SELECT p.id
          INTO NEW.referred_project_id
          FROM projects p
         WHERE p.opportunity_id = NEW.referred_opportunity_id
         ORDER BY p.created_at DESC
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- Only advance on a link that was just added, so a manual status stays put.
  v_link_added := (
    TG_OP = 'INSERT' AND (
      NEW.referred_opportunity_id IS NOT NULL OR
      NEW.referred_lead_id IS NOT NULL OR
      NEW.referred_customer_id IS NOT NULL OR
      NEW.referred_project_id IS NOT NULL
    )
  ) OR (
    TG_OP = 'UPDATE' AND (
      (NEW.referred_opportunity_id IS NOT NULL AND OLD.referred_opportunity_id IS NULL) OR
      (NEW.referred_lead_id IS NOT NULL AND OLD.referred_lead_id IS NULL) OR
      (NEW.referred_customer_id IS NOT NULL AND OLD.referred_customer_id IS NULL) OR
      (NEW.referred_project_id IS NOT NULL AND OLD.referred_project_id IS NULL)
    )
  );

  IF v_link_added AND NEW.status = 'pending' THEN
    NEW.status := 'qualified';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION referrals_mark_installed_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity_id UUID;
  v_install_date DATE;
BEGIN
  IF NEW.status NOT IN ('complete', 'collected') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT p.opportunity_id, COALESCE(p.install_date, NEW.completed_at::date, CURRENT_DATE)
    INTO v_opportunity_id, v_install_date
    FROM projects p
   WHERE p.id = NEW.project_id;

  v_install_date := COALESCE(v_install_date, NEW.completed_at::date, CURRENT_DATE);

  -- Scoped to the job's own org, since SECURITY DEFINER no longer relies on RLS for it.
  UPDATE referrals r
     SET status = 'installed',
         install_date = COALESCE(r.install_date, v_install_date),
         referred_project_id = COALESCE(r.referred_project_id, NEW.project_id)
   WHERE r.org_id = NEW.org_id
     AND r.status IN ('pending', 'qualified')
     AND (
       r.referred_project_id = NEW.project_id
       OR (v_opportunity_id IS NOT NULL AND r.referred_opportunity_id = v_opportunity_id)
     );

  RETURN NEW;
END;
$$;

-- Neither is meant to be callable outside its trigger.
REVOKE ALL ON FUNCTION referrals_apply_link_side_effects() FROM PUBLIC;
REVOKE ALL ON FUNCTION referrals_mark_installed_from_job() FROM PUBLIC;
