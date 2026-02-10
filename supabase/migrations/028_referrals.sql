-- Referral Tracking System
-- Migration: 028_referrals.sql

-- Referral status enum
CREATE TYPE referral_status AS ENUM (
  'pending',           -- Referral submitted, waiting for referred person to become a customer
  'qualified',         -- Referred person has become a lead/opportunity
  'installed',         -- Referred person's project has been installed (triggers payout)
  'paid',              -- Referral bonus has been paid out
  'cancelled'          -- Referral was cancelled or invalid
);

-- Referrals table
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  
  -- Who made the referral (the referring customer)
  referrer_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referrer_name TEXT,  -- Cached for display
  referrer_email TEXT,
  referrer_phone TEXT,
  
  -- Who was referred (the new potential customer)
  referred_name TEXT NOT NULL,
  referred_email TEXT,
  referred_phone TEXT,
  referred_address TEXT,
  referred_notes TEXT,
  
  -- Link to the referred person once they become a customer/lead/project
  referred_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  referred_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  referred_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  
  -- Referral bonus details
  bonus_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  bonus_type TEXT DEFAULT 'cash', -- 'cash', 'gift_card', 'credit', 'other'
  bonus_notes TEXT,
  
  -- Status tracking
  status referral_status NOT NULL DEFAULT 'pending',
  
  -- Installation tracking (triggers payout eligibility)
  install_date DATE,
  install_verified_by UUID REFERENCES users(id),
  install_verified_at TIMESTAMPTZ,
  
  -- Payout tracking
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES users(id),
  payment_method TEXT,
  payment_reference TEXT,
  
  -- Notification tracking
  payout_reminder_sent_at TIMESTAMPTZ,
  days_since_install INTEGER GENERATED ALWAYS AS (
    CASE 
      WHEN install_date IS NOT NULL AND paid_at IS NULL 
      THEN EXTRACT(DAY FROM (CURRENT_DATE - install_date))::INTEGER
      ELSE NULL
    END
  ) STORED,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Indexes
CREATE INDEX idx_referrals_org ON referrals(org_id);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_customer_id);
CREATE INDEX idx_referrals_referred_customer ON referrals(referred_customer_id);
CREATE INDEX idx_referrals_referred_project ON referrals(referred_project_id);
CREATE INDEX idx_referrals_status ON referrals(status);
CREATE INDEX idx_referrals_unpaid ON referrals(org_id, status) WHERE status = 'installed' AND paid_at IS NULL;

-- Trigger for updated_at
CREATE TRIGGER update_referrals_updated_at 
  BEFORE UPDATE ON referrals 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Users can view referrals in their org
CREATE POLICY "Users can view referrals in their org"
  ON referrals FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Admins and managers can manage referrals
CREATE POLICY "Admins can manage referrals"
  ON referrals FOR ALL
  USING (
    org_id = get_user_org_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'regional_manager', 'sales_manager', 'operations')
  );

-- Sales reps can create referrals
CREATE POLICY "Sales reps can create referrals"
  ON referrals FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Function to check for unpaid referrals that need attention
CREATE OR REPLACE FUNCTION get_unpaid_referrals(p_org_id UUID, p_days_threshold INTEGER DEFAULT 7)
RETURNS TABLE (
  referral_id UUID,
  referrer_name TEXT,
  referred_name TEXT,
  bonus_amount NUMERIC,
  install_date DATE,
  days_since_install INTEGER,
  referrer_customer_id UUID,
  referred_project_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.referrer_name,
    r.referred_name,
    r.bonus_amount,
    r.install_date,
    r.days_since_install,
    r.referrer_customer_id,
    r.referred_project_id
  FROM referrals r
  WHERE r.org_id = p_org_id
    AND r.status = 'installed'
    AND r.paid_at IS NULL
    AND r.days_since_install >= p_days_threshold
  ORDER BY r.days_since_install DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add default referral bonus to org settings
COMMENT ON TABLE referrals IS 'Tracks customer referrals and their bonus payouts';
