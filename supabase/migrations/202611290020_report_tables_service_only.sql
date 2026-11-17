-- report_role_access and report_schedules (tables of the retired report builder; nothing in app/ or lib/ reads them, the
-- saved/scheduled reports now live in saved_reports) each have one policy "FOR ALL ... USING (true) WITH CHECK (true)" for
-- every signed-in user: any user of any company could read or rewrite them. Neither table has an org_id column.
-- Both policies are altered to (false): signed-in browser clients get no rows and no writes; the service role (which the app
-- uses, and which bypasses RLS) is unaffected. No policy is removed and no data is touched.
--
-- Rollback:
--   ALTER POLICY "Users can view report access" ON public.report_role_access USING (true) WITH CHECK (true);
--   ALTER POLICY "Users can view report schedules" ON public.report_schedules USING (true) WITH CHECK (true);

ALTER POLICY "Users can view report access" ON public.report_role_access USING (false) WITH CHECK (false);
ALTER POLICY "Users can view report schedules" ON public.report_schedules USING (false) WITH CHECK (false);
