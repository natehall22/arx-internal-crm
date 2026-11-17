-- Security fix (separate from the field_tech files). Found 2026-11-17 by reading pg_policies on the live project (read-only):
--   public.work_orders had INSERT / UPDATE / DELETE policies "Users can insert|update|delete service work_orders in their org" that
--   let ANY signed-in user of the company (setters, canvassers, field roles, subs-as-users included) write "service"
--   work orders (trade IS NULL) straight through the database API. They ARE org-scoped (no cross-company access) and cannot
--   set crew_link_token, but nothing limited who in the company. The app's browser writes to work_orders (new work order form,
--   work order status change) are made by ops / managers, i.e. people who can see the job board.
-- Fix: the same three policies are altered (ALTER POLICY, no policy removed) to also require public.can_view_job_board(auth.uid())
--   — the existing evaluator (admin / owner / ops / job grants; field roles are always refused, 202610280010). The service role
--   (all /api routes, crew links, the schedule) bypasses RLS and is unchanged. Subs keep their own update policy
--   ("Subs can update assigned work orders") and the SELECT policies are untouched.
-- Side effect to know: a sales_rep / closer who has no job-board access can no longer create or change a work order from the
--   browser form (they had no menu entry for it).
--
-- Rollback: ALTER POLICY the three back to the org-only expressions (the definitions above minus the can_view_job_board term).

ALTER POLICY "Users can insert service work_orders in their org" ON public.work_orders
  WITH CHECK (
    org_id IN (SELECT users.org_id FROM public.users WHERE users.id = auth.uid())
    AND trade IS NULL AND crew_link_token IS NULL
    AND public.can_view_job_board(auth.uid())
  );

ALTER POLICY "Users can update service work_orders in their org" ON public.work_orders
  USING (
    org_id IN (SELECT users.org_id FROM public.users WHERE users.id = auth.uid())
    AND trade IS NULL
    AND public.can_view_job_board(auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT users.org_id FROM public.users WHERE users.id = auth.uid())
    AND trade IS NULL AND crew_link_token IS NULL
    AND public.can_view_job_board(auth.uid())
  );

ALTER POLICY "Users can delete service work_orders in their org" ON public.work_orders
  USING (
    org_id IN (SELECT users.org_id FROM public.users WHERE users.id = auth.uid())
    AND trade IS NULL
    AND public.can_view_job_board(auth.uid())
  );

-- users: checked, no change. "Users can read users in their org" is org_id = get_user_org_id(auth.uid()) (same company only, not
-- cross-company), and the insert / update policies are admin-only within the org. Any signed-in person can still read their
-- own company's staff rows (name, email, phone, role) through the database API; that is how the app's pickers work today.
