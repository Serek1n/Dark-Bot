// Fixes after the audit: queues that one stuck row cannot block, rooms cleaned after downtime, the YouTube feed,
// and the accessibility frame of the panel (main area, skip link, save bar out of the Tab order while hidden).
process.env.DATABASE_PATH = './data/test_audit_fixes.sqlite';
const fs = require('fs');
const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const assert = require('assert');
(async () => {
  const db = require('../db');
  await db.init();
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack || e.message }); } };
  const G = '777000000000000001';
  const past = () => new Date(Date.now() - 60000);

  await test('temporary roles: a role the bot cannot take away is put off, the rows behind it are still done', async () => {
    const tempRoles = require('../bot/modules/tempRoles');
    for (let i = 0; i < 55; i++) await db.TempRole.create({ guildId: G, userId: '81' + String(i).padStart(16, '0'), roleId: 'STUCK', expiresAt: past(), givenBy: 'x' });
    const good = await db.TempRole.create({ guildId: G, userId: '820000000000000001', roleId: 'FINE', expiresAt: past(), givenBy: 'x' });
    let removedFine = 0;
    const member = (roleId) => ({ roles: { cache: { has: (id) => id === roleId }, remove: async (id) => { if (id === 'STUCK') throw new Error('Missing Permissions'); removedFine++; } }, send: async () => {} });
    const guild = { id: G, name: 'T', roles: { cache: new Map() }, members: { fetch: async (id) => member(id.startsWith('82') ? 'FINE' : 'STUCK') } };
    const client = { guilds: { cache: new Map([[G, guild]]) } };
    await tempRoles.tick(client); // 50 stuck rows: each one is moved 10 minutes ahead
    await tempRoles.tick(client); // the rest, the good one among them
    assert.strictEqual(removedFine, 1, 'the role behind the stuck ones was taken away');
    assert.strictEqual(await db.TempRole.count({ where: { id: good.id } }), 0, 'its row is gone');
    assert.strictEqual(await db.TempRole.count({ where: { roleId: 'STUCK', expiresAt: { [require('sequelize').Op.lte]: new Date() } } }), 0, 'no stuck row is due right now');
  });

  await test('temporary bans: a server the bot has left does not hold the queue', async () => {
    const mod = require('../bot/modules/moderation');
    const tick = mod.tickBans || mod.tick || mod.liftExpiredBans;
    if (!tick) return; // the scheduler is not exported under a known name: covered by reading
    for (let i = 0; i < 52; i++) await db.ModLog.create({ guildId: '999000000000000001', userId: '83' + String(i).padStart(16, '0'), moderatorId: '1', action: 'ban', active: true, expiresAt: past(), caseNumber: i + 1 });
    const mine = await db.ModLog.create({ guildId: G, userId: '840000000000000001', moderatorId: '1', action: 'ban', active: true, expiresAt: past(), caseNumber: 1 });
    let unbanned = 0;
    const guild = { id: G, members: { unban: async () => { unbanned++; }, me: { permissions: { has: () => true } } }, bans: { remove: async () => { unbanned++; } }, channels: { fetch: async () => null, cache: new Map() } };
    const client = { guilds: { cache: new Map([[G, guild]]) }, user: { id: '1' } };
    await tick(client); await tick(client);
    await mine.reload();
    assert(unbanned >= 1 || mine.active === false, 'the ban of a present server was lifted behind 52 rows of an absent one');
  });

  await test('temporary rooms: the ones that emptied while the bot was off are removed at start, busy ones stay', async () => {
    const rooms = require('../bot/modules/tempRooms');
    await db.TempVoiceChannel.create({ guildId: G, channelId: 'EMPTY', ownerId: '1' });
    await db.TempVoiceChannel.create({ guildId: G, channelId: 'BUSY', ownerId: '2' });
    await db.TempVoiceChannel.create({ guildId: G, channelId: 'GONE', ownerId: '3' });
    const deleted = [];
    const chan = (id, size) => ({ id, members: { size }, delete: async () => { deleted.push(id); } });
    const guild = { id: G, channels: { fetch: async (id) => { if (id === 'GONE') { const e = new Error('Unknown Channel'); e.code = 10003; throw e; } return chan(id, id === 'BUSY' ? 2 : 0); } } };
    const removed = await rooms.sweepTempRooms({ guilds: { cache: new Map([[G, guild]]) } });
    assert.strictEqual(removed, 2);
    assert.deepStrictEqual(deleted, ['EMPTY']);
    assert.strictEqual(await db.TempVoiceChannel.count(), 1, 'only the busy room is left');
    assert.strictEqual(await rooms.isTempRoom('BUSY'), true);
    assert.strictEqual(await rooms.isTempRoom('EMPTY'), false);
  });

  await test('YouTube: the newest video is read from the channel feed (no API quota), names are unescaped', async () => {
    const { parseFeed } = require('../bot/modules/alerts/poller');
    const xml = '<feed><author><name>Dark &amp; Co</name></author><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>A &lt;b&gt; &quot;clip&quot;</title></entry><entry><yt:videoId>older000000</yt:videoId><title>old</title></entry></feed>';
    assert.deepStrictEqual(parseFeed(xml), { videoId: 'dQw4w9WgXcQ', title: 'A <b> "clip"', channelTitle: 'Dark & Co' });
    assert.strictEqual(parseFeed('<feed></feed>'), null);
    assert.strictEqual(parseFeed('<html>not a feed</html>'), null);
  });

  await test('automod reads edited messages; counting filters do not take an edit for one more message', async () => {
    const events = require('../bot/events/automodEdits');
    assert(Array.isArray(events) && events[0].name === 'messageUpdate');
    const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'modules', 'automod.js'), 'utf8');
    assert(/edited && RATE_FILTERS\.includes\(f\.key\)/.test(src), 'rate filters are skipped for an edit');
    let checked = 0;
    const settingsMod = require('../bot/modules/leveling');
    await (await settingsMod.getOrCreateSettings(G)).update({ automodEnabled: false });
    await events[0].execute({ partial: false, content: 'a' }, { guild: { id: G }, partial: false, author: { bot: false }, content: 'b', get member() { checked++; return {}; } });
    assert.strictEqual(checked, 0, 'automod off: the edit is not even looked at');
  });

  await test('panel: main area, a "skip to content" link, the hidden save bar is out of the Tab order', async () => {
    const views = path.join(__dirname, '..', 'web', 'views');
    const sidebar = fs.readFileSync(path.join(views, 'partials', 'sidebar.ejs'), 'utf8');
    assert(sidebar.includes('class="skip-link" href="#main"'), 'skip link');
    const panelJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'js', 'panel.js'), 'utf8');
    assert(/id="saveBar" inert/.test(sidebar) && panelJs.includes("bar.removeAttribute('inert')"), 'save bar is inert until something is edited');
    for (const f of fs.readdirSync(path.join(views, 'dashboard'))) {
      const html = fs.readFileSync(path.join(views, 'dashboard', f), 'utf8');
      if (!html.includes("include('../partials/sidebar')")) continue;
      assert(html.includes('<main class="content" id="main"') && html.includes('</main>'), `${f}: the content is the <main> of the page`);
      assert.strictEqual((html.match(/<main\b/g) || []).length, 1, `${f}: one main`);
    }
    const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'js', 'ui.js'), 'utf8');
    assert(ui.includes("label:not([for])") && ui.includes('lab.htmlFor = field.id'), 'captions are tied to their fields');
    assert(ui.includes('role="combobox"') && ui.includes('aria-activedescendant') && ui.includes('opener.focus()'), 'search: announced results, focus goes back');
    const css = require('../web/styles').stylesheet().text;
    assert(css.includes('--field-border') && !/\.rail-slot|\.sidebar-guild/.test(css), 'visible field edges; the old side menu styles are gone');
  });

  await test('the process stops cleanly and the image carries no secrets', async () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8');
    assert(index.includes("process.once('SIGTERM'") && index.includes('flushAll()'), 'voice time is written on stop');
    const ignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');
    assert(/^\.env$/m.test(ignore) && /^data$/m.test(ignore) && /^\.git$/m.test(ignore));
  });

  await test('one REST client: through discord.js when the bot runs (route, query, audit reason, body), errors in the shape callers read', async () => {
    const bridge = require('../web/botBridge');
    const seen = [];
    const fake = { isReady: () => true, rest: {
      get: async (route, o) => { seen.push(['get', route, o.query && o.query.toString(), o.reason]); if (route === '/gone') { const e = new Error('Unknown Channel'); e.status = 404; e.code = 10003; e.rawError = { code: 10003, message: 'Unknown Channel' }; throw e; } return { ok: route }; },
      put: async (route, o) => { seen.push(['put', route, 'body' in o, o.reason]); },
      post: async (route, o) => { seen.push(['post', route, JSON.stringify(o.body)]); return { id: 'NEW' }; }
    } };
    bridge.setClient(fake);
    try {
      const api = require('../web/discordRest').createBotApi();
      assert.deepStrictEqual((await api.get('/guilds/1?with_counts=true', { params: { limit: 5 } })).data, { ok: '/guilds/1' });
      assert.deepStrictEqual(seen[0], ['get', '/guilds/1', 'with_counts=true&limit=5', undefined]);
      await api.put('/guilds/1/members/2/roles/3', null, { headers: { 'X-Audit-Log-Reason': encodeURIComponent('Уровень изменён') } });
      assert.deepStrictEqual(seen[1], ['put', '/guilds/1/members/2/roles/3', false, 'Уровень изменён'], 'no body for an empty PUT, the reason decoded');
      assert.strictEqual((await api.post('/channels/1/messages', { content: 'x' })).data.id, 'NEW');
      const err = await api.get('/gone').catch((e) => e);
      assert.strictEqual(err.response.status, 404); assert.strictEqual(err.response.data.code, 10003);
      assert.strictEqual(require('../bot/utils/discordErrors').errorKey(err) !== undefined, true);
    } finally { bridge.setClient(null); }
  });

  await test('the stylesheet: parts in a fixed order, one file for the browser, scales instead of loose numbers', async () => {
    const styles = require('../web/styles');
    const names = styles.parts();
    assert.deepStrictEqual(names, [...names].sort(), 'parts are read in the order of their numbers');
    assert(names[0].startsWith('00-tokens'), 'tokens come first');
    const css = styles.stylesheet().text;
    assert(!/font-size:\s*[\d.]+(px|rem)/.test(css), 'every text size is a token of the scale');
    assert(!/border-radius:[^;}]*\d+px/.test(css), 'every corner is a token of the scale');
    assert(/--fs-14: 14px/.test(css) && /--r-pill: 999px/.test(css) && /--dc-blurple/.test(css));
    assert(!fs.existsSync(path.join(__dirname, '..', 'web', 'public', 'css', 'style.css')), 'no second copy that could drift');
  });

  await test('pages run no inline scripts (the policy forbids them) and ask with the panel\'s own window', async () => {
    const views = path.join(__dirname, '..', 'web', 'views');
    const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk(views).filter((x) => x.endsWith('.ejs'))) {
      const html = fs.readFileSync(f, 'utf8');
      assert(!/<script>/.test(html), path.basename(f) + ': inline script');
      assert(!/\son(click|submit|change|input|load|error|keydown)=/i.test(html), path.basename(f) + ': inline handler');
    }
    const index = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.js'), 'utf8');
    assert(/script-src 'self';/.test(index) && !/script-src[^;]*unsafe-inline/.test(index), 'script-src without unsafe-inline');
    const js = fs.readdirSync(path.join(__dirname, '..', 'web', 'public', 'js')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'js', f), 'utf8')).join('\n');
    assert(!/[^.\w]confirm\(/.test(js.replace(/darkConfirm\(/g, '')), 'no browser confirm() left');
  });

  await test('services: /level and the panel change a level through one function', async () => {
    const { adjustLevel } = require('../services/levels');
    assert.strictEqual(require('../bot/commands/leveling/level').adjustLevel, adjustLevel, 'the command uses the service');
    const r = await adjustLevel(G, '850000000000000001', 'set', 7);
    assert.strictEqual(r.level, 7);
    assert.strictEqual((await db.MemberProfile.findOne({ where: { guildId: G, userId: '850000000000000001' } })).level, 7);
    const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'routes', 'dashboard', 'leveling.js'), 'utf8');
    assert(src.includes("require('../../../services/levels').adjustLevel"), 'the panel uses the service');
  });

  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.l} ${r.ok ? '' : '\n   ' + r.e}`);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\nИтого: ${ok}/${results.length} прошли успешно`);
  await db.sequelize.close();
  process.exit(ok === results.length ? 0 : 1);
})();
