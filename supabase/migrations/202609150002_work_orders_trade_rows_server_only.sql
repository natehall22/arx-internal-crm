-- ============================================
-- WORK ORDERS: TRADE ROWS ARE SERVER-WRITE ONLY
--
-- "Users can manage work_orders in their org" was FOR ALL with only an org
-- check, so any signed-in user (a setter, a canvasser) could PATCH a job's crew
-- row straight through PostgREST: move it to another sub or date without the
-- Google invite following, un-complete it, or read/replace its crew photo link.
-- The API routes that own trades require `jobs:edit` — RLS did not.
--
-- No browser code writes trade rows: every trade write goes through
-- /api/ops/install-schedule/* and /api/ops/jobs/[id]/trades with the service
-- role (which bypasses RLS) after `resolveOpsAccess().canEditJobs`. So rather
-- than re-encode "who holds jobs:edit" in SQL (a second, drifting copy of
-- lib/permissions.ts — see CLAUDE.md Known Redundancy #1), authenticated users
-- simply may not write trade rows at all.
--
-- Service work orders (go-back, repair, warranty: `trade IS NULL`) keep exactly
-- their previous access — /work-orders creates and updates them from the browser.
-- WITH CHECK also stops a service row being turned into a trade, or given a
-- crew link token (a link only resolves on a trade row, but belt and braces).
-- ============================================

DROP POLICY IF EXISTS "Users can manage work_orders in their org" ON work_orders;

CREATE POLICY "Users can insert service work_orders in their org"
  ON work_orders FOR INSERT
  WITH CHECK (
    org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid())
    AND trade IS NULL
    AND crew_link_token IS NULL
  );

CREATE POLICY "Users can update service work_orders in their org"
  ON work_orders FOR UPDATE
  USING (
    org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid())
    AND trade IS NULL
  )
  WITH CHECK (
    org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid())
    AND trade IS NULL
    AND crew_link_token IS NULL
  );

CREATE POLICY "Users can delete service work_orders in their org"
  ON work_orders FOR DELETE
  USING (
    org_id IN (SELECT users.org_id FROM users WHERE users.id = auth.uid())
    AND trade IS NULL
  );

-- Same rule for sub logins: a sub may update its own service work orders, never
-- a crew row (that would let a crew reassign or re-date itself off the board).
DROP POLICY IF EXISTS "Subs can update assigned work orders" ON work_orders;
CREATE POLICY "Subs can update assigned work orders"
  ON work_orders FOR UPDATE
  USING (assigned_sub_id = get_sub_id_for_user(auth.uid()) AND trade IS NULL)
  WITH CHECK (assigned_sub_id = get_sub_id_for_user(auth.uid()) AND trade IS NULL AND crew_link_token IS NULL);

-- SELECT is unchanged ("Users can view work_orders in their org",
-- "Subs can view assigned work orders").
