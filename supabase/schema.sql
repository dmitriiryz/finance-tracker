create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  tg_id bigint unique not null,
  first_name text,
  username text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text default 'ARS',
  created_by uuid references public.app_users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.household_members (
  household_id uuid references public.households(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete cascade,
  role text check (role in ('owner','member')) default 'member',
  created_at timestamptz default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  code text unique not null,
  created_by uuid references public.app_users(id),
  expires_at timestamptz,
  used_by uuid references public.app_users(id),
  used_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.shared_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  emoji text default '📦',
  name text not null,
  type text check (type in ('expense','income','both')) default 'expense',
  budget numeric default 0,
  archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.shared_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  created_by uuid references public.app_users(id),
  type text check (type in ('income','expense')) not null,
  "desc" text not null,
  category_id uuid references public.shared_categories(id),
  date date not null,
  amount_original numeric not null,
  currency text check (currency in ('ARS','USD','RUB')) not null,
  rate_to_ars numeric not null,
  amount_ars numeric not null,
  rate_provider text,
  rate_fetched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.shared_rates_cache (
  household_id uuid references public.households(id) on delete cascade,
  currency text not null,
  rate_to_ars numeric not null,
  provider text,
  fetched_at timestamptz,
  updated_at timestamptz default now(),
  primary key (household_id, currency)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_users_touch on public.app_users;
create trigger app_users_touch
before update on public.app_users
for each row execute function public.touch_updated_at();

drop trigger if exists households_touch on public.households;
create trigger households_touch
before update on public.households
for each row execute function public.touch_updated_at();

drop trigger if exists shared_categories_touch on public.shared_categories;
create trigger shared_categories_touch
before update on public.shared_categories
for each row execute function public.touch_updated_at();

drop trigger if exists shared_transactions_touch on public.shared_transactions;
create trigger shared_transactions_touch
before update on public.shared_transactions
for each row execute function public.touch_updated_at();

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = auth.uid()
      and hm.role = 'owner'
  );
$$;

create or replace function public.create_household_with_owner(household_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.app_users where id = auth.uid()) then
    raise exception 'app user is missing';
  end if;

  insert into public.households (name, base_currency, created_by)
  values (coalesce(nullif(household_name, ''), 'Presupuesto compartido'), 'ARS', auth.uid())
  returning id into hid;

  insert into public.household_members (household_id, user_id, role)
  values (hid, auth.uid(), 'owner')
  on conflict (household_id, user_id) do update set role = 'owner';

  return hid;
end;
$$;

create or replace function public.create_household_invite(hid uuid, invite_code text)
returns text
language plpgsql
security definer
set search_path = public
as $
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_household_owner(hid) then
    raise exception 'not household owner';
  end if;

  insert into public.household_invites (household_id, code, created_by)
  values (hid, invite_code, auth.uid())
  on conflict (code) do nothing;

  return invite_code;
end;
$;

create or replace function public.join_household_by_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.household_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.app_users where id = auth.uid()) then
    raise exception 'app user is missing';
  end if;

  select *
  into inv
  from public.household_invites
  where code = invite_code
    and used_at is null
    and (expires_at is null or expires_at > now())
  limit 1;

  if inv.id is null then
    raise exception 'invalid invite';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (inv.household_id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
  set used_by = auth.uid(),
      used_at = now()
  where id = inv.id;

  return inv.household_id;
end;
$$;

alter table public.app_users enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.shared_categories enable row level security;
alter table public.shared_transactions enable row level security;
alter table public.shared_rates_cache enable row level security;

drop policy if exists app_users_self_select on public.app_users;
create policy app_users_self_select
on public.app_users
for select
using (id = auth.uid());

drop policy if exists app_users_self_update on public.app_users;
create policy app_users_self_update
on public.app_users
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists households_member_select on public.households;
create policy households_member_select
on public.households
for select
using (public.is_household_member(id));

drop policy if exists households_create_own on public.households;
create policy households_create_own
on public.households
for insert
with check (created_by = auth.uid());

drop policy if exists households_owner_update on public.households;
create policy households_owner_update
on public.households
for update
using (public.is_household_owner(id))
with check (public.is_household_owner(id));

drop policy if exists household_members_member_select on public.household_members;
create policy household_members_member_select
on public.household_members
for select
using (public.is_household_member(household_id));

drop policy if exists household_members_owner_insert on public.household_members;
create policy household_members_owner_insert
on public.household_members
for insert
with check (public.is_household_owner(household_id));

drop policy if exists household_members_self_delete on public.household_members;
create policy household_members_self_delete
on public.household_members
for delete
using (user_id = auth.uid() or public.is_household_owner(household_id));

drop policy if exists household_invites_member_select on public.household_invites;
create policy household_invites_member_select
on public.household_invites
for select
using (public.is_household_member(household_id));

drop policy if exists household_invites_owner_insert on public.household_invites;
create policy household_invites_owner_insert
on public.household_invites
for insert
with check (public.is_household_owner(household_id) and created_by = auth.uid());

drop policy if exists household_invites_owner_update on public.household_invites;
create policy household_invites_owner_update
on public.household_invites
for update
using (public.is_household_owner(household_id))
with check (public.is_household_owner(household_id));

drop policy if exists shared_categories_member_select on public.shared_categories;
create policy shared_categories_member_select
on public.shared_categories
for select
using (public.is_household_member(household_id));

drop policy if exists shared_categories_member_insert on public.shared_categories;
create policy shared_categories_member_insert
on public.shared_categories
for insert
with check (public.is_household_member(household_id));

drop policy if exists shared_categories_member_update on public.shared_categories;
create policy shared_categories_member_update
on public.shared_categories
for update
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists shared_categories_member_delete on public.shared_categories;
create policy shared_categories_member_delete
on public.shared_categories
for delete
using (public.is_household_member(household_id));

drop policy if exists shared_transactions_member_select on public.shared_transactions;
create policy shared_transactions_member_select
on public.shared_transactions
for select
using (public.is_household_member(household_id));

drop policy if exists shared_transactions_member_insert on public.shared_transactions;
create policy shared_transactions_member_insert
on public.shared_transactions
for insert
with check (public.is_household_member(household_id));

drop policy if exists shared_transactions_member_update on public.shared_transactions;
create policy shared_transactions_member_update
on public.shared_transactions
for update
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists shared_transactions_member_delete on public.shared_transactions;
create policy shared_transactions_member_delete
on public.shared_transactions
for delete
using (public.is_household_member(household_id));

drop policy if exists shared_rates_member_select on public.shared_rates_cache;
create policy shared_rates_member_select
on public.shared_rates_cache
for select
using (public.is_household_member(household_id));

drop policy if exists shared_rates_member_insert on public.shared_rates_cache;
create policy shared_rates_member_insert
on public.shared_rates_cache
for insert
with check (public.is_household_member(household_id));

drop policy if exists shared_rates_member_update on public.shared_rates_cache;
create policy shared_rates_member_update
on public.shared_rates_cache
for update
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists shared_rates_member_delete on public.shared_rates_cache;
create policy shared_rates_member_delete
on public.shared_rates_cache
for delete
using (public.is_household_member(household_id));
