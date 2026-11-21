// Edge-функция уведомлений.
//
// Режимы вызова:
//   POST /telegram-notifier                      — вебхук из БД (триггеры на events / event_acknowledgements)
//   POST /telegram-notifier {"mode":"digest"}    — утренняя сводка (вызывается pg_cron в 04:30 UTC = 08:30 UTC+4)
//   POST /telegram-notifier {"mode":"reminders"} — напоминания за 15 минут (необязательный cron)
//   POST /telegram-notifier {"mode":"test","chat_id":123} — тестовое сообщение
//
// Авторизация: заголовок x-webhook-secret (значение хранится в Supabase Vault)
// либо Authorization: Bearer <service_role_key>.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildDigestForFamily,
  collectOccurrences,
  escapeHtml,
  formatDateTime,
  formatTime,
  getLinkedFamilies,
  getProfileName,
  localDateKey,
  localRange,
  notifyFamily,
  sendTelegramMessage,
  type EventRow,
} from '../_shared/telegram.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isAuthorized(req: Request): boolean {
  const secret = req.headers.get('x-webhook-secret') ?? ''
  if (WEBHOOK_SECRET && secret === WEBHOOK_SECRET) return true

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return Boolean(SERVICE_KEY && bearer === SERVICE_KEY)
}

function eventCard(title: string, eventTime: string, description?: string | null): string {
  let text = `<b>${escapeHtml(title)}</b>\n📅 ${formatDateTime(eventTime)}`
  if (description) text += `\n\n<i>${escapeHtml(description)}</i>`
  return text
}

function actorLine(verb: string, actor: string | null): string {
  return actor ? `\n👤 ${verb}: ${escapeHtml(actor)}` : ''
}

async function handleEventChange(body: any) {
  const record = body.record
  const oldRecord = body.old_record
  const current = record ?? oldRecord
  if (!current?.family_id) return { ok: true, skipped: 'no family_id' }

  const actorName =
    (await getProfileName(supabase, body.actor_id)) ??
    (record?.created_by ? await getProfileName(supabase, record.created_by) : null) ??
    (oldRecord?.created_by ? await getProfileName(supabase, oldRecord.created_by) : null)

  let text = ''
  let excludeUserId: string | null = body.actor_id ?? null

  if (body.type === 'INSERT') {
    text = `➕ <b>Новое событие</b>\n\n${eventCard(record.title, record.event_time, record.description)}${actorLine('Добавил(а)', actorName)}`
  } else if (body.type === 'DELETE') {
    text = `🗑 <b>Событие удалено</b>\n\n${eventCard(oldRecord.title, oldRecord.event_time)}${actorLine('Удалил(а)', actorName)}`
  } else if (body.type === 'UPDATE') {
    const wasCancelled = oldRecord?.status === 'cancelled'
    const isCancelled = record?.status === 'cancelled'

    if (!wasCancelled && isCancelled) {
      text = `❌ <b>Событие отменено</b>\n\n${eventCard(record.title, record.event_time)}${actorLine('Отменил(а)', actorName)}`
    } else if (wasCancelled && !isCancelled) {
      text = `🔄 <b>Событие восстановлено</b>\n\n${eventCard(record.title, record.event_time)}${actorLine('Вернул(а)', actorName)}`
    } else {
      const changes: string[] = []
      if (record.title !== oldRecord.title) {
        changes.push(`• Название: «${escapeHtml(oldRecord.title)}» → «${escapeHtml(record.title)}»`)
      }
      if (record.event_time !== oldRecord.event_time) {
        changes.push(
          `• Время: ${formatDateTime(oldRecord.event_time)} → ${formatDateTime(record.event_time)}`,
        )
      }
      if ((record.description ?? '') !== (oldRecord.description ?? '')) {
        changes.push('• Описание обновлено')
      }
      if ((record.recurrence_rule ?? '') !== (oldRecord.recurrence_rule ?? '')) {
        changes.push('• Изменено повторение')
      }

      const details = changes.length ? `\n\n${changes.join('\n')}` : ''
      text = `✏️ <b>Событие изменено</b>\n\n${eventCard(record.title, record.event_time, record.description)}${actorLine('Изменил(а)', actorName)}${details}`
    }
  } else {
    return { ok: true, skipped: `unknown type ${body.type}` }
  }

  // Автор действия не получает уведомление о своём же действии.
  if (body.type === 'INSERT') excludeUserId = record.created_by ?? excludeUserId

  const result = await notifyFamily(supabase, BOT_TOKEN, current.family_id, text, excludeUserId)
  return { ok: true, ...result }
}

async function handleAcknowledgement(body: any) {
  const ack = body.record
  if (!ack?.event_id) return { ok: true, skipped: 'no event' }

  const { data: event } = await supabase
    .from('events')
    .select('id, title, event_time, status, family_id')
    .eq('id', ack.event_id)
    .maybeSingle()

  if (!event || event.status !== 'active') return { ok: true, skipped: 'event inactive' }

  const actor = (await getProfileName(supabase, ack.user_id)) ?? 'Кто-то из семьи'
  const text = `✅ <b>${escapeHtml(actor)}</b> выполнил(а) событие\n\n${eventCard(event.title, event.event_time)}`

  const result = await notifyFamily(supabase, BOT_TOKEN, event.family_id, text, ack.user_id)
  return { ok: true, ...result }
}

async function handleWebhook(body: any) {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' }
  if (!body?.table || !body?.type) return { ok: true, skipped: 'empty payload' }

  if (body.table === 'events') return handleEventChange(body)
  if (body.table === 'event_acknowledgements') return handleAcknowledgement(body)
  return { ok: true, skipped: `unsupported table ${body.table}` }
}

async function handleDigest() {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' }

  const range = localRange()
  const families = await getLinkedFamilies(supabase)
  let sent = 0

  for (const familyId of families) {
    const messages = await buildDigestForFamily(supabase, familyId)
    for (const message of messages) {
      const result = await notifyFamily(supabase, BOT_TOKEN, familyId, message)
      sent += result.sent
    }
  }

  return { ok: true, mode: 'digest', date: range.dateKey, families: families.length, sent }
}

async function handleReminders() {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' }

  const now = new Date()
  const windowStart = new Date(now.getTime() + 10 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 20 * 60 * 1000)

  const { data, error } = await supabase
    .from('events')
    .select('id, title, description, event_time, recurrence_rule, status, family_id')
    .eq('status', 'active')
    .lt('event_time', windowEnd.toISOString())
    .or(`recurrence_rule.not.is.null,event_time.gte.${now.toISOString()}`)

  if (error) return { ok: false, error: error.message }

  const occurrences = collectOccurrences((data ?? []) as EventRow[], windowStart, windowEnd)
  let sent = 0
  let skipped = 0

  for (const occurrence of occurrences) {
    const familyId = occurrence.event.family_id
    if (!familyId) continue

    const { error: logError } = await supabase.from('telegram_reminder_log').insert({
      event_id: occurrence.event.id,
      occurrence_date: localDateKey(occurrence.at),
    })

    if (logError) {
      if ((logError as any).code !== '23505') console.error('reminder log:', logError.message)
      skipped++
      continue
    }

    const text = `⏰ <b>Через 15 минут</b>\n\n${eventCard(occurrence.event.title, occurrence.at.toISOString(), occurrence.event.description)}\n\n⏱ Начало в ${formatTime(occurrence.at)}`
    const result = await notifyFamily(supabase, BOT_TOKEN, familyId, text)
    sent += result.sent
  }

  return { ok: true, mode: 'reminders', candidates: occurrences.length, sent, skipped }
}

async function handleTest(body: any) {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' }
  const chatId = body?.chat_id
  if (!chatId) return { ok: false, error: 'chat_id обязателен' }
  const result = await sendTelegramMessage(
    BOT_TOKEN,
    chatId,
    '👋 <b>Тест уведомлений</b>\n\nСемейный календарь на связи. Сводка приходит в 08:30, а изменения — сразу.',
  )
  return { ok: result.ok, ...result }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!isAuthorized(req)) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const mode = body?.mode ?? new URL(req.url).searchParams.get('mode') ?? 'webhook'

  try {
    if (mode === 'digest') return json(await handleDigest())
    if (mode === 'reminders') return json(await handleReminders())
    if (mode === 'test') return json(await handleTest(body))
    return json(await handleWebhook(body))
  } catch (error) {
    console.error('telegram-notifier error:', error)
    return json({ ok: false, error: String(error) }, 500)
  }
})
