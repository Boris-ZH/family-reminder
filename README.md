# Семейный календарь

Небольшое семейное приложение-напоминалка на Next.js + Supabase: общий календарь
семьи, повторяющиеся события, отметки «выполнено» и уведомления в Telegram.

- **Приложение:** Next.js 16 (App Router), React 19, Tailwind CSS 4.
- **База и авторизация:** Supabase (Postgres + Auth + RLS).
- **Уведомления:** Telegram-бот [@Wild_Zhoponogis_bot](https://t.me/Wild_Zhoponogis_bot)
  через edge-функции Supabase.

## Быстрый старт

```bash
npm install
npm run dev
```

Создайте `.env.local` (в репозиторий не попадает):

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>
```

## Telegram-уведомления

### Что приходит

| Когда | Кому | Что |
| --- | --- | --- |
| Каждый день в **08:30 UTC+4** | всем участникам семьи с привязанным Telegram | сводка событий на текущий день (с учётом повторяющихся) |
| Событие создано | всем, кроме автора | «➕ Новое событие» с датой, временем и описанием |
| Событие изменено | всем, кроме автора | «✏️ Событие изменено» + что именно поменялось |
| Событие отменено / восстановлено | всем, кроме автора | «❌ Отменено» / «🔄 Восстановлено» |
| Событие удалено | всем, кроме автора | «🗑 Событие удалено» |
| Кто-то отметил событие выполненным | всем, кроме отметившего | «✅ Имя выполнил(а) событие» |

Пустая сводка тоже отправляется («Событий нет»), чтобы было понятно, что бот жив.
Напоминание «за 15 минут» в коде есть, но по умолчанию **выключено** — см. ниже.

### Как это устроено

```
Next.js (приложение)
   │  привязка чата: код → deep link t.me/<бот>?start=<код>
   ▼
profiles.telegram_chat_id
   ▲
   │  INSERT/UPDATE/DELETE
events, event_acknowledgements ──trigger──► pg_net ──► edge-функция telegram-notifier ──► Telegram Bot API
   ▲
   │  pg_cron 04:30 UTC (08:30 UTC+4)
   └──────────────────────────────────────► telegram-notifier {"mode":"digest"}
```

- Привязка: в приложении генерируется одноразовый код на 15 минут, бот получает
  `/start <код>` и сохраняет `chat_id` в профиль.
- Триггеры БД шлют вебхук только при значимых изменениях (правка пустого поля не
  спамит), автор действия уведомление о своём же действии не получает.
- Если пользователь заблокировал бота (403), привязка автоматически снимается.
- Общий пароль между БД и функцией лежит в Supabase Vault
  (`telegram_webhook_secret`), в коде его нет.

### Установка

1. **Секреты функций.** `TELEGRAM_BOT_TOKEN` — токен из @BotFather,
   `WEBHOOK_SECRET` — любая длинная случайная строка (например, `openssl rand -hex 32`).

   ```bash
   supabase secrets set \
     TELEGRAM_BOT_TOKEN=123456:AA... \
     WEBHOOK_SECRET=<случайная строка>
   ```

2. **Тот же секрет в Vault** (иначе триггеры не смогут авторизоваться):

   ```sql
   select vault.create_secret('<та же случайная строка>', 'telegram_webhook_secret');
   -- если секрет уже есть:
   -- select vault.update_secret((select id from vault.secrets where name='telegram_webhook_secret'), '<новая строка>');
   ```

3. **Миграция.** Примените `supabase/migrations/20261122120000_telegram_notifications.sql`
   (`supabase db push` или вставьте в SQL Editor). Она добавит поля в `profiles`,
   таблицу `telegram_reminder_log`, включит `pg_net`/`pg_cron`, создаст триггеры
   и задачу `telegram-morning-digest`.

4. **Функции.**

   ```bash
   supabase functions deploy telegram-bot-handler --project-ref <ref>
   supabase functions deploy telegram-notifier --project-ref <ref>
   ```

5. **Webhook бота.**

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://<ref>.supabase.co/functions/v1/telegram-bot-handler" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```

6. **Проверка.** Отправьте себе тестовое сообщение (нужен свой `chat_id`):

   ```bash
   curl -X POST "https://<ref>.supabase.co/functions/v1/telegram-notifier" \
     -H "x-webhook-secret: $WEBHOOK_SECRET" \
     -H "content-type: application/json" \
     -d '{"mode":"test","chat_id":123456789}'
   ```

   И проверить сводку вручную: `{"mode":"digest"}`.

### Напоминание за 15 минут (опционально)

Раскомментируйте вызов `cron.schedule('telegram-reminders', '*/5 * * * *', ...)`
в конце миграции. Дубли исключает таблица `telegram_reminder_log`
(уникальность `event_id + дата`).

### Часовой пояс

Всё считается в UTC+4 (`Europe/Saratov`, без перехода на летнее время) —
константа `LOCAL_OFFSET_MINUTES` в `supabase/functions/_shared/telegram.ts`.
Cron-выражение `30 4 * * *` задано в UTC: 04:30 UTC = 08:30 UTC+4.
Если БД переедет в другой пояс, поправьте и cron.

### Если нужно отключить

- Пользователь: кнопка «Отключить уведомления» в приложении или `/stop` в боте.
- Все сразу: `select cron.unschedule('telegram-morning-digest');` и
  `drop trigger telegram_events_notify on public.events;`
  (аналогично для `telegram_acknowledgements_notify`).

## Структура

```
app/                      страницы Next.js (auth, onboarding, dashboard)
lib/                      клиент Supabase, звуки
supabase/
  config.toml             verify_jwt=false для функций бота и уведомлений
  migrations/             SQL-миграции
  functions/
    _shared/telegram.ts   форматирование, сводка, отправка сообщений
    telegram-bot-handler/ команды бота: /start /today /stop /help
    telegram-notifier/    вебхуки из БД, дайджест, напоминания
    telegram-proxy/       необязательная прослойка для webhook
```

## Безопасность

- `.env*` и `supabase/.temp/` в `.gitignore`.
- Токен бота и `service_role` живут только в secrets Supabase, не в коде.
- Edge-функция уведомлений не принимает запросы без `x-webhook-secret` или
  `service_role`-токена; бот отвечает только на сообщения Telegram.
