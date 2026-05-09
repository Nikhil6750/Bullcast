-- Remove broad table privileges from browser roles. RLS limits rows, but
-- authenticated clients should only need CRUD privileges for these tables.

do $$
declare
  target_table text;
begin
  foreach target_table in array array['journal_trades', 'analysis_history', 'trader_profiles']
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('revoke all on public.%I from anon', target_table);
      execute format('revoke all on public.%I from authenticated', target_table);
      execute format('grant select, insert, update, delete on public.%I to authenticated', target_table);
    end if;
  end loop;
end $$;
