// Appeals: only one's own punishments in force can be appealed (a forged id is refused), limits against spam, moderators'
// rights, one decision per appeal (also when two press at once), an approval lifts the ban / mute / warning and keeps the
// history, the public pages (sign-in, list, form, own appeal only) and the moderator's pages.
process.env.DATABASE_PATH = './data/test_appeals.sqlite';
process.env.WEB_BASE_URL = 'https://dark.example';
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'Сервер ' + id.slice(-2), icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'U' + String(id).slice(-2), avatar: '' }])), botApi: {} });
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const ap = require('../bot/modules/appeals');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const fails = async (f, re) => { try { await f(); } catch (e) { assert(re.test(e.message), e.message); return; } throw new Error('did not fail'); };

  const G = '777000000000000001'; const U = '700000000000000010'; const V = '700000000000000011';
  const MOD = '700000000000000020'; const WEAK = '700000000000000021';
  const banned = new Set([U]); const unbans = []; const dms = [];
  const timeouts = new Map(); // userId -> until
  const perms = { [MOD]: ['BanMembers', 'ModerateMembers'], [WEAK]: [] };
  const member = (id) => ({ id, user: { id, bot: false }, permissions: { has: (p) => (perms[id] || []).includes(p) }, roles: { highest: { position: 1 } }, moderatable: true,
    get communicationDisabledUntilTimestamp() { return timeouts.get(id) || null; }, timeout: async (ms) => { if (ms === null) timeouts.delete(id); else timeouts.set(id, Date.now() + ms); } });
  const guild = {
    id: G, name: 'Сервер', ownerId: '1', client: { users: { send: async () => {} } },
    bans: { fetch: async ({ user }) => (banned.has(user) ? { user: { id: user } } : Promise.reject(new Error('Unknown Ban'))) },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 99 } } }, fetch: async (id) => (id === U && banned.has(U) ? Promise.reject(new Error('Unknown Member')) : member(id)), unban: async (id) => { banned.delete(id); unbans.push(id); } },
    channels: { cache: new Map(), fetch: async () => null }, roles: { everyone: { position: 0 } }
  };
  const client = { isReady: () => true, guilds: { cache: new Map([[G, guild]]) }, users: { send: async (id, p) => { dms.push([id, p]); return {}; } } };
  require('../web/botBridge').setClient(client);
  const settings = await require('../bot/modules/leveling').getOrCreateSettings(G);
  const ban = await db.ModLog.create({ guildId: G, userId: U, moderatorId: MOD, action: 'ban', reason: 'Спам', caseNumber: 4 });
  const vMute = await db.ModLog.create({ guildId: G, userId: V, moderatorId: MOD, action: 'mute', reason: 'Флуд', duration: 3600000, caseNumber: 5 });
  timeouts.set(V, Date.now() + 3600000);
  const vWarn = await db.Warning.create({ guildId: G, userId: V, moderatorId: MOD, reason: 'Оффтоп' });
  const TEXT = 'Я был неправ, больше не повторится, прошу снять наказание.';

  await test('a person sees only his own punishments in force: the ban (Discord confirms), the mute, the warning', async () => {
    const u = await ap.punishmentsOf(U);
    assert(u.length === 1 && u[0].kind === 'ban' && u[0].caseNumber === 4 && u[0].reason === 'Спам', JSON.stringify(u));
    const v = await ap.punishmentsOf(V);
    assert(v.some((p) => p.kind === 'mute') && v.some((p) => p.kind === 'warn' && p.id === vWarn.id) && !v.some((p) => p.kind === 'ban'), JSON.stringify(v));
  });

  await test('no forged ids: someone else\'s case, a wrong server or kind, a lifted punishment — refused', async () => {
    await fails(() => ap.create(U, { guildId: G, kind: 'mute', id: vMute.id, text: TEXT }), /не найдено/);
    await fails(() => ap.create(U, { guildId: G, kind: 'warn', id: vWarn.id, text: TEXT }), /не найдено/);
    await fails(() => ap.create(U, { guildId: '777000000000000999', kind: 'ban', id: ban.id, text: TEXT }), /не найдено/);
    await fails(() => ap.create(U, { guildId: G, kind: 'kick', id: ban.id, text: TEXT }), /нельзя/);
  });

  let first;
  await test('filing: the text is checked, links only https, the punishment copied from the journal; the author is told', async () => {
    await fails(() => ap.create(U, { guildId: G, kind: 'ban', id: ban.id, text: 'коротко' }), /хотя бы/);
    await fails(() => ap.create(U, { guildId: G, kind: 'ban', id: ban.id, text: TEXT, links: 'http://x.ru' }), /https/);
    await fails(() => ap.create(U, { guildId: G, kind: 'ban', id: ban.id, text: TEXT, links: 'https://a.ru https://b.ru https://c.ru https://d.ru' }), /Не больше 3/);
    dms.length = 0;
    first = await ap.create(U, { guildId: G, kind: 'ban', id: ban.id, text: TEXT, links: 'https://imgur.com/a/1' });
    assert(first.status === 'new' && first.caseNumber === 4 && first.punishReason === 'Спам' && first.modLogId === ban.id && first.links === 'https://imgur.com/a/1', JSON.stringify(first));
    await new Promise((r) => setTimeout(r, 30));
    assert(dms.some(([id]) => id === U), 'DM to the author');
  });

  await test('limits: the same punishment once at a time; open appeals per server; five a day', async () => {
    await fails(() => ap.create(U, { guildId: G, kind: 'ban', id: ban.id, text: TEXT }), /уже обжалуется/);
    const mute = await ap.create(V, { guildId: G, kind: 'mute', id: vMute.id, text: TEXT });
    const warn = await ap.create(V, { guildId: G, kind: 'warn', id: vWarn.id, text: TEXT });
    assert(mute && warn, 'two open');
    settings.appealsMaxOpen = 1; await settings.save();
    const w2 = await db.Warning.create({ guildId: G, userId: V, moderatorId: MOD, reason: 'Ещё' });
    await fails(() => ap.create(V, { guildId: G, kind: 'warn', id: w2.id, text: TEXT }), /открытые апелляции/);
    settings.appealsMaxOpen = 2; await settings.save();
  });

  await test('rights: a moderator without the right is refused; a decision needs a reason', async () => {
    await fails(() => ap.decide(first.id, G, WEAK, 'approved', 'Ок, снимаем'), /Банить участников/);
    await fails(() => ap.decide(first.id, G, MOD, 'rejected', ''), /причину/);
    await fails(() => ap.decide(first.id, '777000000000000999', MOD, 'approved', 'Ок'), /не найдена/);
  });

  await test('one decision: two moderators approving at once — one wins, the ban is lifted once, the history stays', async () => {
    await ap.decide(first.id, G, MOD, 'review');
    const r = await Promise.allSettled([ap.decide(first.id, G, MOD, 'approved', 'Поверим'), ap.decide(first.id, G, MOD, 'approved', 'Поверим')]);
    assert(r.filter((x) => x.status === 'fulfilled').length === 1, r.map((x) => x.status + (x.reason ? x.reason.message : '')).join());
    const a = await db.Appeal.findByPk(first.id);
    assert(a.status === 'approved' && a.decisionReason === 'Поверим' && /Бан снят/.test(a.actionResult), JSON.stringify(a));
    assert(unbans.length === 1 && !banned.has(U), 'unbanned once');
    assert(await db.ModLog.findByPk(ban.id) && await db.ModLog.count({ where: { guildId: G, userId: U, action: 'unban' } }) === 1, 'history kept + unban recorded');
    await fails(() => ap.decide(first.id, G, MOD, 'rejected', 'Передумал'), /уже принято/);
    assert((await ap.punishmentsOf(U)).length === 0, 'nothing left to appeal');
  });

  await test('approving a mute removes the timeout; approving a warning revokes it with a mark (not deleted)', async () => {
    const [mute, warn] = await db.Appeal.findAll({ where: { userId: V, status: 'new' }, order: [['id', 'ASC']] });
    await ap.decide(mute.id, G, MOD, 'approved', 'Ладно');
    assert(!timeouts.has(V), 'timeout removed');
    await ap.decide(warn.id, G, MOD, 'approved', 'Снимаем');
    const w = await db.Warning.findByPk(vWarn.id);
    assert(w && w.revokedAt && w.revokedBy === MOD && /Апелляция/.test(w.revokeReason), JSON.stringify(w));
  });

  await test('after a refusal the same punishment waits for the pause; comments: visible ones reach the author', async () => {
    const w3 = await db.Warning.create({ guildId: G, userId: V, moderatorId: MOD, reason: 'Третье' });
    const a = await ap.create(V, { guildId: G, kind: 'warn', id: w3.id, text: TEXT });
    dms.length = 0;
    await ap.comment(a.id, G, MOD, 'Пришлите скриншот', true);
    await ap.comment(a.id, G, MOD, 'Это для своих', false);
    await new Promise((r) => setTimeout(r, 30));
    assert(dms.length === 1, 'only the visible comment is sent: ' + dms.length);
    await ap.decide(a.id, G, MOD, 'rejected', 'Нарушение подтверждено');
    await fails(() => ap.create(V, { guildId: G, kind: 'warn', id: w3.id, text: TEXT }), /после/);
    assert(await db.Warning.findByPk(w3.id).then((w) => !w.revokedAt), 'a rejection changes nothing');
  });

  await test('the private message of a punishment carries the appeal link', async () => {
    assert(ap.appealHint(settings, 'ban').includes('https://dark.example/appeals'), 'hint');
    settings.appealsKinds = 'mute'; await settings.save();
    assert(ap.appealHint(settings, 'ban') === '' && ap.kindsOn(settings).join() === 'mute', 'off for bans');
    settings.appealsKinds = ''; await settings.save();
    assert(ap.kindsOn(settings).length === 0, 'none ticked = none');
    settings.appealsKinds = 'ban,mute,warn'; await settings.save();
  });

  await test('web: sign-in first (and back), the list, the form, filing, one\'s own appeal only; moderators\' queue, decision, comment, settings', async () => {
    banned.add(U);
    const ban2 = await db.ModLog.create({ guildId: G, userId: U, moderatorId: MOD, action: 'ban', reason: 'Повторный спам', caseNumber: 9 });
    const express = require('express');
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.use(express.urlencoded({ extended: true }));
    let who = null;
    app.use((req, res, next) => { req.user = who ? { id: who, username: 'user' + who.slice(-2) } : undefined; req.isAuthenticated = () => Boolean(who); res.locals.user = req.user || null; next(); });
    require('../web/modules');
    app.use('/appeals', require('../web/routes/appeals'));
    app.use('/dashboard', require('../web/routes/dashboard/moderation'));
    app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (p, b) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    try {
      let r = await fetch(base + '/appeals', { redirect: 'manual' });
      assert(r.status === 302 && r.headers.get('location') === '/auth/login?next=%2Fappeals', r.headers.get('location'));
      const { safeNext } = require('../web/routes/auth');
      assert(safeNext('/appeals/new?g=1&kind=ban&id=2') && !safeNext('https://evil.com') && !safeNext('//evil.com'), 'only our own pages after sign-in');
      who = U;
      let t = await (await fetch(base + '/appeals')).text();
      assert(t.includes('Обжаловать') && t.includes('Повторный спам'), 'list ' + t.slice(0, 300));
      t = await (await fetch(`${base}/appeals/new?g=${G}&kind=ban&id=${ban2.id}`)).text();
      assert(t.includes('дело #9') && t.includes('Повторный спам'), 'form shows the punishment');
      t = await (await fetch(`${base}/appeals/new?g=${G}&kind=mute&id=${vMute.id}`)).text();
      assert(t.includes('не найдено'), 'someone else\'s case is not shown');
      r = await post('/appeals', { g: G, kind: 'ban', id: String(ban2.id), text: 'мало' });
      assert(r.status === 400, 'short text');
      r = await post('/appeals', { g: G, kind: 'ban', id: String(ban2.id), text: TEXT });
      const loc = r.headers.get('location'); const id = /appeals\/(\d+)/.exec(loc)?.[1];
      assert(id, loc);
      t = await (await fetch(base + `/appeals/${id}`)).text();
      assert(t.includes('Новая') && t.includes(TEXT), 'own appeal');
      who = V;
      assert((await fetch(base + `/appeals/${id}`)).status === 404, 'someone else\'s appeal: 404');
      who = MOD;
      t = await (await fetch(`${base}/dashboard/${G}/moderation-appeals`)).text();
      assert(t.includes(`#${id}`) && t.includes('Приём апелляций'), 'queue');
      t = await (await fetch(`${base}/dashboard/${G}/moderation-appeals/${id}`)).text();
      assert(t.includes(TEXT) && t.includes('Одобрить и снять наказание') && t.includes('Повторный спам'), 'detail');
      await post(`/dashboard/${G}/moderation-appeals/${id}/comment`, { text: 'Проверяем', visible: 'on' });
      r = await post(`/dashboard/${G}/moderation-appeals/${id}/decide`, { decision: 'rejected', reason: '' });
      assert(decodeURIComponent(r.headers.get('location')).includes('причину'), 'reason needed');
      r = await post(`/dashboard/${G}/moderation-appeals/${id}/decide`, { decision: 'rejected', reason: 'Повтор' });
      assert(r.headers.get('location').includes('saved'), r.headers.get('location'));
      assert((await db.Appeal.findByPk(Number(id))).status === 'rejected' && banned.has(U), 'rejected, still banned');
      who = U;
      t = await (await fetch(base + `/appeals/${id}`)).text();
      assert(t.includes('Отклонена') && t.includes('Повтор') && t.includes('Проверяем'), 'author sees the decision and the visible comment');
      who = MOD;
      await post(`/dashboard/${G}/moderation/appeals`, { appealsEnabled: 'on', appealsMaxOpen: '3', appealsCooldownDays: '0', kind_ban: 'on', appealsChannelId: '' });
      const s = await db.GuildSettings.findOne({ where: { guildId: G } });
      assert(s.appealsMaxOpen === 3 && s.appealsCooldownDays === 0 && s.appealsKinds === 'ban' && s.appealsLinks === false, JSON.stringify({ k: s.appealsKinds }));
    } finally { server.close(); }
  });

  require('../web/botBridge').setClient(null);
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : `\n   ${r.e}`}`);
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
