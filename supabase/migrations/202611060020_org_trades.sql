-- Each company's own trades list (lib/org-trades.ts — the one source).
--
-- Additive. Safe to apply before OR after the code ships:
--   * before: the app reads DEFAULT_ORG_TRADES (identical to the seed below) when this table is missing;
--   * after:  the app reads org_trades; every existing company is seeded with today's five trades, so
--     nothing changes until an owner edits the list (Settings → Job setup → Trades).
--
-- What it does:
--   1. org_trades (org_id, slug, label, sort, active, match_keywords) — read by org members, written only
--      by the service role (the owner-only /api/admin/job-setup/trades route).
--   2. Seeds EVERY org with roofing / gutters / siding / windows / other, today's labels and line-item
--      keywords (lib/org-trades.ts DEFAULT_ORG_TRADES; a jest test keeps the two equal). New orgs are
--      seeded by a trigger so their work orders never trip the FK below.
--   3. work_orders.trade: the fixed CHECK becomes a composite FK (org_id, trade) → org_trades(org_id, slug),
--      added NOT VALID then validated (21/21 prod rows matched on 2026-11-06). A NULL trade still passes.
--   4. production_jobs.job_type: the fixed CHECK becomes a trigger allowing the org's slugs, 'mixed', and
--      the values the old CHECK allowed.
--   5. Slugs never change (rows reference them); trades are deactivated, never deleted.
--
-- Rollback (if ever needed): re-add the two CHECKs exactly as below, drop the FK, the triggers and the table.
--   work_orders_trade_check:         CHECK (trade IS NULL OR trade IN ('roofing','gutters','siding','windows','other'))
--   production_jobs_job_type_check:  CHECK (job_type IN ('roofing','siding','windows','mixed','gutters'))

BEGIN;

-- 1. Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z][a-z0-9_]{0,39}$' AND slug <> 'mixed'),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  match_keywords TEXT[] NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT org_trades_org_slug_key UNIQUE (org_id, slug)
);

ALTER TABLE public.org_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org can view trades" ON public.org_trades;
CREATE POLICY "Org can view trades" ON public.org_trades FOR SELECT
  USING (org_id = (SELECT u.org_id FROM public.users u WHERE u.id = auth.uid()));
-- No INSERT/UPDATE/DELETE policies: writes are service-role only.

-- Slugs are referenced by work_orders / production_jobs — never renamed or moved between orgs.
CREATE OR REPLACE FUNCTION public.org_trades_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'org_trades.slug and org_id cannot change (deactivate the trade instead)';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_trades_guard ON public.org_trades;
CREATE TRIGGER org_trades_guard BEFORE UPDATE ON public.org_trades
  FOR EACH ROW EXECUTE FUNCTION public.org_trades_guard();

-- 2. Seed -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_org_trades(p_org_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.org_trades (org_id, slug, label, sort, active, match_keywords)
  VALUES
    (p_org_id, 'roofing', 'Roofing', 10, TRUE, NULL),
    (p_org_id, 'gutters', 'Gutters', 20, TRUE, ARRAY['gutter', 'downspout']),
    (p_org_id, 'siding',  'Siding',  30, TRUE, ARRAY['siding']),
    (p_org_id, 'windows', 'Windows', 40, TRUE, ARRAY['\bwindows?\b']),
    (p_org_id, 'other',   'Other',   50, TRUE, NULL)
  ON CONFLICT (org_id, slug) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.seed_default_org_trades(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_org_trades(UUID) TO service_role;

SELECT public.seed_default_org_trades(o.id) FROM public.orgs o;

CREATE OR REPLACE FUNCTION public.orgs_seed_trades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_org_trades(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orgs_seed_trades ON public.orgs;
CREATE TRIGGER orgs_seed_trades AFTER INSERT ON public.orgs
  FOR EACH ROW EXECUTE FUNCTION public.orgs_seed_trades();

-- 3. work_orders.trade → the org's trades -----------------------------------
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_org_trade_fkey;
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_org_trade_fkey
  FOREIGN KEY (org_id, trade) REFERENCES public.org_trades (org_id, slug) NOT VALID;
ALTER TABLE public.work_orders VALIDATE CONSTRAINT work_orders_org_trade_fkey;
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_trade_check;

-- 4. production_jobs.job_type → the org's trades + 'mixed' --------------------
CREATE OR REPLACE FUNCTION public.production_jobs_job_type_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.job_type IS NULL
     OR NEW.job_type IN ('mixed', 'roofing', 'siding', 'windows', 'gutters')
     OR EXISTS (SELECT 1 FROM public.org_trades t WHERE t.org_id = NEW.org_id AND t.slug = NEW.job_type) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'production_jobs.job_type % is not a trade of this company', NEW.job_type
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS production_jobs_job_type_guard ON public.production_jobs;
CREATE TRIGGER production_jobs_job_type_guard BEFORE INSERT OR UPDATE OF job_type, org_id ON public.production_jobs
  FOR EACH ROW EXECUTE FUNCTION public.production_jobs_job_type_guard();
ALTER TABLE public.production_jobs DROP CONSTRAINT IF EXISTS production_jobs_job_type_check;

COMMIT;
