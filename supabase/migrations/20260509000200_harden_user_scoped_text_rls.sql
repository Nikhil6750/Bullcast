-- Harden Bullcast journal persistence RLS for authenticated, user-scoped access.
-- Existing deployments use text user_id values; fresh databases may use uuid from
-- the earlier migration. Policies below adapt to the actual column type.

do $$
declare
  target_table text;
  user_id_type text;
  own_expr text;
  policy_record record;
begin
  foreach target_table in array array['journal_trades', 'analysis_history', 'trader_profiles']
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      select data_type
      into user_id_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'user_id';

      if user_id_type is null then
        execute format(
          'alter table public.%I add column user_id uuid references auth.users(id) on delete cascade',
          target_table
        );
        user_id_type := 'uuid';
      end if;

      if user_id_type = 'uuid' then
        own_expr := '((select auth.uid()) is not null and (select auth.uid()) = user_id)';
      else
        own_expr := '((select auth.uid()) is not null and user_id = (select auth.uid())::text)';
      end if;

      execute format('alter table public.%I enable row level security', target_table);
      execute format('revoke all on public.%I from anon', target_table);
      execute format('grant select, insert, update, delete on public.%I to authenticated', target_table);
      execute format(
        'create index if not exists %I on public.%I(user_id)',
        target_table || '_user_id_idx',
        target_table
      );

      for policy_record in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = target_table
      loop
        execute format('drop policy if exists %I on public.%I', policy_record.policyname, target_table);
      end loop;

      execute format(
        'create policy %I on public.%I for select to authenticated using (%s)',
        target_table || '_select_own',
        target_table,
        own_expr
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (%s)',
        target_table || '_insert_own',
        target_table,
        own_expr
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
        target_table || '_update_own',
        target_table,
        own_expr,
        own_expr
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (%s)',
        target_table || '_delete_own',
        target_table,
        own_expr
      );

      execute format(
        'comment on table public.%I is %L',
        target_table,
        'Bullcast authenticated user-scoped persistence. RLS restricts access to rows owned by auth.uid().'
      );
    end if;
  end loop;
end $$;
