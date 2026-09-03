ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS completion_certificate_work_description text;

COMMENT ON COLUMN production_jobs.completion_certificate_work_description IS
  'Optional override text for the "WORK TYPE" line and intro sentence on the Certificate of Completion PDF. Falls back to job_type when null. Does not affect job_type or any comp/materials logic.';
