-- Performance indexes for Team Stats queries
-- These indexes optimize the dashboard team stats aggregation queries

-- Index for inspections set by user (canvasser_user_id is the setter)
CREATE INDEX IF NOT EXISTS idx_scheduled_appointments_canvasser_created 
ON scheduled_appointments(canvasser_user_id, created_at);

-- Index for leads (doors knocked) by owner and date
CREATE INDEX IF NOT EXISTS idx_leads_owner_created 
ON leads(owner_user_id, created_at);

-- Index for opportunities by owner (for sales/close rate)
CREATE INDEX IF NOT EXISTS idx_opportunities_owner_created 
ON opportunities(owner_user_id, created_at);

-- Index for opportunities by setter (backup for inspection attribution)
CREATE INDEX IF NOT EXISTS idx_opportunities_setter_created 
ON opportunities(setter_user_id, created_at);

-- Composite index for team member lookups
CREATE INDEX IF NOT EXISTS idx_users_team_active 
ON users(team_id, active) WHERE active = true;
