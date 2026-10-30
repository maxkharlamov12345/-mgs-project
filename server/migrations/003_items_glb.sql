-- Лёгкая модель для сайта: сервис convert делает из OBJ сжатый GLB и пишет сюда путь.
alter table public.items add column if not exists glb jsonb;          -- {"path": "...", "size": байт}
alter table public.items add column if not exists glb_status text;    -- null — ждёт, working, ok, error, none (нет .obj)
alter table public.items add column if not exists glb_error text;
create index if not exists items_glb_wait on public.items(created_at) where glb_status is null;

-- клиентская ссылка отдаёт и лёгкую модель
create or replace function public.shared_project(t text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'project', json_build_object('id', p.id, 'title', p.title, 'address', p.address),
    'items', coalesce((
      select json_agg(json_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'files', i.files,
                                        'glb', case when i.glb_status = 'ok' then i.glb end)
                      order by i.sort, i.created_at)
      from public.items i where i.project_id = p.id), '[]'::json))
  from public.projects p where p.share_token = t
$$;
revoke all on function public.shared_project(text) from public;
grant execute on function public.shared_project(text) to anon, authenticated;

notify pgrst, 'reload schema';
