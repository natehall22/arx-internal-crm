-- Enable RLS on all tables
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricebook_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;

-- Orgs: Users can read their own org
CREATE POLICY "Users can read their own org"
  ON orgs FOR SELECT
  USING (id = get_user_org_id(auth.uid()));

-- Users: Users can read users in their org
CREATE POLICY "Users can read users in their org"
  ON users FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Users: Admins/managers can update users in their org
CREATE POLICY "Admins/managers can update users in their org"
  ON users FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Users: Admins/managers can insert users in their org
CREATE POLICY "Admins/managers can insert users in their org"
  ON users FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Leads: Users can read leads in their org
CREATE POLICY "Users can read leads in their org"
  ON leads FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Leads: Users can insert leads in their org
CREATE POLICY "Users can insert leads in their org"
  ON leads FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Leads: Users can update leads in their org
CREATE POLICY "Users can update leads in their org"
  ON leads FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

-- Leads: Users can delete leads in their org (admins/managers only for safety)
CREATE POLICY "Admins/managers can delete leads in their org"
  ON leads FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Customers: Users can read customers in their org
CREATE POLICY "Users can read customers in their org"
  ON customers FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Customers: Users can insert customers in their org
CREATE POLICY "Users can insert customers in their org"
  ON customers FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Customers: Users can update customers in their org
CREATE POLICY "Users can update customers in their org"
  ON customers FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

-- Customers: Admins/managers can delete customers in their org
CREATE POLICY "Admins/managers can delete customers in their org"
  ON customers FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Jobs: Users can read jobs in their org
CREATE POLICY "Users can read jobs in their org"
  ON jobs FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Jobs: Users can insert jobs in their org
CREATE POLICY "Users can insert jobs in their org"
  ON jobs FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Jobs: Users can update jobs in their org
CREATE POLICY "Users can update jobs in their org"
  ON jobs FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

-- Jobs: Admins/managers can delete jobs in their org
CREATE POLICY "Admins/managers can delete jobs in their org"
  ON jobs FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Activities: Users can read activities in their org
CREATE POLICY "Users can read activities in their org"
  ON activities FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Activities: Users can insert activities in their org
CREATE POLICY "Users can insert activities in their org"
  ON activities FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Activities: Users can update their own activities in their org
CREATE POLICY "Users can update their own activities in their org"
  ON activities FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Activities: Users can delete their own activities in their org
CREATE POLICY "Users can delete their own activities in their org"
  ON activities FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Files: Users can read files in their org
CREATE POLICY "Users can read files in their org"
  ON files FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Files: Users can insert files in their org
CREATE POLICY "Users can insert files in their org"
  ON files FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Files: Users can update their own files in their org
CREATE POLICY "Users can update their own files in their org"
  ON files FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Files: Users can delete their own files in their org
CREATE POLICY "Users can delete their own files in their org"
  ON files FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- Pricebooks: Users can read pricebooks in their org
CREATE POLICY "Users can read pricebooks in their org"
  ON pricebooks FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Pricebooks: Admins/managers can insert pricebooks in their org
CREATE POLICY "Admins/managers can insert pricebooks in their org"
  ON pricebooks FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebooks: Admins/managers can update pricebooks in their org
CREATE POLICY "Admins/managers can update pricebooks in their org"
  ON pricebooks FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebooks: Admins/managers can delete pricebooks in their org
CREATE POLICY "Admins/managers can delete pricebooks in their org"
  ON pricebooks FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebook Items: Users can read pricebook items in their org
CREATE POLICY "Users can read pricebook items in their org"
  ON pricebook_items FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Pricebook Items: Admins/managers can insert pricebook items in their org
CREATE POLICY "Admins/managers can insert pricebook items in their org"
  ON pricebook_items FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebook Items: Admins/managers can update pricebook items in their org
CREATE POLICY "Admins/managers can update pricebook items in their org"
  ON pricebook_items FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Pricebook Items: Admins/managers can delete pricebook items in their org
CREATE POLICY "Admins/managers can delete pricebook items in their org"
  ON pricebook_items FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Estimates: Users can read estimates in their org
CREATE POLICY "Users can read estimates in their org"
  ON estimates FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Estimates: Users can insert estimates in their org
CREATE POLICY "Users can insert estimates in their org"
  ON estimates FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Estimates: Users can update estimates in their org
CREATE POLICY "Users can update estimates in their org"
  ON estimates FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

-- Estimates: Admins/managers can delete estimates in their org
CREATE POLICY "Admins/managers can delete estimates in their org"
  ON estimates FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Estimate Lines: Users can read estimate lines in their org
CREATE POLICY "Users can read estimate lines in their org"
  ON estimate_lines FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Estimate Lines: Users can insert estimate lines in their org
CREATE POLICY "Users can insert estimate lines in their org"
  ON estimate_lines FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Estimate Lines: Users can update estimate lines in their org
CREATE POLICY "Users can update estimate lines in their org"
  ON estimate_lines FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

-- Estimate Lines: Users can delete estimate lines in their org
CREATE POLICY "Users can delete estimate lines in their org"
  ON estimate_lines FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));
