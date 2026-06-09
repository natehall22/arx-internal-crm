ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_follow_up_at ON opportunities(follow_up_at);
CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline_stage ON opportunities(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_assigned_user_id ON opportunities(assigned_user_id);
