// Необязательная прослойка: Telegram-webhook можно направить сюда,
// а функция перешлёт апдейт в основного бота.
const targetUrl = 'https://dezjzgiheinlzhmvvsao.supabase.co/functions/v1/telegram-bot-handler'

Deno.serve(async (req) => {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const body = hasBody ? await req.arrayBuffer() : undefined

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: req.headers,
    body,
  })

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
})
