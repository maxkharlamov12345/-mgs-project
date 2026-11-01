-- Кабинет фабрики (тест, 01.11). Стороны: «дилер» (мы — салоны, CRM) и «фабрика» (менеджер фабрики).
--   Роль factory (staff_profiles.role) — видит ТОЛЬКО мебельные позиции, отправленные на фабрику, и только через функции ниже:
--   ФИО клиента, наш №, дату оформления, дедлайн, компанию дилера, менеджера дилера с контактами и салон, переписку и вложения.
--   Клиентов, КП, спецификацию, файлы карточки (кроме вложенных в письма) фабрика не видит.
--   position_mails — переписка по позиции «как почта». Первое письмо дилера (label new) отправляет позицию на фабрику:
--     positions.sent_at, этап позиции → 2 «Отправлен», у фабрики — «Новые» (fstage 0).
--   Этапы фабрики positions.fstage: 0 новые → 1 заказ заведён → 2 у технолога → 3 на согласовании у дилера → 4 в производстве.
--     Каждый шаг (и откат «Назад») — письмо с меткой. Переход в 4 ставит позиции этап 3 «Запущен».
--   Метки писем: new, opened, tech, approval, approved, production, back.
--   mail_reads — когда пользователь последний раз открывал переписку позиции (для «непрочитанных»).

-- ---------- роль ----------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff_profiles where user_id = auth.uid()
$$;
create or replace function public.is_factory()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'factory', false)
$$;
revoke all on function public.my_role() from public;
revoke all on function public.is_factory() from public;
grant execute on function public.my_role(), public.is_factory() to authenticated;

-- фабрика не видит проекты и клиентов дилера напрямую
create or replace function public.can_see(m uuid, s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p.role
      when 'owner' then true
      when 'admin' then m = auth.uid() or (s is not null and s = any(p.admin_salons))
      when 'factory' then false
      else m = auth.uid() end
    from public.staff_profiles p where p.user_id = auth.uid()), false)
$$;

-- ---------- позиции: поля фабрики ----------
alter table public.positions add column if not exists deadline  date;
alter table public.positions add column if not exists company   text not null default '';   -- компания дилера (ООО / ИП)
alter table public.positions add column if not exists sent_at   timestamptz;                -- отправлена на фабрику
alter table public.positions add column if not exists fstage    int check (fstage between 0 and 4);
alter table public.positions add column if not exists fstage_at timestamptz;
alter table public.positions add column if not exists f_num     text;                       -- № заказа фабрики
alter table public.positions add column if not exists f_price   numeric;                    -- предварительная стоимость
alter table public.positions add column if not exists f_ready   date;                       -- предварительная дата готовности
create index if not exists positions_sent_idx on public.positions(sent_at) where sent_at is not null;

-- дилер меняет только свои поля позиции; поля фабрики и отправку — только функции ниже
revoke insert, update on public.positions from authenticated;
grant insert (client_id, kind, name, contractor, stage, preview, lines, sort) on public.positions to authenticated;
grant update (client_id, kind, name, contractor, stage, preview, lines, sort) on public.positions to authenticated;

-- ---------- переписка ----------
create table if not exists public.position_mails (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  author_id   uuid default auth.uid(),
  side        text not null check (side in ('dealer','factory')),
  label       text not null default '',
  subject     text not null default '',
  body        text not null default '',
  rows        jsonb not null default '[]',   -- [{"k":"num|price|ready","v":...,"old":...}]
  files       jsonb not null default '[]',   -- [{"name","path","mime","size"}] или [{"name","url"}]
  created_at  timestamptz not null default now()
);
create index if not exists position_mails_pos_idx on public.position_mails(position_id, created_at);
create index if not exists position_mails_side_idx on public.position_mails(side, created_at desc);

create table if not exists public.mail_reads (
  user_id     uuid not null,
  position_id uuid not null references public.positions(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (user_id, position_id)
);
alter table public.position_mails enable row level security;
alter table public.mail_reads enable row level security;
-- прямого доступа нет: только через функции (security definer)
grant all on public.position_mails, public.mail_reads to service_role;

-- чья сторона у текущего пользователя для позиции: dealer / factory / null (нет доступа)
create or replace function public.pos_side(pid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_factory() then
      (select 'factory' from public.positions p where p.id = pid and p.kind = 'furniture' and p.sent_at is not null)
    else
      (select 'dealer' from public.positions p join public.clients c on c.id = p.client_id
        where p.id = pid and public.can_see(c.manager_id, c.salon_id))
  end
$$;
revoke all on function public.pos_side(uuid) from public;
grant execute on function public.pos_side(uuid) to authenticated;

-- карточка заказа (то, что видит фабрика)
create or replace function public.pos_card(pid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'client_name', c.name, 'client_num', c.num,
    'contract_at', coalesce(c.contract_at, p.created_at), 'deadline', p.deadline, 'company', p.company,
    'sent_at', p.sent_at, 'fstage', p.fstage, 'fstage_at', p.fstage_at,
    'f_num', p.f_num, 'f_price', p.f_price, 'f_ready', p.f_ready, 'stage', p.stage,
    'manager', jsonb_build_object('name', coalesce(nullif(sp.name, ''), u.email::text, ''), 'phone', coalesce(sp.phone, ''),
                                  'email', coalesce(u.email::text, ''), 'photo', sp.photo),
    'salon', coalesce(s.name, ''),
    'unread', (select count(*) from public.position_mails m
                where m.position_id = p.id and m.side <> case when public.is_factory() then 'factory' else 'dealer' end
                  and m.created_at > coalesce((select r.read_at from public.mail_reads r
                                               where r.user_id = auth.uid() and r.position_id = p.id), '-infinity'))
  )
  from public.positions p
  join public.clients c on c.id = p.client_id
  left join public.staff_profiles sp on sp.user_id = c.manager_id
  left join auth.users u on u.id = c.manager_id
  left join public.salons s on s.id = c.salon_id
  where p.id = pid
$$;
revoke all on function public.pos_card(uuid) from public;

-- список заказов фабрики
create or replace function public.factory_orders()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_factory() then coalesce((
    select jsonb_agg(public.pos_card(p.id) order by p.fstage_at desc nulls last)
    from public.positions p where p.kind = 'furniture' and p.sent_at is not null), '[]'::jsonb)
  else '[]'::jsonb end
$$;
revoke all on function public.factory_orders() from public;
grant execute on function public.factory_orders() to authenticated;

-- реестр писем дилера (для «Сообщений» фабрики)
create or replace function public.factory_inbox()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_factory() then coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('id', m.id, 'position_id', m.position_id, 'label', m.label, 'subject', m.subject,
        'body', left(m.body, 300), 'files', jsonb_array_length(m.files), 'created_at', m.created_at,
        'author', coalesce(nullif(sp.name, ''), 'Дилер'), 'name', p.name, 'client_name', c.name, 'client_num', c.num,
        'company', p.company,
        'unread', m.created_at > coalesce((select r.read_at from public.mail_reads r
                                          where r.user_id = auth.uid() and r.position_id = p.id), '-infinity')) x
      from public.position_mails m
      join public.positions p on p.id = m.position_id and p.kind = 'furniture' and p.sent_at is not null
      join public.clients c on c.id = p.client_id
      left join public.staff_profiles sp on sp.user_id = m.author_id
      where m.side = 'dealer'
      order by m.created_at desc limit 300) t), '[]'::jsonb)
  else '[]'::jsonb end
$$;
revoke all on function public.factory_inbox() from public;
grant execute on function public.factory_inbox() to authenticated;

-- непрочитанные у дилера: {position_id: число}
create or replace function public.dealer_unread()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(position_id, n), '{}'::jsonb) from (
    select m.position_id, count(*) n
    from public.position_mails m
    join public.positions p on p.id = m.position_id
    join public.clients c on c.id = p.client_id
    where m.side = 'factory' and not public.is_factory() and public.can_see(c.manager_id, c.salon_id)
      and m.created_at > coalesce((select r.read_at from public.mail_reads r
                                   where r.user_id = auth.uid() and r.position_id = p.id), '-infinity')
    group by m.position_id) t
$$;
revoke all on function public.dealer_unread() from public;
grant execute on function public.dealer_unread() to authenticated;

-- переписка позиции (и отметка «прочитано»)
create or replace function public.mail_list(pid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare side text := public.pos_side(pid); res jsonb;
begin
  if side is null then raise exception 'Нет доступа к позиции' using errcode = '42501'; end if;
  res := jsonb_build_object('side', side, 'pos', public.pos_card(pid), 'mails', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'side', m.side, 'label', m.label, 'subject', m.subject, 'body', m.body,
      'rows', m.rows, 'files', m.files, 'created_at', m.created_at,
      'author', coalesce(nullif(sp.name, ''), u.email::text, case m.side when 'dealer' then 'Дилер' else 'Фабрика' end))
      order by m.created_at)
    from public.position_mails m
    left join public.staff_profiles sp on sp.user_id = m.author_id
    left join auth.users u on u.id = m.author_id
    where m.position_id = pid), '[]'::jsonb));
  insert into public.mail_reads(user_id, position_id, read_at) values (auth.uid(), pid, now())
    on conflict (user_id, position_id) do update set read_at = now();
  return res;
end $$;
revoke all on function public.mail_list(uuid) from public;
grant execute on function public.mail_list(uuid) to authenticated;

-- вложения: свои пути (папка клиента или mail/<позиция>/) или ссылки
create or replace function public.mail_files_ok(pid uuid, files jsonb, side text)
returns boolean language sql stable security definer set search_path = public as $$
  select jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 30 and not exists (
    select 1 from jsonb_array_elements(files) f
    where coalesce(f->>'name', '') = ''
       or not (
         (f ? 'url' and not f ? 'path' and (f->>'url') ~* '^https?://')
         or (f ? 'path' and (
              (f->>'path') like 'mail/' || pid::text || '/%'
              or (side = 'dealer' and (f->>'path') like
                    (select p.client_id::text from public.positions p where p.id = pid) || '/%')))))
$$;
revoke all on function public.mail_files_ok(uuid, jsonb, text) from public;

create or replace function public.mail_add(pid uuid, s text, lbl text, subj text, txt text, r jsonb, f jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.position_mails;
begin
  insert into public.position_mails(position_id, author_id, side, label, subject, body, rows, files)
    values (pid, auth.uid(), s, coalesce(lbl, ''), left(coalesce(subj, ''), 300), left(coalesce(txt, ''), 20000),
            coalesce(r, '[]'::jsonb), coalesce(f, '[]'::jsonb))
    returning * into m;
  insert into public.mail_reads(user_id, position_id, read_at) values (auth.uid(), pid, now())
    on conflict (user_id, position_id) do update set read_at = now();
  return to_jsonb(m);
end $$;
revoke all on function public.mail_add(uuid, text, text, text, text, jsonb, jsonb) from public;

-- письмо (обе стороны). Первое письмо дилера отправляет позицию на фабрику: нужны дедлайн и компания.
create or replace function public.mail_send(pid uuid, p_subject text, p_body text, p_files jsonb default '[]',
                                            p_deadline date default null, p_company text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare side text := public.pos_side(pid); p public.positions; lbl text := '';
begin
  if side is null then raise exception 'Нет доступа к позиции' using errcode = '42501'; end if;
  if coalesce(trim(p_body), '') = '' and coalesce(jsonb_array_length(p_files), 0) = 0 then
    raise exception 'Пустое письмо'; end if;
  if not public.mail_files_ok(pid, coalesce(p_files, '[]'::jsonb), side) then raise exception 'Недопустимое вложение'; end if;
  select * into p from public.positions where id = pid for update;
  if side = 'dealer' and p.sent_at is null then
    if p.kind <> 'furniture' then raise exception 'На фабрику отправляется только мебель'; end if;
    if p_deadline is null then raise exception 'Укажите дедлайн'; end if;
    if coalesce(trim(p_company), '') = '' then raise exception 'Укажите компанию дилера'; end if;
    update public.positions set sent_at = now(), fstage = 0, fstage_at = now(), deadline = p_deadline,
      company = trim(p_company), stage = greatest(stage, 2) where id = pid;
    lbl := 'new';
  end if;
  return public.mail_add(pid, side, lbl, coalesce(nullif(trim(p_subject), ''), case when lbl = 'new' then 'Новый заказ' else '' end),
                         p_body, '[]'::jsonb, p_files);
end $$;
revoke all on function public.mail_send(uuid, text, text, jsonb, date, text) from public;
grant execute on function public.mail_send(uuid, text, text, jsonb, date, text) to authenticated;

-- дилер согласовывает проект (только когда позиция у него на согласовании)
create or replace function public.mail_approve(pid uuid, p_body text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.positions;
begin
  if public.pos_side(pid) is distinct from 'dealer' then raise exception 'Нет доступа к позиции' using errcode = '42501'; end if;
  select * into p from public.positions where id = pid for update;
  if p.fstage is distinct from 3 then raise exception 'Проект сейчас не на согласовании'; end if;
  if exists (select 1 from public.position_mails m where m.position_id = pid and m.label = 'approved'
              and m.created_at > (select max(created_at) from public.position_mails where position_id = pid and label = 'approval')) then
    raise exception 'Уже согласовано'; end if;
  return public.mail_add(pid, 'dealer', 'approved', 'Проект согласован', p_body, '[]'::jsonb, '[]'::jsonb);
end $$;
revoke all on function public.mail_approve(uuid, text) from public;
grant execute on function public.mail_approve(uuid, text) to authenticated;

-- шаг фабрики: dir = 1 вперёд (с данными заказа), -1 назад. Каждый шаг — письмо дилеру.
create or replace function public.factory_step(pid uuid, dir int, p_num text default null, p_price numeric default null,
                                               p_ready date default null, p_body text default '', p_files jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.positions; k int; nk int; lbl text; subj text; r jsonb := '[]'::jsonb;
  n_num text; n_price numeric; n_ready date;
  names text[] := array['Новые', 'Заказ заведён', 'У технолога', 'На согласовании у дилера', 'В производстве'];
begin
  if public.pos_side(pid) is distinct from 'factory' then raise exception 'Нет доступа к заказу' using errcode = '42501'; end if;
  select * into p from public.positions where id = pid for update;
  k := coalesce(p.fstage, 0);
  if dir = -1 then
    if k = 0 then raise exception 'Это первый шаг'; end if;
    nk := k - 1;
    update public.positions set fstage = nk, fstage_at = now(),
      stage = case when k = 4 and stage = 3 then 2 else stage end where id = pid;
    return public.mail_add(pid, 'factory', 'back', 'Возвращено на шаг «' || names[nk + 1] || '»', '', '[]'::jsonb, '[]'::jsonb);
  end if;
  if dir <> 1 then raise exception 'Неверный шаг'; end if;
  if k >= 4 then raise exception 'Заказ уже в производстве'; end if;
  n_num := coalesce(nullif(trim(p_num), ''), p.f_num);
  n_price := coalesce(p_price, p.f_price);
  n_ready := coalesce(p_ready, p.f_ready);
  if k = 0 and (n_num is null or n_price is null) then raise exception 'Укажите № заказа фабрики и предварительную стоимость'; end if;
  if k = 2 and coalesce(trim(p_body), '') = '' and coalesce(jsonb_array_length(p_files), 0) = 0 then
    raise exception 'Приложите проект или напишите комментарий'; end if;
  if not public.mail_files_ok(pid, coalesce(p_files, '[]'::jsonb), 'factory') then raise exception 'Недопустимое вложение'; end if;
  nk := k + 1;
  lbl := (array['opened', 'tech', 'approval', 'production'])[nk];
  subj := (array['Заказ заведён', 'Передан технологу', 'Проект на согласование', 'Передан в производство'])[nk];
  r := jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('k', 'num', 'v', n_num, 'old', case when p.f_num is distinct from n_num then p.f_num end)),
    jsonb_strip_nulls(jsonb_build_object('k', 'price', 'v', n_price, 'old', case when p.f_price is distinct from n_price then p.f_price end)),
    jsonb_strip_nulls(jsonb_build_object('k', 'ready', 'v', n_ready, 'old', case when p.f_ready is distinct from n_ready then p.f_ready end)));
  update public.positions set fstage = nk, fstage_at = now(), f_num = n_num, f_price = n_price, f_ready = n_ready,
    stage = case when nk = 4 then greatest(stage, 3) else stage end where id = pid;
  return public.mail_add(pid, 'factory', lbl, subj, case when k = 2 then p_body else '' end, r,
                         case when k = 2 then p_files else '[]'::jsonb end);
end $$;
revoke all on function public.factory_step(uuid, int, text, numeric, date, text, jsonb) from public;
grant execute on function public.factory_step(uuid, int, text, numeric, date, text, jsonb) to authenticated;

-- ---------- файлы: папка mail/<позиция>/ для обеих сторон; фабрике — ещё файлы карточки, вложенные в письма ----------
create or replace function public.crm_can(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when split_part(path, '/', 1) = 'mail' then
      split_part(path, '/', 2) ~ '^[0-9a-f-]{36}$' and public.pos_side(split_part(path, '/', 2)::uuid) is not null
    else exists (select 1 from public.clients c
                 where c.id::text = split_part(path, '/', 1) and public.can_see(c.manager_id, c.salon_id))
  end
$$;
create or replace function public.crm_read(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_can(path) or (public.is_factory() and exists (
    select 1 from public.position_mails m join public.positions p on p.id = m.position_id
    where p.sent_at is not null and p.kind = 'furniture'
      and m.files @> jsonb_build_array(jsonb_build_object('path', path))))
$$;
revoke all on function public.crm_read(text) from public;
grant execute on function public.crm_read(text) to authenticated;
drop policy if exists crm_select on storage.objects;
create policy crm_select on storage.objects for select to authenticated using (bucket_id = 'crm' and public.crm_read(name));

notify pgrst, 'reload schema';
