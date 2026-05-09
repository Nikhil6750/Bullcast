-- Replace development-only journal policies with user-scoped Supabase Auth RLS.
-- Existing rows with null user_id will not be visible to authenticated users
-- until they are explicitly backfilled to the correct auth.users.id.

do $$
declare
  policy_record record;
begin
  if to_regclass('public.journal_trades') is not null then
    alter table public.journal_trades
      add column if not exists user_id uuid references auth.users(id) on delete cascade;

    alter table public.journal_trades enable row level security;
    revoke all on public.journal_trades from anon;
    grant select, insert, update, delete on public.journal_trades to authenticated;
    create index if not exists journal_trades_user_id_idx on public.journal_trades(user_id);

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'journal_trades'
    loop
      execute format('drop policy if exists %I on public.journal_trades', policy_record.policyname);
    end loop;

    create policy journal_trades_select_own
      on public.journal_trades for select to authenticated
      using ((select auth.uid()) = user_id);

    create policy journal_trades_insert_own
      on public.journal_trades for insert to authenticated
      with check ((select auth.uid()) = user_id);

    create policy journal_trades_update_own
      on public.journal_trades for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);

    create policy journal_trades_delete_own
      on public.journal_trades for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.analysis_history') is not null then
    alter table public.analysis_history
      add column if not exists user_id uuid references auth.users(id) on delete cascade;

    alter table public.analysis_history enable row level security;
    revoke all on public.analysis_history from anon;
    grant select, insert, update, delete on public.analysis_history to authenticated;
    create index if not exists analysis_history_user_id_idx on public.analysis_history(user_id);

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'analysis_history'
    loop
      execute format('drop policy if exists %I on public.analysis_history', policy_record.policyname);
    end loop;

    create policy analysis_history_select_own
      on public.analysis_history for select to authenticated
      using ((select auth.uid()) = user_id);

    create policy analysis_history_insert_own
      on public.analysis_history for insert to authenticated
      with check ((select auth.uid()) = user_id);

    create policy analysis_history_update_own
      on public.analysis_history for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);

    create policy analysis_history_delete_own
      on public.analysis_history for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.trader_profiles') is not null then
    alter table public.trader_profiles
      add column if not exists user_id uuid references auth.users(id) on delete cascade;

    alter table public.trader_profiles enable row level security;
    revoke all on public.trader_profiles from anon;
    grant select, insert, update, delete on public.trader_profiles to authenticated;
    create index if not exists trader_profiles_user_id_idx on public.trader_profiles(user_id);

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'trader_profiles'
    loop
      execute format('drop policy if exists %I on public.trader_profiles', policy_record.policyname);
    end loop;

    create policy trader_profiles_select_own
      on public.trader_profiles for select to authenticated
      using ((select auth.uid()) = user_id);

    create policy trader_profiles_insert_own
      on public.trader_profiles for insert to authenticated
      with check ((select auth.uid()) = user_id);

    create policy trader_profiles_update_own
      on public.trader_profiles for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);

    create policy trader_profiles_delete_own
      on public.trader_profiles for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;
