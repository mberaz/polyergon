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
  await env.DB.prepare('INSERT OR IGNORE INTO subscribers (email, source, token) VALUES (?, ?, ?)').bind(email, source, crypto.randomUUID()).run()
  return json({ ok: true })
}

// Link in every email: https://polyergon.ai/unsubscribe?t=<token>
async function unsubscribe(url, env) {
  const t = url.searchParams.get('t') || ''
  if (t) await env.DB.prepare('DELETE FROM subscribers WHERE token = ?').bind(t).run()
  return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Unsubscribed</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>You are unsubscribed</h1><p>You will not get more Polyergon emails. <a href="/">Back to polyergon.ai</a></p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

// Count installer runs and Mac app downloads per day. Query:
// npx wrangler d1 execute polyergon-subscribers --remote --command "SELECT * FROM downloads ORDER BY day DESC"
function countDownload(url, env) {
  const kind = url.pathname === '/install.sh' ? 'install.sh' : url.pathname.endsWith('.zip') ? 'mac-app' : null
  if (!kind) return
  return env.DB.prepare('INSERT INTO downloads (day, kind, count) VALUES (date(\'now\'), ?, 1) ON CONFLICT(day, kind) DO UPDATE SET count = count + 1').bind(kind).run().catch(() => {})
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (request.method === 'GET') { const c = countDownload(url, env); if (c) ctx.waitUntil(c) }
    if (url.pathname === '/unsubscribe') {
      try { return await unsubscribe(url, env) } catch { return new Response('Something went wrong. Try again later.', { status: 500 }) }
    }
    if (url.pathname === '/api/subscribe') {
      if (request.method === 'POST') {
        const { success } = await env.LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'anon' })
        if (!success) return json({ ok: false, error: 'Too many tries. Wait a minute.' }, 429)
      }
      try { return await subscribe(request, env) } catch { return json({ ok: false, error: 'Something went wrong. Try again later.' }, 500) }
    }
    return env.ASSETS.fetch(request)
  },
}
