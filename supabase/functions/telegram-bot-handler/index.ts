// Telegram-бот семейного календаря.
//
// Команды:
//   /start <код>  — привязка чата к профилю (код генерируется в приложении)
//   /start <uuid> — привязка по id пользователя (обратная совместимость)
//   /today        — события на сегодня
//   /stop         — отключить уведомления
//   /help         — справка
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildDigestForFamily, escapeHtml, sendTelegramMessage } from '../_shared/telegram.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HELP_TEXT =
  'Я бот семейного календаря.\n\n' +
  '/today — события на сегодня\n' +
  '/stop — отключить уведомления\n' +
  '/help — эта справка\n\n' +
  'Чтобы подключить уведомления, откройте приложение и нажмите «Подключить Telegram».'

async function reply(chatId: number | string, html: string) {
  if (!BOT_TOKEN) return
  await sendTelegramMessage(BOT_TOKEN, chatId, html)
}

async function linkChat(chatId: number, username: string | null, payload: string) {
  const code = payload.trim().toLowerCase()

  if (!code) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('full_name, family_id')
      .eq('telegram_chat_id', chatId)
      .maybeSingle()

    if (existing) {
      await reply(
        chatId,
        `Вы уже подключены${existing.full_name ? `, ${escapeHtml(existing.full_name)}` : ''}. ` +
          'Сводка приходит каждое утро в 08:30.\n\n/today — события на сегодня\n/stop — отключить',
      )
      return
    }

    await reply(
      chatId,
      'Привет! Чтобы получать уведомления семьи, откройте приложение и нажмите «Подключить Telegram» — ' +
        'я пришлю подтверждение автоматически.\n\n' +
        'Если у вас есть код привязки, отправьте: <code>/start код</code>',
    )
    return
  }

  // Принимаем и короткий код из приложения, и старый вариант с uuid пользователя.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, family_id, telegram_link_code_expires_at, families(name)')
    .eq(isUuid(code) ? 'id' : 'telegram_link_code', code)
    .maybeSingle()

  if (error) {
    console.error('link lookup failed:', error.message)
    await reply(chatId, 'Не удалось проверить код. Попробуйте ещё раз через минуту.')
    return
  }

  if (!profile) {
    await reply(
      chatId,
      'Код не найден. Сгенерируйте новый в приложении: «Подключить Telegram».\n\nКод действует 15 минут.',
    )
    return
  }

  if (
    !isUuid(code) &&
    profile.telegram_link_code_expires_at &&
    new Date(profile.telegram_link_code_expires_at).getTime() < Date.now()
  ) {
    await supabase.from('profiles').update({ telegram_link_code: null }).eq('id', profile.id)
    await reply(chatId, 'Код устарел. Сгенерируйте новый в приложении и попробуйте снова.')
    return
  }

  // Один чат — один профиль: снимаем старую привязку, если она была.
  await supabase
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_username: null })
    .eq('telegram_chat_id', chatId)
    .neq('id', profile.id)

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      telegram_chat_id: chatId,
      telegram_username: username,
      telegram_link_code: null,
      telegram_link_code_expires_at: null,
    })
    .eq('id', profile.id)

  if (updateError) {
    console.error('link update failed:', updateError.message)
    await reply(chatId, 'Не удалось сохранить привязку. Попробуйте ещё раз из приложения.')
    return
  }

  const familyName = (profile as any).families?.name as string | undefined
  const greeting = profile.full_name ? `${escapeHtml(profile.full_name)}, ` : ''

  if (!profile.family_id) {
    await reply(
      chatId,
      `✅ ${greeting}чат подключён.\n\nНо вы ещё не создали и не выбрали семью в приложении — ` +
        'после этого начнут приходить уведомления.',
    )
    return
  }

  await reply(
    chatId,
    `✅ <b>Готово!</b>\n\n${greeting}теперь вы будете получать события семьи` +
      `${familyName ? ` «${escapeHtml(familyName)}»` : ''}.\n\n` +
      'Каждое утро в 08:30 — сводка на день, плюс уведомления о новых, изменённых и выполненных событиях.\n\n' +
      '/today — события на сегодня\n/stop — отключить',
  )
}

async function sendToday(chatId: number) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('family_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()

  if (!profile?.family_id) {
    await reply(chatId, 'Чат не привязан к семье. Откройте приложение и нажмите «Подключить Telegram».')
    return
  }

  const messages = await buildDigestForFamily(supabase, profile.family_id)
  for (const message of messages) {
    await reply(chatId, message)
  }
}

async function unsubscribe(chatId: number) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()

  if (!data) {
    await reply(chatId, 'Уведомления и так отключены. Подключить заново можно из приложения.')
    return
  }

  await supabase
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_username: null })
    .eq('id', data.id)

  await reply(chatId, '🔕 Уведомления отключены. Передумаете — подключите снова в приложении.')
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 401 })
  }

  let update: any = null
  try {
    update = await req.json()
  } catch {
    return new Response('OK', { status: 200 })
  }

  // Обрабатываем только обычные текстовые сообщения в личке.
  const message = update?.message
  if (!message?.text || !message.chat) return new Response('OK', { status: 200 })

  const chatId: number = message.chat.id
  const username: string | null = message.from?.username ?? null

  if (message.chat.type && message.chat.type !== 'private') {
    await reply(chatId, 'Я работаю только в личных сообщениях. Напишите мне в личку, пожалуйста.')
    return new Response('OK', { status: 200 })
  }

  const [rawCommand, ...args] = String(message.text).trim().split(/\s+/)
  const command = rawCommand.split('@')[0].toLowerCase()

  try {
    if (command === '/start') {
      await linkChat(chatId, username, args[0] ?? '')
    } else if (command === '/today' || command === '/calendar') {
      await sendToday(chatId)
    } else if (command === '/stop' || command === '/unlink') {
      await unsubscribe(chatId)
    } else if (command === '/help') {
      await reply(chatId, HELP_TEXT)
    } else {
      await reply(chatId, HELP_TEXT)
    }
  } catch (error) {
    console.error('bot handler error:', error)
    await reply(chatId, 'Что-то пошло не так. Попробуйте ещё раз чуть позже.')
  }

  return new Response('OK', { status: 200 })
})
