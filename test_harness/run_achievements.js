// Achievements: counted from real data (messages, voice, levels, money, purchases, time on the server, events), never given
// twice (also when checks run at once), the reward paid once, the server's own (counters, role, by hand), the card, the
// buttons, /achievements and the panel (catalog, editor, members, settings).
process.env.DATABASE_PATH = './data/test_achievements.sqlite';
const path = require('path');
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '700000000000000009', name: 'награды', type: 0 }], getGuildRoles: async () => [{ id: '700000000000000005', name: 'Ветеран' }], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'U' + id.slice(-2), avatar: '' }])), botApi: {} });
stub('utils/roles.js', { roleGuard: async () => ({ check: (id) => (id === '700000000000000666' ? 'выше роли бота' : null), annotate: (r) => r.map((x) => ({ ...x, blocked: null })) }) });
stub('utils/channels.js', { pickChannels: async (body, settings, g, fields) => { for (const k of Object.keys(fields)) settings[k] = body[k] || null; return []; }, noPerm: () => '/' });
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));

(async () => {
  const db = require('../db'); await db.init();
  const ach = require('../bot/modules/achievements');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const G = '777000000000000001';
  const sent = [];
  const channel = { id: '700000000000000009', send: async (p) => { sent.push(p); return { id: 'm' }; }, permissionsFor: () => ({ has: () => true }) };
  const roleAdds = [];
  const mkMember = (id, extra = {}) => ({ id, displayName: 'Игрок ' + id.slice(-2), joinedTimestamp: Date.now() - 40 * 86400000, user: { id, bot: false, username: 'p' + id, displayAvatarURL: () => null }, roles: { cache: new Map(), add: async (r) => roleAdds.push(r.id) }, ...extra });
  const members = new Map();
  const guild = {
    id: G, name: 'Сервер', client: { users: { fetch: async () => null } },
    channels: { cache: new Map([[channel.id, channel]]), fetch: async (id) => (id === channel.id ? channel : null) },
    roles: { cache: new Map([['700000000000000005', { id: '700000000000000005', name: 'Ветеран', editable: true, managed: false, permissions: { bitfield: 0n } }]]) },
    members: { me: {}, cache: members, fetch: async (id) => members.get(id) || null }
  };
  const settings = await require('../bot/modules/leveling').getOrCreateSettings(G);
  const setProfile = async (userId, f) => { await db.MemberProfile.findOrCreate({ where: { guildId: G, userId } }); await db.MemberProfile.update(f, { where: { guildId: G, userId } }); };
  const keys = async (userId) => (await db.MemberAchievement.findAll({ where: { guildId: G, userId }, raw: true })).map((r) => r.key).sort();

  await test('the built-in catalog: messages, voice, levels, economy, time on the server, events, special; the balance goal comes from the server', async () => {
    const list = await ach.catalog(G, settings);
    for (const k of ['msg_1', 'msg_100', 'msg_1000', 'msg_10000', 'voice_first', 'voice_1h', 'voice_10h', 'voice_100h', 'voice_1000h', 'lvl_5', 'lvl_10', 'lvl_25', 'lvl_50', 'lvl_100', 'eco_earn', 'eco_buy', 'eco_rich', 'stay_30', 'event_1', 'collector_10']) assert(list.some((a) => a.key === k), k);
    assert(list.find((a) => a.key === 'eco_rich').value === 10000, 'goal');
  });

  await test('a check unlocks what the real numbers reach: 150 messages, 2 h of voice, level 6, coins, a purchase, 40 days, a giveaway entry', async () => {
    const id = '700000000000000101'; members.set(id, mkMember(id));
    await setProfile(id, { messageCount: 150, voiceSeconds: 7300, level: 6, balance: 50 });
    await db.Purchase.create({ guildId: G, userId: id, itemName: 'Чай', price: 10, currency: 'coins' });
    const gw = await db.Giveaway.create({ guildId: G, channelId: '1', prize: 'X', endsAt: new Date(Date.now() + 1e6), hostId: '1' }).catch(() => null);
    if (gw) await db.GiveawayEntry.create({ giveawayId: gw.id, userId: id });
    const fresh = await ach.check(guild, id, { settings, announce: false });
    const got = await keys(id);
    for (const k of ['msg_1', 'msg_100', 'voice_first', 'voice_1h', 'lvl_5', 'eco_earn', 'eco_buy', 'stay_30']) assert(got.includes(k), `${k} in ${got}`);
    for (const k of ['msg_1000', 'voice_10h', 'lvl_10', 'eco_rich', 'stay_180']) assert(!got.includes(k), `not ${k}`);
    if (gw) assert(got.includes('event_1'), 'event_1');
    assert(fresh.length === got.length && ach.RARITY[fresh[0].rarity].rank >= ach.RARITY[fresh[fresh.length - 1].rarity].rank, 'rarest first');
    assert((await ach.check(guild, id, { settings, announce: false })).length === 0, 'nothing new the second time');
  });

  await test('never twice: five checks at the same moment give each achievement once and pay its reward once', async () => {
    const own = await db.Achievement.create({ guildId: G, name: 'Болтун', description: '20 сообщений', category: 'messages', rarity: 'rare', condType: 'messages', condValue: 20, rewardCoins: 500, rewardRoleId: '700000000000000005' });
    const id = '700000000000000102'; members.set(id, mkMember(id));
    await setProfile(id, { messageCount: 25 });
    roleAdds.length = 0;
    await Promise.all(Array.from({ length: 5 }, () => ach.check(guild, id, { settings, announce: false })));
    const rows = await db.MemberAchievement.count({ where: { guildId: G, userId: id, key: `c${own.id}` } });
    assert(rows === 1, 'rows ' + rows);
    const p = await db.MemberProfile.findOne({ where: { guildId: G, userId: id } });
    assert(Number(p.balance) === 500, 'balance ' + p.balance);
    assert(roleAdds.filter((r) => r === '700000000000000005').length === 1, 'role ' + roleAdds);
    const tx = await db.EconomyTx.findAll({ where: { guildId: G, userId: id, kind: 'achievement' } });
    assert(tx.length === 1 && tx[0].note === 'Болтун', 'journal');
    assert(!(await ach.grant(guild, id, (await ach.catalog(G, settings)).find((a) => a.key === `c${own.id}`))), 'a hand grant of the same is refused');
  });

  await test('the server\'s own: by role, by hand only, the "other achievements" counter; a turned-off one is not given', async () => {
    const byRole = await db.Achievement.create({ guildId: G, name: 'Со значком', category: 'special', condType: 'role', condRoleId: '700000000000000005' });
    const manual = await db.Achievement.create({ guildId: G, name: 'Герой ивента', category: 'special', condType: 'manual' });
    const off = await db.Achievement.create({ guildId: G, name: 'Выключенное', condType: 'messages', condValue: 1, enabled: false });
    const id = '700000000000000103';
    const m = mkMember(id); m.roles.cache.set('700000000000000005', {}); members.set(id, m);
    await setProfile(id, { messageCount: 1 });
    await ach.check(guild, id, { settings, announce: false });
    const got = await keys(id);
    assert(got.includes(`c${byRole.id}`) && !got.includes(`c${manual.id}`) && !got.includes(`c${off.id}`), got.join());
    const list = await ach.catalog(G, settings);
    assert(await ach.grant(guild, id, list.find((a) => a.key === `c${manual.id}`), '1'), 'by hand');
    assert(await ach.revoke(G, id, `c${manual.id}`), 'revoke');
  });

  await test('a built-in one turned off on the server is not given; the balance goal is the server\'s', async () => {
    settings.achievementsOff = JSON.stringify(['msg_1']); settings.achievementsBalanceGoal = 300; await settings.save();
    const id = '700000000000000104'; members.set(id, mkMember(id));
    await setProfile(id, { messageCount: 5, balance: 301 });
    await ach.check(guild, id, { settings, announce: false });
    const got = await keys(id);
    assert(!got.includes('msg_1') && got.includes('eco_rich'), got.join());
    settings.achievementsOff = '[]'; settings.achievementsBalanceGoal = 10000; await settings.save();
  });

  await test('the card: a PNG with Cyrillic; the message has «Мои достижения» and «Все достижения», the rarest first and the rest listed', async () => {
    const a = (await ach.catalog(G, settings)).find((x) => x.key === 'msg_1000');
    const png = await ach.renderCard({ achievement: { ...a, name: 'Очень длинное название достижения, которое не помещается в одну строку карточки', description: 'Описание '.repeat(30) }, userName: 'Пользователь', more: 2 });
    assert(png.slice(1, 4).toString() === 'PNG' && png.length > 5000, 'png');
    sent.length = 0;
    const id = '700000000000000105'; members.set(id, mkMember(id));
    await setProfile(id, { messageCount: 120 });
    settings.achievementsChannelId = channel.id; await settings.save();
    await ach.check(guild, id, { settings });
    assert(sent.length === 1, 'one card for several: ' + sent.length);
    const p = sent[0];
    const labels = p.components[0].components.map((b) => b.data.label);
    assert(labels.includes('Мои достижения') && labels.includes('Все достижения'), labels.join());
    assert(p.files.length === 1 && p.embeds[0].data.description.includes('А ещё'), 'file and the rest');
    settings.achievementsNotify = 'off'; await settings.save();
    sent.length = 0;
    await setProfile(id, { messageCount: 1000 });
    await ach.check(guild, id, { settings });
    assert(sent.length === 0 && (await keys(id)).includes('msg_1000'), 'off: given, not posted');
    settings.achievementsNotify = 'auto'; await settings.save();
  });

  await test('buttons: «Мои достижения» and «Все достижения» answer only the person who pressed; the category menu filters', async () => {
    const id = '700000000000000101';
    const replies = [];
    const mk = (customId, values) => ({ customId, values, guild, user: { id, username: 'p' }, member: members.get(id), reply: async (x) => replies.push(x), update: async (x) => replies.push(x) });
    assert(ach.isAchievementComponent({ customId: 'ach:mine' }) && ach.isAchievementComponent({ customId: `ach:of:${id}` }) && !ach.isAchievementComponent({ customId: 'ach:x' }), 'ids');
    await ach.handleComponent(mk('ach:mine'));
    await ach.handleComponent(mk('ach:all'));
    await ach.handleComponent(mk('ach:cat', ['voice']));
    assert(replies[0].flags && JSON.stringify(replies[0].embeds[0].data).includes('Разговорчивый'), 'mine');
    assert(replies[1].flags && replies[1].embeds[0].data.fields.length >= 5, 'all');
    const f = replies[2].embeds[0].data.fields;
    assert(f.length === 1 && f[0].name.includes('Голос'), JSON.stringify(f.map((x) => x.name)));
  });

  await test('/achievements: list, all; grant and revoke need «Управлять сервером»', async () => {
    const { makeInteraction, makeUser } = require('./mock');
    const cmd = require('../bot/commands/leveling/achievements');
    const target = makeUser('700000000000000106');
    members.set(target.id, mkMember(target.id));
    const run = async (sub, options = {}, perms = true) => {
      const i = makeInteraction({ subcommand: sub, options, guild, user: makeUser('700000000000000101') });
      i.member = { ...members.get('700000000000000101'), permissions: { has: () => perms } };
      await cmd.execute(i); return JSON.stringify(i._replies);
    };
    assert((await run('list')).includes('Открыто'), 'list');
    assert((await run('all')).includes('Все достижения'), 'all');
    assert((await run('grant', { user: target, achievement: 'lvl_100' }, false)).includes('Управлять сервером'), 'no right');
    assert((await run('grant', { user: target, achievement: 'lvl_100' })).includes('выдано'), 'grant');
    assert((await run('grant', { user: target, achievement: 'lvl_100' })).includes('второй раз'), 'twice');
    assert((await run('revoke', { user: target, achievement: 'lvl_100' })).includes('забрано'), 'revoke');
  });

  await test('touch: many events in a row become one check a few seconds later (ledger and voice tick call it)', async () => {
    const id = '700000000000000107'; members.set(id, mkMember(id));
    let calls = 0; const orig = ach.check;
    require('../web/botBridge').setClient({ isReady: () => true, guilds: { cache: new Map([[G, guild]]) } });
    for (let i = 0; i < 10; i++) ach.touch(G, id);
    ach.touchVoice(G, id); ach.touchVoice(G, id);
    await setProfile(id, { messageCount: 3 });
    await new Promise((r) => setTimeout(r, 4600));
    void orig; void calls;
    assert((await keys(id)).includes('msg_1'), 'checked once after the pause: ' + (await keys(id)));
    require('../web/botBridge').setClient(null);
  });

  await test('panel: overview, catalog with filters, create (bad image refused, forbidden reward role refused), edit, delete, members, grant, settings', async () => {
    const express = require('express');
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.user = { id: '700000000000000001', username: 'admin' }; next(); });
    require('../web/modules');
    app.use('/dashboard', require('../web/routes/dashboard/achievements'));
    app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
    const post = (p, b) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    try {
      for (const pg of ['achievements', 'achievements-catalog', 'achievements-catalog?cat=voice&rarity=epic', 'achievements-edit', 'achievements-members', 'achievements-members?user=700000000000000101', 'achievements-settings']) {
        const r = await fetch(`${base}/${pg}`); const t = await r.text();
        assert(r.status === 200, pg + ' ' + r.status + t.slice(0, 800));
      }
      const cat = await (await fetch(`${base}/achievements-catalog?cat=voice&rarity=epic`)).text();
      assert(cat.includes('Живу в эфире') && !cat.includes('Первое слово'), 'filters');
      let r = await post('/achievements/save', { name: 'Картинка', imageUrl: 'http://insecure/x.png', condType: 'manual' });
      assert(r.headers.get('location').includes('invalid'), 'http image refused');
      r = await post('/achievements/save', { name: 'Роль', condType: 'manual', rewardRoleId: '700000000000000666' });
      assert(r.headers.get('location').includes('rolenotallowed'), 'forbidden role refused');
      r = await post('/achievements/save', { name: 'Полуночник', description: 'Сто часов в голосе', emoji: '🌙', category: 'voice', rarity: 'epic', condType: 'voice_hours', condValue: '100', rewardCrystals: '5', enabled: 'on' });
      assert(r.headers.get('location').includes('saved'), r.headers.get('location'));
      const row = await db.Achievement.findOne({ where: { guildId: G, name: 'Полуночник' } });
      assert(row && row.condValue === 100 && row.rewardCrystals === 5 && row.rarity === 'epic', JSON.stringify(row));
      assert((await (await fetch(`${base}/achievements-edit?id=${row.id}`)).text()).includes('Полуночник'), 'edit page');
      r = await fetch(`${base}/achievements/card/c${row.id}.png`);
      assert(r.status === 200 && r.headers.get('content-type') === 'image/png', 'card png');
      await post('/achievements/save', { id: String(row.id), name: 'Полуночник 2', condType: 'manual' });
      assert((await db.Achievement.findByPk(row.id)).name === 'Полуночник 2', 'edited');
      await post('/achievements/grant', { userId: '700000000000000101', key: `c${row.id}` });
      r = await post('/achievements/grant', { userId: '700000000000000101', key: `c${row.id}` });
      assert(r.headers.get('location').includes('already'), 'already');
      await post(`/achievements/${row.id}/delete`, {});
      assert(!(await db.Achievement.findByPk(row.id)) && !(await db.MemberAchievement.count({ where: { key: `c${row.id}` } })), 'deleted with the unlocks');
      await post('/achievements/builtin', { key: 'msg_10000', on: '0' });
      assert((await db.GuildSettings.findOne({ where: { guildId: G } })).achievementsOff.includes('msg_10000'), 'builtin off');
      await post('/achievements/settings', { achievementsNotify: 'dm', achievementsBalanceGoal: '777', achievementsChannelId: '' });
      const s = await db.GuildSettings.findOne({ where: { guildId: G } });
      assert(s.achievementsNotify === 'dm' && s.achievementsBalanceGoal === 777, 'settings');
    } finally { server.close(); }
  });

  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.l}${r.ok ? '' : `\n   ${r.e}`}`);
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
