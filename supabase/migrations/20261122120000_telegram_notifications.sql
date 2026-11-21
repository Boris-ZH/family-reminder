-- =============================================================================
-- Telegram-уведомления семейного календаря
--
-- 1. Поля привязки Telegram-чата в profiles.
-- 2. Триггеры на events / event_acknowledgements, которые через pg_net дергают
--    edge-функцию telegram-notifier.
-- 3. Задача pg_cron: утренняя сводка в 08:30 UTC+4 (04:30 UTC).
--
-- Перед применением (или сразу после) создайте секрет в Vault:
--   select vault.create_secret('<тот же WEBHOOK_SECRET, что в secrets функций>',
--                              'telegram_webhook_secret');
-- Edge-функция и триггеры используют его как общий пароль.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Профили: привязка Telegram
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists telegram_chat_id bigint,
  add column if not exists telegram_username text,
  add column if not exists telegram_link_code text,
  add column if not exists telegram_link_code_expires_at timestamptz;

comment on column public.profiles.telegram_chat_id is 'Telegram chat_id для уведомлений (null — уведомления не приходят)';
comment on column public.profiles.telegram_username is 'Telegram username, сохранённый при привязке';
comment on column public.profiles.telegram_link_code is 'Одноразовый код привязки из приложения (deep link t.me/<бот>?start=<код>)';
comment on column public.profiles.telegram_link_code_expires_at is 'Срок действия кода привязки';

create unique index if not exists profiles_telegram_link_code_key
  on public.profiles (telegram_link_code)
  where telegram_link_code is not null;

create index if not exists profiles_telegram_chat_id_idx
  on public.profiles (telegram_chat_id)
  where telegram_chat_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Журнал напоминаний «за 15 минут» (защита от дублей при cron каждые 5 минут)
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_reminder_log (
  id bigserial primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  occurrence_date date not null,
  created_at timestamptz not null default now(),
  unique (event_id, occurrence_date)
);

alter table public.telegram_reminder_log enable row level security;
-- Политик нет: таблица доступна только service_role (edge-функции).

comment on table public.telegram_reminder_log is 'Отправленные напоминания, чтобы cron не дублировал сообщения';

-- -----------------------------------------------------------------------------
-- 3. Расширения: pg_net (HTTP из БД) и pg_cron (расписание)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      execute 'create extension pg_net with schema net';
    exception when others then
      begin
        execute 'create extension pg_net';
      exception when others then
        raise warning 'pg_net не удалось включить автоматически: %', sqlerrm;
      end;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute 'create extension pg_cron';
    exception when others then
      raise warning 'pg_cron не удалось включить автоматически: %', sqlerrm;
    end;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Триггерная функция: отправляет событие в telegram-notifier
-- -----------------------------------------------------------------------------
create or replace function public.telegram_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url constant text := 'https://dezjzgiheinlzhmvvsao.supabase.co/functions/v1/telegram-notifier';
  v_payload jsonb;
begin
  -- Секрет живёт в Vault, чтобы не держать его в коде и в БД открытым текстом.
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v_secret
      using 'telegram_webhook_secret';
  exception when others then
    v_secret := null;
  end;

  if v_secret is null then
    raise warning 'telegram_webhook_secret не найден в Vault — уведомление не отправлено';
    return null;
  end if;

  if tg_table_name = 'events' then
    -- Редактирование без значимых изменений не должно спамить семью.
    if tg_op = 'UPDATE' and not (
      new.title is distinct from old.title
      or new.event_time is distinct from old.event_time
      or new.description is distinct from old.description
      or new.status is distinct from old.status
      or new.recurrence_rule is distinct from old.recurrence_rule
    ) then
      return new;
    end if;

    if tg_op = 'INSERT' then
      v_payload := jsonb_build_object(
        'type', 'INSERT',
        'table', 'events',
        'record', to_jsonb(new),
        'old_record', null,
        'actor_id', auth.uid()
      );
    elsif tg_op = 'DELETE' then
      v_payload := jsonb_build_object(
        'type', 'DELETE',
        'table', 'events',
        'record', null,
        'old_record', to_jsonb(old),
        'actor_id', auth.uid()
      );
    else
      v_payload := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'events',
        'record', to_jsonb(new),
        'old_record', to_jsonb(old),
        'actor_id', auth.uid()
      );
    end if;

  elsif tg_table_name = 'event_acknowledgements' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    -- Интересует только переход в «выполнено».
    if not coalesce(new.is_completed, false) then
      return new;
    end if;
    if tg_op = 'UPDATE' and coalesce(old.is_completed, false) then
      return new;
    end if;

    v_payload := jsonb_build_object(
      'type', tg_op,
      'table', 'event_acknowledgements',
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
      'actor_id', coalesce(auth.uid(), new.user_id)
    );
  else
    return null;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := v_payload,
    timeout_milliseconds := 10000
  );

  return null;
end;
$$;

comment on function public.telegram_notify() is 'Отправляет изменения событий в edge-функцию telegram-notifier';

drop trigger if exists telegram_events_notify on public.events;
create trigger telegram_events_notify
  after insert or update or delete on public.events
  for each row execute function public.telegram_notify();

drop trigger if exists telegram_acknowledgements_notify on public.event_acknowledgements;
create trigger telegram_acknowledgements_notify
  after insert or update on public.event_acknowledgements
  for each row execute function public.telegram_notify();

-- -----------------------------------------------------------------------------
-- 5. Утренний дайджест: 08:30 UTC+4 = 04:30 UTC
-- -----------------------------------------------------------------------------
do $$
declare
  v_job record;
  v_command text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron не включён — создайте расписание дайджеста вручную (Supabase Cron)';
    return;
  end if;

  for v_job in select jobid from cron.job where jobname = 'telegram-morning-digest' loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  v_command := $cron$
    select net.http_post(
      url := 'https://dezjzgiheinlzhmvvsao.supabase.co/functions/v1/telegram-notifier',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret' limit 1)
      ),
      body := '{"mode":"digest"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$;

  perform cron.schedule('telegram-morning-digest', '30 4 * * *', v_command);
end $$;

-- Необязательное напоминание за 15 минут (поставьте, если нужно):
--   select cron.schedule('telegram-reminders', '*/5 * * * *', $cron$
--     select net.http_post(
--       url := 'https://dezjzgiheinlzhmvvsao.supabase.co/functions/v1/telegram-notifier',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-webhook-secret',
--         (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret' limit 1)
--       ),
--       body := '{"mode":"reminders"}'::jsonb,
--       timeout_milliseconds := 60000
--     );
--   $cron$);

commit;
