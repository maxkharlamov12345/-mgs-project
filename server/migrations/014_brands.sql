-- Логотипы брендов для сметы (Макс 13.11: «в превью, где выбираем бренд, — логотип фирмы»).
--   brands: key (blum, hettich, boyard, egger, alvic …), logo — адрес картинки (файл в бакете media/brand/… или внешний адрес),
--   dark — логотип светлый, плитка тёмная. Читают все сотрудники, меняет только главный (smeta.html?admin=1 → «Логотипы брендов»).
create table if not exists public.brands (
  key        text primary key,
  logo       text,
  dark       boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.brands enable row level security;
drop policy if exists brands_read on public.brands;
create policy brands_read on public.brands for select to authenticated using (true);
drop policy if exists brands_owner on public.brands;
create policy brands_owner on public.brands for all to authenticated using (public.is_owner()) with check (public.is_owner());
grant select, insert, update, delete on public.brands to authenticated;
grant all on public.brands to service_role;

-- файлы логотипов: публичный бакет media, папка brand/ — пишет только главный
drop policy if exists media_brand_select on storage.objects;
create policy media_brand_select on storage.objects for select to authenticated using (bucket_id = 'media' and name like 'brand/%');
drop policy if exists media_brand_insert on storage.objects;
create policy media_brand_insert on storage.objects for insert to authenticated with check (bucket_id = 'media' and name like 'brand/%' and public.is_owner());
drop policy if exists media_brand_update on storage.objects;
create policy media_brand_update on storage.objects for update to authenticated using (bucket_id = 'media' and name like 'brand/%' and public.is_owner());
drop policy if exists media_brand_delete on storage.objects;
create policy media_brand_delete on storage.objects for delete to authenticated using (bucket_id = 'media' and name like 'brand/%' and public.is_owner());

notify pgrst, 'reload schema';
