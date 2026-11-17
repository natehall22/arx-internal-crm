-- New users.role value 'field_tech' (a crew member doing the visits / work in the field; shown as "Field Tech").
-- Additive: one enum label, no row changes. Kept in its own file because a new enum label cannot be used in the same
-- transaction that adds it; 202611300020 (the Field Tech preset and the field-role function) only compares role TEXT, so it
-- does not depend on this running first, but apply this one before the code is deployed (the Add User form can then save it).
--
-- Rollback: nothing to undo on rows; an enum label cannot be removed and stays harmlessly unused.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'field_tech';
