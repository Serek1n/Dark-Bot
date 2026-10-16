// Level-up announcements: a member sitting in a voice channel gets them in that channel's chat.
process.env.DATABASE_PATH = './data/test_levelup.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [{ id: '123456789012345678', name: 'chat', type: 0 }], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');
const { makeGuild, makeChannel, makeMember, makeUser, makeMessage } = require('./mock_events');

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings } = db;
  const messageCreate = require('../bot/events/messageCreate');
  const { xpTick } = require('../bot/modules/voiceTime');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  let n = 0;
  // A server with a text channel, a configured level-up channel and a voice channel (with its own chat).
  const world = async (settings = {}, { voiceSend, voiceId = 'VC1', voicePerms } = {}) => {
    const id = 'lu' + ++n;
    const guild = makeGuild({ id, afkChannelId: 'AFK1' });
    const text = makeChannel('T1'); const announce = makeChannel('A1');
    const voice = makeChannel(voiceId, { type: 2, isTextBased: () => true, ...(voiceSend ? { send: voiceSend } : {}), ...(voicePerms ? { permissionsFor: () => ({ has: () => voicePerms === 'ok' }) } : {}) });
    [text, announce, voice].forEach((c) => guild._channelsById.set(c.id, c));
    guild.channels.cache = guild._channelsById;
    await GuildSettings.create({ guildId: id, xpPerMessageMin: 999999, xpPerMessageMax: 999999, xpCooldownSeconds: 0, ...settings });
    return { guild, text, announce, voice };
  };
  const say = async (w, member) => {
    const msg = makeMessage({ guild: w.guild, channel: w.text, content: 'hi', author: makeUser('u' + ++n), member: undefined });
    msg.member = member ? member(msg.author) : null;
    await messageCreate.execute(msg);
  };
  const inVoice = (guild, channel) => (author) => makeMember(author.id, guild, { voice: { channel } });

  await test('message level-up while sitting in a voice channel goes to that channel\'s chat only', async () => {
    const w = await world({ levelUpChannelId: 'A1' });
    await say(w, inVoice(w.guild, w.voice));
    assert(w.voice._sent.length === 1 && w.text._sent.length === 0 && w.announce._sent.length === 0, [w.voice._sent.length, w.text._sent.length, w.announce._sent.length].join());
    assert(JSON.stringify(w.voice._sent[0]).includes('повышением уровня'), 'it is the level-up card');
  });
  await test('not in voice: the configured level-up channel, or the channel of the message when none is set', async () => {
    const w = await world({ levelUpChannelId: 'A1' }); await say(w, null);
    assert(w.announce._sent.length === 1 && !w.voice._sent.length, 'configured channel');
    const w2 = await world({}); await say(w2, (a) => makeMember(a.id, w2.guild, { voice: { channel: null } }));
    assert(w2.text._sent.length === 1, 'message channel');
  });
  await test('the setting can be switched off: back to the usual channel', async () => {
    const w = await world({ levelUpChannelId: 'A1', levelUpInVoice: false }); await say(w, inVoice(w.guild, w.voice));
    assert(w.announce._sent.length === 1 && !w.voice._sent.length, 'usual channel');
  });
  await test('the AFK channel is ignored', async () => {
    const w = await world({ levelUpChannelId: 'A1' }, { voiceId: 'AFK1' }); await say(w, inVoice(w.guild, w.voice));
    assert(w.announce._sent.length === 1 && !w.voice._sent.length, 'AFK chat is not used');
  });
  await test('no right to write in the voice chat: the usual channel is used', async () => {
    const w = await world({ levelUpChannelId: 'A1' }, { voicePerms: 'no' }); await say(w, inVoice(w.guild, w.voice));
    assert(w.announce._sent.length === 1 && !w.voice._sent.length, 'no permission');
  });
  await test('sending to the voice chat fails (chat closed): the usual channel still gets the message', async () => {
    const w = await world({ levelUpChannelId: 'A1' }, { voiceSend: async () => { throw new Error('Missing Access'); } });
    await say(w, inVoice(w.guild, w.voice));
    assert(w.announce._sent.length === 1, 'fallback received it');
    const w2 = await world({}, { voiceSend: async () => { throw new Error('Missing Access'); } }); await say(w2, inVoice(w2.guild, w2.voice));
    assert(w2.text._sent.length === 1, 'no configured channel: the channel of the message');
  });
  await test('voice level-up (the once-a-minute payout) is announced in the voice channel\'s chat', async () => {
    const w = await world({ levelUpChannelId: 'A1', voiceXpPerMinute: 500, voiceMinMembers: 1 });
    const member = makeMember('vm1', w.guild, { user: { id: 'vm1', bot: false, username: 'vm1' }, voice: { deaf: false, channel: w.voice } });
    w.voice.isVoiceBased = () => true; w.voice.members = new Map([['vm1', member]]); w.voice.parentId = null;
    const client = { guilds: { cache: new Map([[w.guild.id, w.guild]]) } };
    await xpTick(client);
    assert(w.voice._sent.length === 1 && !w.announce._sent.length, `voice ${w.voice._sent.length} announce ${w.announce._sent.length}`);
    // switched off: the configured channel
    await GuildSettings.update({ levelUpInVoice: false }, { where: { guildId: w.guild.id } });
    const { getOrCreateSettings } = require('../bot/modules/leveling'); await new Promise((r) => setTimeout(r, 10));
    require('../bot/modules/leveling'); // cache is cleared by the save hook
    await db.MemberProfile.update({ voiceXp: 0, xp: 0, level: 0 }, { where: { guildId: w.guild.id } });
    await xpTick(client);
    assert(w.announce._sent.length === 1, 'configured channel when switched off');
    assert(getOrCreateSettings, 'settings loader exists');
  });

  // ---- the panel switch ----
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/777000000000000001`;
  const post = (body) => fetch(base + '/leveling', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  await test('panel: the switch is on by default, can be saved off and on again', async () => {
    let html = await (await fetch(base + '/leveling')).text();
    assert(/name="levelUpInVoice"[^>]*checked/.test(html), 'on by default');
    await post({ levelingEnabled: 'on' });
    html = await (await fetch(base + '/leveling')).text(); assert(!/name="levelUpInVoice"[^>]*checked/.test(html), 'saved off');
    assert((await GuildSettings.findByPk('777000000000000001')).levelUpInVoice === false, 'db off');
    await post({ levelingEnabled: 'on', levelUpInVoice: 'on' });
    assert((await GuildSettings.findByPk('777000000000000001')).levelUpInVoice === true, 'db on');
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
