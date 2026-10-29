-- MGS 3D: выполнить один раз в Supabase → SQL Editor → New query → Run

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  client      text,
  address     text,
  share_token text unique not null default encode(gen_random_bytes(12), 'hex'),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  kind        text,
  files       jsonb not null default '[]',
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.items    enable row level security;

-- сотрудники (вошедшие по логину) видят и меняют всё
drop policy if exists staff_projects on public.projects;
create policy staff_projects on public.projects for all to authenticated using (true) with check (true);
drop policy if exists staff_items on public.items;
create policy staff_items on public.items for all to authenticated using (true) with check (true);

-- клиент без логина получает только один проект — по секретной ссылке
create or replace function public.shared_project(t text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'project', json_build_object('id', p.id, 'title', p.title, 'address', p.address),
    'items', coalesce((
      select json_agg(json_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'files', i.files)
                      order by i.sort, i.created_at)
      from public.items i where i.project_id = p.id), '[]'::json))
  from public.projects p where p.share_token = t
$$;
revoke all on function public.shared_project(text) from public;
grant execute on function public.shared_project(text) to anon, authenticated;

-- хранилище моделей: читать может любой по прямой ссылке, загружать — только сотрудники
insert into storage.buckets (id, name, public, file_size_limit)
values ('models', 'models', true, 52428800)
on conflict (id) do update set public = true;

drop policy if exists models_insert on storage.objects;
create policy models_insert on storage.objects for insert to authenticated with check (bucket_id = 'models');
drop policy if exists models_update on storage.objects;
create policy models_update on storage.objects for update to authenticated using (bucket_id = 'models');
drop policy if exists models_delete on storage.objects;
create policy models_delete on storage.objects for delete to authenticated using (bucket_id = 'models');
drop policy if exists models_select on storage.objects;
create policy models_select on storage.objects for select to authenticated using (bucket_id = 'models');
