// Общие утилиты для Telegram-функций.
// Часовой пояс семьи — UTC+4 (Europe/Saratov, перехода на летнее время нет).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const LOCAL_OFFSET_MINUTES = 240
const OFFSET_MS = LOCAL_OFFSET_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const WEEKDAYS = [
  'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота',
]

export type EventRow = {
  id: string
  title: string
  description: string | null
  event_time: string
  recurrence_rule: string | null
  status: string
  family_id?: string
  event_acknowledgements?: Array<{
    is_completed: boolean
    profiles?: { full_name: string } | Array<{ full_name: string }> | null
  }> | null
}

export type Occurrence = { event: EventRow; at: Date }

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Сдвигаем момент времени в «локальные» UTC+4 и дальше читаем UTC-поля. */
function shift(iso: string | Date): Date {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return new Date(date.getTime() + OFFSET_MS)
}

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatTimeShifted(date: Date): string {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function formatDateShifted(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()]}`
}

export function formatTime(iso: string | Date): string {
  return formatTimeShifted(shift(iso))
}

export function formatDate(iso: string | Date): string {
  return formatDateShifted(shift(iso))
}

export function formatDateTime(iso: string | Date): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`
}

export function formatWeekday(iso: string | Date): string {
  return WEEKDAYS[shift(iso).getUTCDay()]
}

/** Календарная дата в UTC+4 в формате YYYY-MM-DD. */
export function localDateKey(iso: string | Date): string {
  return shift(iso).toISOString().slice(0, 10)
}

export type LocalRange = { start: Date; end: Date; dateKey: string; label: string }

/** Границы «сегодня» в UTC+4, выраженные в абсолютном времени. */
export function localRange(now: Date = new Date()): LocalRange {
  const local = shift(now)
  const startMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MS
  return {
    start: new Date(startMs),
    end: new Date(startMs + DAY_MS),
    dateKey: local.toISOString().slice(0, 10),
    label: formatDateShifted(local),
  }
}

/** Момент N-го месяца от базового события с «мягким» переносом конца месяца. */
function monthOccurrence(base: Date, months: number): number {
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(base.getUTCDate(), lastDay), base.getUTCHours(), base.getUTCMinutes())
}

/** Разворачивает повторяющиеся события в конкретные вхождения внутри [start, end). */
export function collectOccurrences(events: EventRow[], start: Date, end: Date): Occurrence[] {
  const result: Occurrence[] = []
  const startMs = start.getTime()
  const endMs = end.getTime()

  for (const event of events) {
    if (event.status !== 'active') continue

    const baseMs = new Date(event.event_time).getTime()
    if (!Number.isFinite(baseMs)) continue

    const rule = (event.recurrence_rule || '').toLowerCase()
    if (!rule || rule === 'none') {
      if (baseMs >= startMs && baseMs < endMs) result.push({ event, at: new Date(baseMs) })
      continue
    }
    if (baseMs >= endMs) continue

    const baseLocal = baseMs + OFFSET_MS
    const startLocal = startMs + OFFSET_MS
    const endLocal = endMs + OFFSET_MS

    if (rule === 'daily' || rule === 'weekly') {
      const step = rule === 'weekly' ? 7 * DAY_MS : DAY_MS
      let index = Math.floor((startLocal - baseLocal) / step)
      if (index < 0) index = 0
      let moment = baseLocal + index * step
      while (moment < startLocal) moment += step
      while (moment < endLocal) {
        result.push({ event, at: new Date(moment - OFFSET_MS) })
        moment += step
      }
    } else if (rule === 'monthly') {
      const base = new Date(baseLocal)
      const localStart = new Date(startLocal)
      let index =
        (localStart.getUTCFullYear() - base.getUTCFullYear()) * 12 +
        (localStart.getUTCMonth() - base.getUTCMonth())
      if (index < 0) index = 0
      for (let i = index; i < index + 400; i++) {
        const moment = monthOccurrence(base, i)
        if (moment >= endLocal) break
        if (moment >= startLocal) result.push({ event, at: new Date(moment - OFFSET_MS) })
      }
    }
  }

  return result.sort((a, b) => a.at.getTime() - b.at.getTime())
}

function acknowledgementName(
  profile: { full_name: string } | Array<{ full_name: string }> | null | undefined,
): string | null {
  if (!profile) return null
  if (Array.isArray(profile)) return profile[0]?.full_name ?? null
  return profile.full_name ?? null
}

export function completedByNames(event: EventRow): string[] {
  return (event.event_acknowledgements ?? [])
    .filter((ack) => ack.is_completed)
    .map((ack) => acknowledgementName(ack.profiles))
    .filter((name): name is string => Boolean(name))
}

export function formatDigestTime(occurrence: Occurrence): string {
  return formatTimeShifted(shift(occurrence.at))
}

const MAX_MESSAGE_LENGTH = 3500

function chunkMessages(header: string, lines: string[]): string[] {
  const prefix = `${header}\n\n`
  const parts: string[] = []
  let buffer = ''
  for (const line of lines) {
    if (buffer && prefix.length + buffer.length + line.length + 2 > MAX_MESSAGE_LENGTH) {
      parts.push(prefix + buffer)
      buffer = ''
    }
    buffer += (buffer ? '\n' : '') + line
  }
  if (buffer) parts.push(prefix + buffer)
  return parts.length ? parts : [header]
}

/** Готовые сообщения утренней сводки (одно или несколько, если список длинный). */
export function buildDigestMessages(occurrences: Occurrence[], label: string): string[] {
  const header = `☀️ <b>Доброе утро!</b>\nСобытия на ${label}:`
  if (!occurrences.length) {
    return [`${header}\n\nСобытий нет — свободный день 🙂`]
  }

  const lines = occurrences.map((occurrence) => {
    const time = formatDigestTime(occurrence)
    let line = `• <b>${time}</b> — ${escapeHtml(occurrence.event.title)}`
    const done = completedByNames(occurrence.event)
    if (done.length) line += ` ✅ ${escapeHtml(done.join(', '))}`
    if (occurrence.event.description) {
      line += `\n   <i>${escapeHtml(occurrence.event.description)}</i>`
    }
    return line
  })

  const parts = chunkMessages(header, lines)
  if (parts.length > 1) {
    return parts.map((part, index) =>
      index === 0 ? part : part.replace(header, `${header} (продолжение)`),
    )
  }
  return parts
}

export type SendResult = { ok: boolean; status: number; description?: string }

export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  html: string,
): Promise<SendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const post = (payload: Record<string, unknown>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

  let response = await post({
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  let data: any = null
  try {
    data = await response.json()
  } catch {
    // тело ответа может быть пустым
  }

  // Если Telegram не смог разобрать HTML — отправляем тот же текст без разметки.
  if (response.status === 400 && data?.ok === false) {
    const plain = html
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    response = await post({ chat_id: chatId, text: plain, disable_web_page_preview: true })
    try {
      data = await response.json()
    } catch {
      data = null
    }
  }

  return {
    ok: response.ok && data?.ok !== false,
    status: response.status,
    description: data?.description,
  }
}

type Recipient = { id: string; full_name: string | null; telegram_chat_id: number | string }

export async function getFamilyRecipients(
  supabase: SupabaseClient,
  familyId: string,
  excludeUserId?: string | null,
): Promise<Recipient[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, telegram_chat_id')
    .eq('family_id', familyId)
    .not('telegram_chat_id', 'is', null)

  if (error) {
    console.error('Не удалось получить получателей:', error.message)
    return []
  }

  return (data ?? []).filter((row: any) => row.id !== excludeUserId)
}

/** Отправляет одно и то же сообщение всем привязанным участникам семьи. */
export async function notifyFamily(
  supabase: SupabaseClient,
  botToken: string,
  familyId: string,
  html: string,
  excludeUserId?: string | null,
): Promise<{ sent: number; total: number }> {
  const recipients = await getFamilyRecipients(supabase, familyId, excludeUserId)
  let sent = 0

  for (const recipient of recipients) {
    const result = await sendTelegramMessage(botToken, recipient.telegram_chat_id, html)
    if (result.ok) {
      sent++
      continue
    }
    // Бот заблокирован или чат удалён — снимаем привязку, чтобы не копить ошибки.
    if (result.status === 403) {
      await supabase
        .from('profiles')
        .update({ telegram_chat_id: null, telegram_username: null })
        .eq('id', recipient.id)
    } else {
      console.error('Telegram send failed:', recipient.id, result.status, result.description)
    }
  }

  return { sent, total: recipients.length }
}

export async function getProfileName(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name ?? null
}

/** Собирает события семьи на сегодня (с разворотом повторов) и готовые сообщения. */
export async function buildDigestForFamily(
  supabase: SupabaseClient,
  familyId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const range = localRange(now)
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, title, description, event_time, recurrence_rule, status, event_acknowledgements(is_completed, profiles(full_name))',
    )
    .eq('family_id', familyId)
    .lt('event_time', range.end.toISOString())
    .or(`recurrence_rule.not.is.null,event_time.gte.${range.start.toISOString()}`)
    .order('event_time', { ascending: true })

  if (error) {
    console.error('Не удалось загрузить события семьи:', familyId, error.message)
    return [`⚠️ Не удалось собрать события на ${range.label}. Попробуйте позже.`]
  }

  const occurrences = collectOccurrences((data ?? []) as EventRow[], range.start, range.end)
  return buildDigestMessages(occurrences, range.label)
}

/** Семьи, у которых есть хотя бы один привязанный к Telegram участник. */
export async function getLinkedFamilies(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('family_id')
    .not('family_id', 'is', null)
    .not('telegram_chat_id', 'is', null)

  if (error) {
    console.error('Не удалось получить семьи для рассылки:', error.message)
    return []
  }

  return Array.from(new Set((data ?? []).map((row: any) => row.family_id as string)))
}
