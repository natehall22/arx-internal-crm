-- ONE permission for financial data in reports and everything that mirrors them (revenue, sale amounts, payments, job costs,
-- profit / margin, commission, pay, pricebook cost). Admins and owners have it through full access; nobody else is granted it here.
-- Grantable later to any role or person from the permissions screen - no code change. Additive.
insert into public.permissions (name, display_name, description, category)
select 'reports:financials', 'See Financial Data in Reports', 'Revenue, sale amounts, payments, job costs, profit and margin, commission, pay and pricebook cost - in reports, exports, scheduled emails, Today, search and the AI assistant', 'Reports'
where not exists (select 1 from public.permissions where name = 'reports:financials');

-- ROLLBACK: delete from public.permissions where name = 'reports:financials';
