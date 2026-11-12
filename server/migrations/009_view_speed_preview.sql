-- 12.11 (Макс: «очень долгое открытие модели» + «в превью проекта ставить фото из 3D»).
-- 1) Ссылка клиента отдаёт и статус лёгкой модели (glb_status): пока сервер её делает (null / working),
--    просмотр ждёт GLB, а не грузит тяжёлый исходный OBJ.
-- 2) projects.preview — картинка 3D для плитки проекта в карточке клиента (путь в бакете models: <project>/<item>/preview.jpg;
--    снимок делает CRM у сотрудника в браузере, по имени изделия видно, с какого изделия снят).

create or replace function public.shared_project(t text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'project', json_build_object('id', p.id, 'title', p.title, 'address', p.address),
    'items', coalesce((
      select json_agg(json_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'files', i.files,
                                        'glb', case when i.glb_status = 'ok' then i.glb end,
                                        'glb_status', i.glb_status)
                      order by i.sort, i.created_at)
      from public.items i where i.project_id = p.id), '[]'::json))
  from public.projects p where p.share_token = t
$$;
revoke all on function public.shared_project(text) from public;
grant execute on function public.shared_project(text) to anon, authenticated;

alter table public.projects add column if not exists preview text;

notify pgrst, 'reload schema';
