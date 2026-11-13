-- СМЕТА (Макс 13.11): каталог из прайсов фабрики, наценки, сметы клиентов.
--   cat_items — каталог: раздел (sec) → бренд/серия (grp) → позиция. kind: item (позиция), price (строка таблицы цен фасадов/корпуса
--               с параметрами в params), decor / mill / color (декоры, фрезы, палитра — без цены, с фото), search (только поиск: Hettich).
--               price — ЦЕНА ФАБРИКИ. Её видит только главный (owner): RLS. Каталог с ценами в репозиторий НЕ кладём (он публичный) —
--               главный загружает файл каталога сам (smeta.html → «Каталог и наценки»).
--   markups   — наценки: key '*' (по умолчанию), 'sec:<раздел>', 'grp:<раздел>|<серия>', 'item:<id>'. Только главный.
--   cat_view  — то, что видят все сотрудники: каталог с ЦЕНОЙ ДЛЯ КЛИЕНТА (cprice = цена фабрики × наценка, до 10 ₽), без цены фабрики.
--   smetas    — сметы клиента: data = {variants:[{name, disc, lines:[…]}], cur}; total — итог текущего варианта (для карточки).

create table if not exists public.cat_items (
  id         text primary key,
  kind       text not null default 'item',
  sec        text not null,
  grp        text not null default '',
  name       text not null,
  unit       text,
  price      numeric,
  params     jsonb not null default '{}',
  photo      text,
  src        text,
  sort       int  not null default 0,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists cat_items_sec_idx on public.cat_items(sec, grp);
create index if not exists cat_items_kind_idx on public.cat_items(kind);

create table if not exists public.markups (
  key        text primary key,
  k          numeric not null check (k > 0 and k < 20),
  updated_at timestamptz not null default now()
);
insert into public.markups(key, k) values ('*', 1.8) on conflict (key) do nothing;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'owner', false)
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

alter table public.cat_items enable row level security;
alter table public.markups   enable row level security;
drop policy if exists cat_items_owner on public.cat_items;
create policy cat_items_owner on public.cat_items for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists markups_owner on public.markups;
create policy markups_owner on public.markups for all to authenticated using (public.is_owner()) with check (public.is_owner());
grant select, insert, update, delete on public.cat_items, public.markups to authenticated;
grant all on public.cat_items, public.markups to service_role;

-- каталог для всех сотрудников: цена для клиента, цены фабрики нет (вид работает с правами владельца — RLS таблицы его не режет)
create or replace view public.cat_view as
  select i.id, i.kind, i.sec, i.grp, i.name, i.unit, i.params, i.photo, i.src, i.sort,
         case when i.price is null then null
              else round(i.price * coalesce(mi.k, mg.k, ms.k, md.k, 1.8) / 10) * 10 end as cprice
  from public.cat_items i
  left join public.markups mi on mi.key = 'item:' || i.id
  left join public.markups mg on mg.key = 'grp:' || i.sec || '|' || i.grp
  left join public.markups ms on ms.key = 'sec:' || i.sec
  left join public.markups md on md.key = '*'
  where i.active;
revoke all on public.cat_view from anon, public;
grant select on public.cat_view to authenticated;

create table if not exists public.smetas (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  title       text not null default 'Смета',
  data        jsonb not null default '{}',
  total       numeric,
  manager_id  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists smetas_client_idx on public.smetas(client_id);
drop trigger if exists smetas_touch on public.smetas;
create trigger smetas_touch before update on public.smetas for each row execute function public.touch_updated();
alter table public.smetas enable row level security;
drop policy if exists smetas_rw on public.smetas;
create policy smetas_rw on public.smetas for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id))
  with check (exists (select 1 from public.clients c where c.id = client_id));
grant select, insert, update, delete on public.smetas to authenticated;
grant all on public.smetas to service_role;

notify pgrst, 'reload schema';
