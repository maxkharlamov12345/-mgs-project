-- Новый 3D-проект → карточка клиента в CRM (Макс 12.11: «выгрузил из PRO100 — карточка в „Взят в работу“»).
-- Проект без client_id (кнопка PRO100 создаёт проект: название, клиент, адрес) сам заводит клиента stage = work
-- с тем же менеджером и салоном и привязывается к нему. Проект из карточки клиента (client_id задан) клиента не создаёт.
-- Триггер projects_to_crm идёт после projects_fill (по алфавиту), поэтому менеджер и салон уже известны.
create or replace function public.projects_to_crm()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text := nullif(trim(coalesce(new.client, '')), '');
begin
  if new.client_id is null then
    insert into public.clients(name, address, want, stage, manager_id, salon_id)
    values (coalesce(cname, nullif(trim(new.title), ''), 'Клиент из PRO100'),
            coalesce(trim(new.address), ''),
            case when cname is not null then coalesce(trim(new.title), '') else '' end,
            'work', new.manager_id, new.salon_id)
    returning id into new.client_id;
  end if;
  return new;
end $$;
drop trigger if exists projects_to_crm on public.projects;
create trigger projects_to_crm before insert on public.projects
  for each row execute function public.projects_to_crm();

notify pgrst, 'reload schema';
