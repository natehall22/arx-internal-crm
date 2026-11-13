-- Installation agreement: the roof color the rep types when sending, and the customer's initials confirming it
-- (Nathan, 2026-11-12). Replaces the landscaping/cosmetic acknowledgement (Section 8 covers it); the old
-- customer_initials_landscaping column stays, untouched, for contracts already signed. Additive and nullable; NOT applied.
-- Apply BEFORE the code: /api/contracts/create inserts roof_color and the sign route writes customer_initials_color.
alter table public.order_form_contracts
  add column if not exists roof_color text,
  add column if not exists customer_initials_color text;
