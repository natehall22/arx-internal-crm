-- Connect referrals to the deal they earned the bonus on.
--
-- 028_referrals.sql shipped referred_customer_id / referred_lead_id /
-- referred_project_id, but no opportunity link and no UI to set any of them, so
-- every referral was an orphan text blob and status had to be hand-advanced.
--
-- The opportunity is the record that carries the address, inspection, measure and
-- proposal, and it is what becomes a project with an install date -- which is what
-- actually earns the bonus. One customer can have several opportunities (roof now,
-- gutters later), so the customer alone cannot say which job the bonus was for.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS referred_opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_referred_opportunity
  ON referrals(referred_opportunity_id);

-- Supports the install trigger's lookup by project without a full scan.
CREATE INDEX IF NOT EXISTS idx_referrals_open_by_project
  ON referrals(referred_project_id)
  WHERE status IN ('pending', 'qualified');

COMMENT ON COLUMN referrals.referred_opportunity_id IS
  'The deal the referred person turned into. Primary link; referred_customer_id is derived from it.';

-- ---------------------------------------------------------------------------
-- Linking a record qualifies the referral, and fills the customer from the
-- opportunity so both the deal and the person resolve from one pick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION referrals_apply_link_side_effects()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_opportunity RECORD;
  v_link_added BOOLEAN;
BEGIN
  -- Derive the customer (and project) from a newly attached opportunity rather
  -- than making callers denormalize it themselves.
  IF NEW.referred_opportunity_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.referred_opportunity_id IS DISTINCT FROM OLD.referred_opportunity_id)
  THEN
    SELECT o.customer_id, o.org_id
      INTO v_opportunity
      FROM opportunities o
     WHERE o.id = NEW.referred_opportunity_id;

    -- Never let a link reach across orgs.
    IF v_opportunity.org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'referred_opportunity_id % does not belong to org %',
        NEW.referred_opportunity_id, NEW.org_id;
    END IF;

    IF NEW.referred_customer_id IS NULL THEN
      NEW.referred_customer_id := v_opportunity.customer_id;
    END IF;

    -- referred_lead_id is deliberately NOT derived. deleteCanvassLeadWithDependencies
    -- hard-deletes referrals by referred_lead_id, so deriving it would let a deleted
    -- canvass pin take an unrelated referral's bonus record with it. An explicit lead
    -- link still sets the column, which keeps that existing cascade intentional.

    IF NEW.referred_project_id IS NULL THEN
      SELECT p.id
        INTO NEW.referred_project_id
        FROM projects p
       WHERE p.opportunity_id = NEW.referred_opportunity_id
       ORDER BY p.created_at DESC
       LIMIT 1;
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

DROP TRIGGER IF EXISTS trg_referrals_apply_link_side_effects ON referrals;
CREATE TRIGGER trg_referrals_apply_link_side_effects
  BEFORE INSERT OR UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION referrals_apply_link_side_effects();

-- ---------------------------------------------------------------------------
-- A completed job is the payout trigger. Advance every referral pointing at that
-- job's project or opportunity, so the unpaid-referral alert picks it up without
-- anyone remembering to click "Mark Installed".
--
-- A trigger rather than app code: production_jobs.status is written from the ops
-- job route, sub work-order completion, contract signing and admin backfills, and
-- all of them need to count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION referrals_mark_installed_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
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

  -- Leaves 'paid' and 'cancelled' alone; back-fills the project link so the card
  -- can offer "View Project" on referrals attached only by opportunity.
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

DROP TRIGGER IF EXISTS trg_referrals_mark_installed_from_job ON production_jobs;
CREATE TRIGGER trg_referrals_mark_installed_from_job
  AFTER INSERT OR UPDATE OF status ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION referrals_mark_installed_from_job();

-- RLS is deliberately left as 028 set it: org-wide INSERT, manager-only UPDATE.
-- Attaching a link at create time works under the INSERT policy, and re-linking an
-- existing referral goes through /api/referrals/[id]/link with a permission check,
-- so the payout fields (status, paid_at, payment_method) stay manager-only.
