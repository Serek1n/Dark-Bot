// Hardening: response headers, no caching of private pages, OAuth state, no option injection into yt-dlp.
process.env.DATABASE_PATH = './data/test_hardening.sqlite';
process.env.DISCORD_CLIENT_ID = 'BOTAPP'; process.env.DISCORD_CLIENT_SECRET = 'secret'; process.env.DISCORD_TOKEN = 'x';
process.env.WEB_BASE_URL = 'https://panel.example.com'; process.env.SESSION_SECRET = 'a'.repeat(40);
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('discordApi.js', { getBotGuildIds: async () => new Set(), getBotGuilds: async () => new Map(), getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });

(async () => {
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  await require('../db').init();
  const { app } = require('../web/index');
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;

  await test('every page carries the security headers, https sites get HSTS', async () => {
    const r = await fetch(base + '/');
    const h = (n) => r.headers.get(n) || '';
    assert(h('strict-transport-security').includes('max-age=31536000'), 'hsts');
    assert(h('x-frame-options') === 'DENY' && h('x-content-type-options') === 'nosniff' && h('cross-origin-opener-policy') === 'same-origin' && h('cross-origin-resource-policy') === 'same-origin', 'basic');
    assert(h('permissions-policy').includes('camera=()') && h('permissions-policy').includes('microphone=()'), 'permissions');
    const csp = h('content-security-policy'); assert(csp.includes("object-src 'none'") && csp.includes("base-uri 'none'") && csp.includes("frame-ancestors 'none'"), csp);
    assert(!r.headers.get('x-powered-by'), 'no x-powered-by');
  });
  await test('private pages are never cached; the public ones are not forced to be', async () => {
    const d = await fetch(base + '/dashboard', { redirect: 'manual' });
    assert((d.headers.get('cache-control') || '').includes('no-store'), 'dashboard: ' + d.headers.get('cache-control'));
    const a = await fetch(base + '/auth/login', { redirect: 'manual' });
    assert((a.headers.get('cache-control') || '').includes('no-store'), 'auth');
    const root = await fetch(base + '/'); assert(!(root.headers.get('cache-control') || '').includes('no-store'), 'root');
  });
  await test('sign-in carries a random state that is checked on return', async () => {
    const a = await fetch(base + '/auth/login', { redirect: 'manual' });
    const loc = new URL(a.headers.get('location')); const state = loc.searchParams.get('state');
    assert(state && state.length >= 16, 'state in the redirect: ' + loc);
    const back = await fetch(base + '/auth/callback?code=x&state=forged', { redirect: 'manual' });
    assert(back.status === 302 && !String(back.headers.get('location')).includes('/dashboard'), 'forged state does not sign in: ' + back.headers.get('location'));
  });
  await test('yt-dlp: whatever the user typed comes after "--", so it can never be taken for an option', async () => {
    const P = require('../bot/modules/music/player');
    const a = P.ytDlpAudioArgs('--exec id https://x'); const i = a.indexOf('--');
    assert(i > 0 && a[a.length - 2] === '--' && a[a.length - 1] === '--exec id https://x', a.join(' '));
    const src = fs.readFileSync(path.join(__dirname, '..', 'bot/modules/music/player.js'), 'utf8');
    for (const call of src.match(/ytDlpJson\(\[[^\]]*\]/g)) assert(call.includes("'--'"), 'no "--" in ' + call);
  });

  server.close();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : '\n      ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
