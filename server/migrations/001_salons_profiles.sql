-- Салоны и профили сотрудников (ФИО, телефон, фото, салон). Запись — только через сервис admin (service_role),
-- читать могут все вошедшие сотрудники. Фото — в публичном бакете media.
create table if not exists public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  photo text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.staff_profiles (
  user_id uuid primary key,
  name text not null default '',
  phone text not null default '',
  photo text,
  salon_id uuid references public.salons(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.salons enable row level security;
alter table public.staff_profiles enable row level security;
drop policy if exists salons_read on public.salons;
create policy salons_read on public.salons for select to authenticated using (true);
drop policy if exists profiles_read on public.staff_profiles;
create policy profiles_read on public.staff_profiles for select to authenticated using (true);
grant select on public.salons, public.staff_profiles to authenticated;
grant all on public.salons, public.staff_profiles to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 10485760)
on conflict (id) do nothing;
