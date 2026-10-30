-- Роли и видимость проектов:
--   owner   (главный аккаунт) — видит всё;
--   admin   (администратор салонов) — видит проекты своих салонов (admin_salons) и свои;
--   manager (менеджер) — видит только свои проекты (manager_id = он).
-- Роль и салоны хранятся в staff_profiles (их пишет только сервис admin), проверка — функцией can_see().

alter table public.staff_profiles add column if not exists role text not null default 'manager';
alter table public.staff_profiles add column if not exists admin_salons uuid[] not null default '{}';

alter table public.projects add column if not exists manager_id uuid default auth.uid();
alter table public.projects add column if not exists salon_id uuid references public.salons(id) on delete set null;
update public.projects set manager_id = created_by where manager_id is null;
update public.projects p set salon_id = s.salon_id from public.staff_profiles s
  where p.salon_id is null and s.user_id = p.manager_id;
create index if not exists projects_manager_idx on public.projects(manager_id);
create index if not exists projects_salon_idx on public.projects(salon_id);

-- может ли текущий сотрудник видеть проект с таким менеджером и салоном
create or replace function public.can_see(m uuid, s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p.role
      when 'owner' then true
      when 'admin' then m = auth.uid() or (s is not null and s = any(p.admin_salons))
      else m = auth.uid() end
    from public.staff_profiles p where p.user_id = auth.uid()), false)
$$;
revoke all on function public.can_see(uuid, uuid) from public;
grant execute on function public.can_see(uuid, uuid) to authenticated;

-- новый проект: менеджер — тот, кто создал (если не указан), салон — салон менеджера (если не указан);
-- сменили менеджера и не трогали салон — салон берётся от нового менеджера
create or replace function public.projects_fill()
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
  return new;
end $$;
drop trigger if exists projects_fill on public.projects;
create trigger projects_fill before insert or update on public.projects
  for each row execute function public.projects_fill();

drop policy if exists staff_projects on public.projects;
drop policy if exists projects_rw on public.projects;
create policy projects_rw on public.projects for all to authenticated
  using (public.can_see(manager_id, salon_id)) with check (public.can_see(manager_id, salon_id));

drop policy if exists staff_items on public.items;
drop policy if exists items_rw on public.items;
create policy items_rw on public.items for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id))
  with check (exists (select 1 from public.projects p where p.id = project_id));
