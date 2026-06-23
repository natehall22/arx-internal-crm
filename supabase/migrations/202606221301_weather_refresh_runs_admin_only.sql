-- Restrict weather_refresh_runs read access to admin/owner/operations (run error strings are internal).

DROP POLICY IF EXISTS weather_refresh_runs_authenticated_select ON weather_refresh_runs;

CREATE POLICY weather_refresh_runs_admin_select ON weather_refresh_runs
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'owner', 'operations')
  );
