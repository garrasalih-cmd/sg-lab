// =====================================================================
// index.ts — دالة الخادم «sek» (Supabase Edge Function)
// ثلاثة أنواع من الطلبات:
//   1) GET  ?code=…&state=…   ⇒ عودة من صفحة موافقة Google (OAuth callback)
//   2) POST + x-cron-secret   ⇒ المؤقّت كل 5 دقائق: مزامنة التقويم + الإشعارات
//   3) POST {action} + JWT    ⇒ طلبات التطبيق: status / connect / disconnect / events / sync / test_push
// =====================================================================
import { admin, json, CORS, cfg } from './shared.ts';
import { googleConfigured, startConnect, handleCallback, disconnect, listEvents, syncUser } from './google.ts';
import { runNotifications, pushToUser, sendPush } from './notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);

  try {
    // ---------- 1) عودة Google ----------
    if (req.method === 'GET' && url.searchParams.has('state')) return await handleCallback(url);

    // ---------- 2) المؤقّت ----------
    const cronHeader = req.headers.get('x-cron-secret');
    if (cronHeader) {
      if (cronHeader !== await cfg('cron_secret')) return json({ error: 'forbidden' }, 403);
      const body = await req.json().catch(() => ({}));
      if (body.selftest) return json(await sendPush(body.sub, { title: 'test', body: 'test', url: './', tag: 'test' }));
      return json(await runCron());
    }

    // ---------- 3) طلبات التطبيق (تحتاج تسجيل دخول) ----------
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const { data: tok } = await admin.from('google_tokens').select('*').eq('user_id', user.id).maybeSingle();

    switch (body.action) {
      case 'status':
        return json({ configured: googleConfigured(), connected: !!tok, email: tok?.email ?? null, last_sync_at: tok?.last_sync_at ?? null });

      case 'connect': {
        if (!googleConfigured()) return json({ error: 'google_not_configured' }, 400);
        const ret = String(body.return_url || '');
        // نسمح بالعودة فقط إلى عنوان https (أو localhost للتجربة) ⇒ حماية من إعادة التوجيه الخبيثة
        if (!/^https:\/\/[^/]+/.test(ret) && !/^http:\/\/localhost(:\d+)?\//.test(ret)) return json({ error: 'bad_return_url' }, 400);
        return json({ url: await startConnect(user.id, ret) });
      }

      case 'disconnect':
        await disconnect(user.id);
        return json({ ok: true });

      case 'events':
        if (!tok) return json({ connected: false, events: [] });
        return json({ connected: true, events: await listEvents(tok, body.from, body.to) });

      case 'sync':
        if (!tok) return json({ connected: false });
        await syncUser(tok);
        return json({ connected: true, ok: true });

      case 'test_push': {
        const res = await pushToUser(user.id, { title: '🔔 سكرتيري', body: 'الإشعارات تعمل! 🎉', url: './', tag: 'test' });
        return json({ sent: res.filter(r => r.ok).length, total: res.length, results: res });
      }
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

// المؤقّت: مزامنة التقويم لكل مستخدم كل ~15 دقيقة + الإشعارات كل 5 دقائق
async function runCron() {
  const { data: toks } = await admin.from('google_tokens').select('*');
  let synced = 0;
  for (const tok of toks || []) {
    if (tok.last_sync_at && Date.now() - Date.parse(tok.last_sync_at) < 14 * 60_000) continue;
    try { await syncUser(tok); synced++; } catch (e) { console.error('cron sync', tok.user_id, e); }
  }
  await runNotifications(new Set((toks || []).map(t => t.user_id)));
  return { ok: true, synced };
}
