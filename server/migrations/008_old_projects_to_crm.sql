-- Старые 3D-проекты (до миграции 007) без клиента → карточки в CRM «Взят в работу» (Макс 12.11: «верни карточку с 3D-файлом,
-- на ней тестирую 3D-просмотр»). Только проекты, где есть хотя бы одно изделие; пустые не трогаем. Разово, по одному клиенту на проект.
-- Имя/адрес/«что хочет»/менеджер/салон — как в триггере projects_to_crm; дата карточки — дата проекта.
do $$
declare p record; cid uuid; cname text;
begin
  for p in select pr.* from public.projects pr
           where pr.client_id is null and exists (select 1 from public.items i where i.project_id = pr.id)
           order by pr.created_at
  loop
    cname := nullif(trim(coalesce(p.client, '')), '');
    insert into public.clients(name, address, want, stage, manager_id, salon_id, created_at)
    values (coalesce(cname, nullif(trim(p.title), ''), 'Клиент из PRO100'),
            coalesce(trim(p.address), ''),
            case when cname is not null then coalesce(trim(p.title), '') else '' end,
            'work', coalesce(p.manager_id, p.created_by), p.salon_id, p.created_at)
    returning id into cid;
    update public.projects set client_id = cid where id = p.id;
  end loop;
end $$;
