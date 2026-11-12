-- Компания дилера у салона (Макс 12.11): ООО / ИП, от которого салон работает с фабрикой.
-- Первое письмо дилера (mail_send) берёт компанию из салона клиента — выбор в письме убран (crm.html).
-- Пишет только сервис admin (как остальные поля салона), читают все вошедшие.
alter table public.salons add column if not exists company text not null default '';

notify pgrst, 'reload schema';
