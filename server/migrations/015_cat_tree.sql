-- Дерево каталога сметы (Макс 13.11: «дерево структуры в управлении, где я сам перетаскиваю в правильную структуру»).
--   cat_tree — перестановки главного поверх файла каталога (файл каталога их не затирает):
--     key 'grp:<раздел>|<группа>'              → вся группа в другой раздел / под другим именем (sec, grp), порядок группы — sort;
--     key 'sub:<раздел>|<группа>|<подгруппа>'  → подгруппа в другой раздел/группу/подгруппу (sec, grp, sub);
--     key 'item:<id>'                          → одна позиция (sec, grp, sub).
--   Приоритет: позиция → подгруппа → группа. Ключи — по ИСХОДНЫМ разделу/группе из файла каталога.
--   cat_view отдаёт уже итоговые sec/grp/params.sub и gsort (порядок группы в разделе; пусто — по порядку файла).
create table if not exists public.cat_tree (
  key        text primary key,
  sec        text,
  grp        text,
  sub        text,
  sort       int,
  updated_at timestamptz not null default now()
);
alter table public.cat_tree enable row level security;
drop policy if exists cat_tree_owner on public.cat_tree;
create policy cat_tree_owner on public.cat_tree for all to authenticated using (public.is_owner()) with check (public.is_owner());
grant select, insert, update, delete on public.cat_tree to authenticated;
grant all on public.cat_tree to service_role;

drop view if exists public.cat_view;
create view public.cat_view as
  select i.id, i.kind,
         coalesce(ti.sec, ts.sec, tg.sec, i.sec) as sec,
         coalesce(ti.grp, ts.grp, tg.grp, i.grp) as grp,
         i.name, i.unit,
         case when ti.key is not null then (i.params - 'sub') || jsonb_strip_nulls(jsonb_build_object('sub', ti.sub))
              when ts.key is not null then (i.params - 'sub') || jsonb_strip_nulls(jsonb_build_object('sub', ts.sub))
              else i.params end as params,
         i.photo, i.src, i.sort,
         case when i.price is null then null
              else round(i.price * coalesce(mi.k, mg.k, ms.k, md.k, 1.8) / 10) * 10 end as cprice,
         tg.sort as gsort,
         i.sec as sec0, i.grp as grp0, i.params->>'sub' as sub0
  from public.cat_items i
  left join public.cat_tree ti on ti.key = 'item:' || i.id
  left join public.cat_tree ts on ts.key = 'sub:' || i.sec || '|' || i.grp || '|' || coalesce(i.params->>'sub', '')
  left join public.cat_tree tg on tg.key = 'grp:' || i.sec || '|' || i.grp
  left join public.markups mi on mi.key = 'item:' || i.id
  left join public.markups mg on mg.key = 'grp:' || i.sec || '|' || i.grp
  left join public.markups ms on ms.key = 'sec:' || i.sec
  left join public.markups md on md.key = '*'
  where i.active;
revoke all on public.cat_view from anon, public;
grant select on public.cat_view to authenticated;

notify pgrst, 'reload schema';
