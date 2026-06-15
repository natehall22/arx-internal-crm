-- Knockback reason when a closer marks a non-closing outcome
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS knockback_reason TEXT
    CHECK (knockback_reason IN ('credit_fail', 'not_ready', 'price_objection') OR knockback_reason IS NULL),
  ADD COLUMN IF NOT EXISTS knockback_follow_up_months INTEGER
    CHECK (knockback_follow_up_months IN (2, 4, 6) OR knockback_follow_up_months IS NULL);

-- Who the inside sales rep spoke with on a call/text log
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS spoke_with TEXT;

CREATE INDEX IF NOT EXISTS idx_opportunities_knockback_reason
  ON opportunities(knockback_reason)
  WHERE knockback_reason IS NOT NULL;

COMMENT ON COLUMN opportunities.knockback_reason IS 'Reason closer marked lead as not-closed: credit_fail, not_ready, price_objection';
COMMENT ON COLUMN opportunities.knockback_follow_up_months IS 'Months until inside sales should follow up: 2, 4, or 6';
COMMENT ON COLUMN activities.spoke_with IS 'Name of person inside sales spoke with (may differ from homeowner)';
