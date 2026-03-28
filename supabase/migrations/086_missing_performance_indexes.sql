-- Performance indexes identified during audit
-- leads.created_at for timeline/feed queries
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

-- opportunities.inspection_outcome_at for outcome date filtering
CREATE INDEX IF NOT EXISTS idx_opportunities_inspection_outcome_at
  ON opportunities(inspection_outcome_at)
  WHERE inspection_outcome_at IS NOT NULL;

-- scheduled_appointments compound for prompt scheduling queries
CREATE INDEX IF NOT EXISTS idx_pending_status_prompts_appointment
  ON pending_status_prompts(appointment_id, completed)
  WHERE completed = false;
