-- CRM (тест, 31.10): клиенты до договора и позиции после договора.
--   clients      — карточка клиента. stage: work (взят в работу) → kp (КП отправлено) → zamer (замер) → contract (договор);
--                  lost — потерянный (обязательна причина lost_reason).
--   positions    — позиции договора, у каждой свой этап stage 1..7:
--                  1 оформлен, 2 отправлен в производство, 3 согласован и запущен, 4 доставка, 5 монтаж, 6 рекламация, 7 закрыт.
--                  kind: furniture (мебель, есть превью) / accessory (сопутка: одна позиция = один контрагент, список lines).
--   client_files — файлы карточки (фото, PDF, КП…) в приватном бакете crm.
--   projects.client_id — 3D-проекты клиента (у клиента их может быть несколько).
-- Видимость — как у проектов: can_see(manager_id, salon_id).

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  num         bigint generated always as identity (start with 1001),
  name        text not null,
  phone       text not null default '',
  address     text not null default '',
  want        text not null default '',          -- что хочет клиент (черновик до договора)
  kp_sum      numeric,                            -- сумма КП
  stage       text not null default 'work' check (stage in ('work','kp','zamer','contract','lost')),
  lost_reason text,
  lost_note   text,
  lost_from   text,                               -- с какого этапа потерян (чтобы вернуть туда же)
  manager_id  uuid default auth.uid(),
  salon_id    uuid references public.salons(id) on delete set null,
  contract_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_manager_idx on public.clients(manager_id);
create index if not exists clients_salon_idx on public.clients(salon_id);
create index if not exists clients_stage_idx on public.clients(stage);

create table if not exists public.positions (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  kind        text not null default 'furniture' check (kind in ('furniture','accessory')),
  name        text not null default '',
  contractor  text not null default '',
  stage       int  not null default 1 check (stage between 1 and 7),
  preview     text,                               -- путь картинки в бакете crm (только у мебели)
  lines       jsonb not null default '[]',        -- сопутка: [{"name":"Ручки","qty":"14 шт"}]
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists positions_client_idx on public.positions(client_id);

create table if not exists public.client_files (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  path        text not null,                      -- <client>/<uuid>.<ext> в бакете crm
  mime        text not null default '',
  size        bigint not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists client_files_client_idx on public.client_files(client_id);

alter table public.projects add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists projects_client_idx on public.projects(client_id);

-- менеджер/салон по умолчанию — как у проектов
create or replace function public.clients_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.manager_id is null then new.manager_id := auth.uid(); end if;
  if tg_op = 'INSERT' then
    if new.salon_id is null then
      select salon_id into new.salon_id from public.staff_profiles where user_id = new.manager_id;
    end if;
  elsif new.manager_id is distinct from old.manager_id and new.salon_id is not distinct from old.salon_id then
    select salon_id into new.salon_id from public.staff_profiles where user_id = new.manager_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists clients_fill on public.clients;
create trigger clients_fill before insert or update on public.clients
  for each row execute function public.clients_fill();

create or replace function public.touch_updated()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists positions_touch on public.positions;
create trigger positions_touch before update on public.positions
  for each row execute function public.touch_updated();

alter table public.clients      enable row level security;
alter table public.positions    enable row level security;
alter table public.client_files enable row level security;

drop policy if exists clients_rw on public.clients;
create policy clients_rw on public.clients for all to authenticated
  using (public.can_see(manager_id, salon_id)) with check (public.can_see(manager_id, salon_id));
drop policy if exists positions_rw on public.positions;
create policy positions_rw on public.positions for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id))
  with check (exists (select 1 from public.clients c where c.id = client_id));
drop policy if exists client_files_rw on public.client_files;
create policy client_files_rw on public.client_files for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id))
  with check (exists (select 1 from public.clients c where c.id = client_id));

grant select, insert, update, delete on public.clients, public.positions, public.client_files to authenticated;
grant all on public.clients, public.positions, public.client_files to service_role;

-- файлы клиентов: приватный бакет, читают и пишут только сотрудники, видящие этого клиента
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm', 'crm', false, 104857600)
on conflict (id) do nothing;

create or replace function public.crm_can(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients c
                 where c.id::text = split_part(path, '/', 1) and public.can_see(c.manager_id, c.salon_id))
$$;
revoke all on function public.crm_can(text) from public;
grant execute on function public.crm_can(text) to authenticated;

drop policy if exists crm_select on storage.objects;
create policy crm_select on storage.objects for select to authenticated using (bucket_id = 'crm' and public.crm_can(name));
drop policy if exists crm_insert on storage.objects;
create policy crm_insert on storage.objects for insert to authenticated with check (bucket_id = 'crm' and public.crm_can(name));
drop policy if exists crm_update on storage.objects;
create policy crm_update on storage.objects for update to authenticated using (bucket_id = 'crm' and public.crm_can(name));
drop policy if exists crm_delete on storage.objects;
create policy crm_delete on storage.objects for delete to authenticated using (bucket_id = 'crm' and public.crm_can(name));

notify pgrst, 'reload schema';
