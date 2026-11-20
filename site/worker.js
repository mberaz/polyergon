// polyergon.ai: static site, plus POST /api/subscribe for the opt-in "Get updates" list (D1).
const CORS = {
  'Access-Control-Allow-Origin': '*', // only accepts an email, so any origin (the local app) may post
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const json = (body, status = 200) => Response.json(body, { status, headers: CORS })

async function subscribe(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  if (Number(request.headers.get('content-length') || 0) > 1024) return json({ ok: false, error: 'Too large' }, 413)
  const text = await request.text()
  if (text.length > 1024) return json({ ok: false, error: 'Too large' }, 413)
  let body
  try { body = JSON.parse(text) } catch { return json({ ok: false, error: 'Bad JSON' }, 400) }
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (email.length > 254 || !EMAIL.test(email)) return json({ ok: false, error: 'Please enter a valid email.' }, 400)
  const source = body?.source === 'app' ? 'app' : 'site'
  await env.DB.prepare('INSERT OR IGNORE INTO subscribers (email, source) VALUES (?, ?)').bind(email, source).run()
  return json({ ok: true })
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/subscribe') {
      try { return await subscribe(request, env) } catch { return json({ ok: false, error: 'Something went wrong. Try again later.' }, 500) }
    }
    return env.ASSETS.fetch(request)
  },
}
