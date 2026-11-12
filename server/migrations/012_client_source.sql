-- 12.11 (Макс): «откуда вы о нас узнали» у клиента — из окна PRO100 («+ Новый клиент») и в карточке CRM.
-- Значения: «Проходящий трафик», «Заявка», «Рекомендация» (список в crm.html и mgs3d_send.ps1; null — не указано).
alter table public.clients add column if not exists source text;

-- 3D-проект = изделие (Макс 12.11): повторная выгрузка того же изделия кладётся новой версией в тот же проект.
-- Ссылка клиента отдаёт время выгрузки каждой версии (подпись вкладки вместо типа изделия, которого больше нет).
create or replace function public.shared_project(t text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'project', json_build_object('id', p.id, 'title', p.title, 'address', p.address),
    'items', coalesce((
      select json_agg(json_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'files', i.files,
                                        'glb', case when i.glb_status = 'ok' then i.glb end,
                                        'glb_status', i.glb_status, 'created_at', i.created_at)
                      order by i.sort, i.created_at)
      from public.items i where i.project_id = p.id), '[]'::json))
  from public.projects p where p.share_token = t
$$;
revoke all on function public.shared_project(text) from public;
grant execute on function public.shared_project(text) to anon, authenticated;

notify pgrst, 'reload schema';
