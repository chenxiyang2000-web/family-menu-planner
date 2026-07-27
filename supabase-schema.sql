create table if not exists public.family_menu_state (
  id uuid primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_family_menu_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists family_menu_state_updated_at
on public.family_menu_state;

create trigger family_menu_state_updated_at
before update on public.family_menu_state
for each row
execute function public.set_family_menu_updated_at();

alter table public.family_menu_state enable row level security;

-- Simple shared-family mode without login.
-- Anyone who has the deployed site's Supabase URL and anon key can access this
-- one row. Add Supabase Auth before storing sensitive data.
drop policy if exists "shared family read" on public.family_menu_state;
create policy "shared family read"
on public.family_menu_state
for select
to anon
using (id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists "shared family insert" on public.family_menu_state;
create policy "shared family insert"
on public.family_menu_state
for insert
to anon
with check (id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists "shared family update" on public.family_menu_state;
create policy "shared family update"
on public.family_menu_state
for update
to anon
using (id = '00000000-0000-0000-0000-000000000001'::uuid)
with check (id = '00000000-0000-0000-0000-000000000001'::uuid);
