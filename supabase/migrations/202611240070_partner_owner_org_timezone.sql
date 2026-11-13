-- Codex audit 2026-11-13 #7: the referral-partner owner is chosen "as of the sale date", but the end of that day was taken in
-- America/New_York for every company. A company on another clock that moves a partner to a new owner near midnight could snapshot
-- the wrong owner (and so the wrong partner_owner commission row).
--
-- write_partner_owner_role now ends the sale day in the job's company zone (orgs.timezone, the column every other per-company
-- date already reads — arx_private.org_today / org_date). Body otherwise byte-identical to 202610200001. A New York company (or one
-- with no / an invalid zone) gets the same instant as before, so nothing already written or about to be written moves for it.
-- Safe to apply before or after any code deploy: no code calls this with new arguments; the trigger is unchanged.
--
-- Rollback: re-run the write_partner_owner_role block of 202610200001_referral_partners.sql.
-- Test: supabase/tests/run-partner-owner-zone.sh (throwaway local Postgres).

CREATE OR REPLACE FUNCTION write_partner_owner_role(p_job_id UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j RECORD;
  o RECORD;
  v_owner UUID;
  v_at TIMESTAMPTZ;
  v_partner_name TEXT;
  v_tz TEXT;
BEGIN
  SELECT id, org_id, sale_date, salesperson_id, project_id, job_number
    INTO j FROM production_jobs WHERE id = p_job_id;
  IF NOT FOUND OR j.project_id IS NULL THEN RETURN 'no_job'; END IF;

  SELECT op.id, op.referral_partner_id, op.setter_user_id, op.owner_user_id, op.assigned_user_id,
         ld.closer_user_id AS lead_closer_user_id
    INTO o
    FROM projects p JOIN opportunities op ON op.id = p.opportunity_id
    LEFT JOIN leads ld ON ld.id = op.lead_id
   WHERE p.id = j.project_id;
  -- "Referred By" cleared after the sale: drop the unrated row. A row with a rate set is
  -- payroll's now and is never touched here.
  IF NOT FOUND OR o.referral_partner_id IS NULL THEN
    DELETE FROM deal_commission_roles
     WHERE job_id = j.id AND role = 'partner_owner'
       AND override_amount IS NULL AND override_percent IS NULL;
    RETURN 'no_partner';
  END IF;

  IF EXISTS (SELECT 1 FROM deal_commission_roles WHERE job_id = j.id AND role = 'partner_owner'
              AND (override_amount IS NOT NULL OR override_percent IS NOT NULL)) THEN
    RETURN 'exists';
  END IF;
  -- Unrated row from an earlier partner: replaced below by the current partner's owner.
  DELETE FROM deal_commission_roles WHERE job_id = j.id AND role = 'partner_owner';

  -- The end of the sale day on the COMPANY's own clock (orgs.timezone). A missing or invalid zone falls back to the app
  -- default (America/New_York = DEFAULT_TIMEZONE in lib/timezone.ts), so a New York company gets exactly the old instant.
  SELECT NULLIF(btrim(o2.timezone), '') INTO v_tz FROM orgs o2 WHERE o2.id = j.org_id;
  BEGIN
    v_at := LEAST(((COALESCE(j.sale_date, CURRENT_DATE) + 1)::TIMESTAMP AT TIME ZONE COALESCE(v_tz, 'America/New_York')), NOW());
  EXCEPTION WHEN invalid_parameter_value THEN
    v_at := LEAST(((COALESCE(j.sale_date, CURRENT_DATE) + 1)::TIMESTAMP AT TIME ZONE 'America/New_York'), NOW());
  END;
  v_owner := referral_partner_owner_as_of(o.referral_partner_id, v_at);
  IF v_owner IS NULL THEN RETURN 'unowned'; END IF;

  IF v_owner IN (j.salesperson_id, o.setter_user_id, o.owner_user_id, o.assigned_user_id, o.lead_closer_user_id) THEN
    SELECT name INTO v_partner_name FROM referral_partners WHERE id = o.referral_partner_id;
    INSERT INTO notifications (org_id, recipient_user_id, type, title, body, link_url)
    SELECT j.org_id, u.id, 'partner_owner_conflict',
           'Partner owner also worked job ' || COALESCE(j.job_number, ''),
           COALESCE(v_partner_name, 'A referral partner') ||
             '''s owner is also on this deal. No partner pay row was written — decide whether they are paid twice.',
           '/ops/jobs/' || j.id
      FROM users u WHERE u.org_id = j.org_id AND u.role IN ('admin', 'owner');
    RETURN 'conflict';
  END IF;

  INSERT INTO deal_commission_roles (org_id, job_id, role, user_id)
  VALUES (j.org_id, j.id, 'partner_owner', v_owner)
  ON CONFLICT (job_id, role, user_id) DO NOTHING;
  RETURN 'written';
END $$;
REVOKE ALL ON FUNCTION write_partner_owner_role FROM PUBLIC, anon, authenticated;
