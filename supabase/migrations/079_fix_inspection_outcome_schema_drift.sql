-- Fix schema drift for inspection outcomes.
-- Some environments still have `inspection_outcome` enum with limited values.
-- App code now supports additional outcomes like `moving_to_close`.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'inspection_status_updates'
      and column_name = 'outcome'
      and data_type <> 'text'
  ) then
    alter table inspection_status_updates
      alter column outcome type text using outcome::text;
  end if;
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'opportunities'
      and column_name = 'inspection_outcome'
      and data_type <> 'text'
  ) then
    alter table opportunities
      alter column inspection_outcome type text using inspection_outcome::text;
  end if;
exception
  when undefined_table then
    null;
end $$;

