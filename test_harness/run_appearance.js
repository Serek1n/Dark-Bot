// «Оформление»: the theme of the pictures, a picture / a text / both for each kind of message, the panel page and its previews.
process.env.DATABASE_PATH = './data/test_appearance.sqlite';
const fs = require('fs'); const path = require('path');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => n() });
stub('discordApi.js', { getBotGuildIds: async () => [], getGuildChannels: async () => [], getGuildRoles: async () => [], getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), botApi: {} });
const express = require('express');

const PNG = (b) => Buffer.isBuffer(b) && b.slice(1, 4).toString() === 'PNG';

(async () => {
  const db = require('../db'); await db.init();
  const { GuildSettings } = db;
  const ap = require('../bot/modules/appearance');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await test('defaults: the old look (DARK, level-up as text, profile and top as pictures, achievement both)', async () => {
    const l = ap.read(null);
    assert(l.theme === 'dark' && !l.accent, 'theme');
    assert(!l.targets.levelUp.card && l.targets.levelUp.text && l.targets.profile.card && !l.targets.profile.text && l.targets.achievement.card && l.targets.achievement.text, 'parts');
    assert(ap.embedColor(l) === 0xe3a857, 'frame colour');
  });

  await test('the form: picture and text are independent, never both off; tabs keep the other kinds; the theme only when sent', async () => {
    const s = { appearance: '{}', levelUpEmbed: true };
    ap.applyForm(s, { theme: 'neon', accentOn: 'on', accent: '#33DDEE' }, []);
    let l = ap.read(s);
    assert(l.theme === 'neon' && l.accent === '#33ddee', 'theme saved');
    assert(l.targets.profile.card && !l.targets.levelUp.card, 'kinds untouched by the theme tab');
    ap.applyForm(s, { levelUp_card: 'on', levelUp_text: 'on', levelUp_headline: ' LEVEL UP! ', profile_text: 'on', top_card: 'on' }, ['levelUp', 'profile', 'top']);
    l = ap.read(s);
    assert(l.theme === 'neon', 'theme kept by a tab form');
    assert(l.targets.levelUp.card && l.targets.levelUp.text && l.targets.levelUp.headline === 'LEVEL UP!', 'both on');
    assert(!l.targets.profile.card && l.targets.profile.text, 'profile as text');
    assert(s.levelUpEmbed === false && !l.targets.levelUp.frame, 'the frame of the level-up is the same switch as on «Уровни»');
    ap.applyForm(s, {}, ['fun']);
    assert(ap.read(s).targets.fun.text && !ap.read(s).targets.fun.card, 'nothing ticked: the text stays');
    ap.applyForm(s, { theme: 'nope', accent: 'red' }, []);
    assert(ap.read(s).theme === 'dark' && !ap.read(s).accent, 'unknown theme and a bad colour are refused');
  });

  await test('palettes: every theme gives the card colours; a light theme draws dark text', async () => {
    for (const key of Object.keys(ap.THEMES)) {
      const c = ap.palette({ theme: key });
      for (const k of ['bg', 'panel', 'raised', 'hairline', 'paper', 'fog', 'ember', 'emberDeep', 'emberLight', 'track']) assert(/^#[0-9a-f]{6}$/i.test(c[k]), `${key}.${k} = ${c[k]}`);
    }
    assert(ap.palette({ theme: 'light' }).light && !ap.palette({ theme: 'dark' }).light, 'light flag');
    assert(ap.palette({ theme: 'dark', accent: '#33ddee' }).ember === '#33ddee', 'own accent');
    assert(Object.keys(ap.THEMES).length % 4 === 0, 'the theme cards fill whole rows (4 on a computer, 2 on a phone)');
  });

  await test('the pictures are drawn in every theme: level-up, mini-games, profile, top, achievement, welcome', async () => {
    const cards = require('../bot/modules/lookCards'); const rank = require('../bot/modules/rankCard');
    for (const theme of ['dark', 'light']) {
      const colors = ap.palette({ theme });
      assert(PNG(await cards.renderLevelUpCard({ username: 'Тест', level: 12, oldLevel: 11, reward: '+3 кристаллы', colors })), 'level-up');
      for (const g of [{ game: 'dice', rolls: [1, 6, 3, 2, 5, 4], sides: 6 }, { game: 'dice', rolls: [99], sides: 100 }, { game: 'coinflip', heads: false }, { game: '8ball', question: 'Да?', answer: 'Да.', mood: 'good' }, { game: 'rps', you: 'paper', bot: 'paper', result: 'draw' }]) {
        assert(PNG(await cards.renderGameCard({ ...g, player: 'Тест', colors })), g.game);
      }
      assert(PNG(await rank.renderRankCard({ username: 'Тест', level: 3, xpIntoLevel: 1, xpNeeded: 10, balance: 1, messageCount: 1, colors })), 'profile');
      assert(PNG(await rank.renderLeaderboard({ heading: 'Топ', title: 'T', rows: [{ rank: 1, name: 'A', level: 2, xp: 30 }], colors })), 'top');
      assert(PNG(await require('../bot/modules/achievements').renderCard({ achievement: { name: 'A', description: 'B', rarity: 'rare', category: 'messages' }, userName: 'Т', colors, headline: 'УРА' })), 'achievement');
      assert(PNG(await require('../bot/modules/welcomeCard').renderWelcomeCard({ username: 'Т', serverName: 'S', memberCount: 5, colors })), 'welcome');
    }
  });

  // ---- the level-up message ----
  const guild = { id: 'g-look', name: 'Сервер', members: { me: {} }, roles: { cache: new Map() }, iconURL: () => null, channels: { cache: new Map() } };
  const user = { id: '700000000000000001', username: 'tester', displayAvatarURL: () => null };
  const announce = async (look, extra = {}) => {
    const sent = []; const channel = { send: async (p) => { sent.push(p); }, permissionsFor: () => ({ has: () => true }) };
    const settings = { levelUpEmbed: true, levelUpDestination: 'auto', ...extra };
    if (look) ap.applyForm(settings, look, ['levelUp']);
    await require('../bot/utils/levelUp').announceLevelUp({ guild, user, displayName: 'Тест', level: 5, oldLevel: 4, channel, crystals: 2, crystalName: 'кристаллы', settings });
    return sent[0];
  };
  await test('level-up: text in a frame by default; picture only; both — the picture inside the framed text; plain text with the picture', async () => {
    let p = await announce(null);
    assert(p.embeds?.length === 1 && !p.files, 'default: a framed text');
    p = await announce({ levelUp_card: 'on', levelUp_frame: 'on' });
    assert(p.files?.length === 1 && !p.embeds && !p.content, 'picture only');
    p = await announce({ levelUp_card: 'on', levelUp_text: 'on', levelUp_frame: 'on' });
    assert(p.files?.length === 1 && p.embeds[0].toJSON().image?.url === 'attachment://levelup.png', 'both: picture inside the frame');
    p = await announce({ levelUp_card: 'on', levelUp_text: 'on' });
    assert(p.files?.length === 1 && typeof p.content === 'string' && !p.embeds, 'plain text with the picture');
    p = await announce({ levelUp_text: 'on', levelUp_frame: 'on' }, { appearance: JSON.stringify({ theme: 'forest' }) });
    assert(p.embeds[0].toJSON().color === parseInt(ap.THEMES.forest.accent.slice(1), 16), 'the frame takes the colour of the theme');
  });

  await test('a picture needs the right to attach files there', async () => {
    const sent = []; const channel = { send: async (p) => { sent.push(p); }, permissionsFor: () => ({ has: (list) => !list.includes('AttachFiles') }) };
    const settings = { levelUpEmbed: true }; ap.applyForm(settings, { levelUp_card: 'on' }, ['levelUp']);
    await require('../bot/utils/levelUp').announceLevelUp({ guild, user, displayName: 'Тест', level: 5, channel, settings });
    assert(!sent.length, 'not sent where it can not be posted whole');
  });

  // ---- mini-games ----
  const play = async (sub, extra = {}) => {
    let reply = null;
    const opts = { getSubcommand: () => sub, getInteger: () => null, getString: (k) => (k === 'choice' ? 'rock' : 'Вопрос?') };
    await require('../bot/commands/fun/fun').execute({ guildId: 'g-fun', options: opts, member: { displayName: 'Тест' }, user: { username: 't' }, reply: async (p) => { reply = p; }, ...extra });
    return reply;
  };
  await test('mini-games: text in a frame by default; a picture, both, plain text — as set for the server', async () => {
    let r = await play('dice');
    assert(r.embeds?.length === 1 && !r.files.length, 'default text');
    const row = await GuildSettings.create({ guildId: 'g-fun' });
    ap.applyForm(row, { fun_card: 'on' }, ['fun']); await row.save(); ap.forget('g-fun');
    r = await play('coinflip');
    assert(r.files.length === 1 && !r.embeds, 'picture only');
    ap.applyForm(row, { fun_card: 'on', fun_text: 'on', fun_frame: 'on' }, ['fun']); await row.save(); ap.forget('g-fun');
    r = await play('8ball');
    assert(r.files.length === 1 && r.embeds[0].toJSON().image?.url === 'attachment://game.png', 'both');
    ap.applyForm(row, { fun_text: 'on' }, ['fun']); await row.save(); ap.forget('g-fun');
    r = await play('rps');
    assert(typeof r.content === 'string' && r.content.includes('Бот') && !r.embeds, 'plain text');
  });

  // ---- the room panel ----
  await test('room panel: own icons or emojis, lines with names, names on buttons, own title and text, colour of the theme', async () => {
    const room = require('../bot/modules/voiceRoom');
    const s = { appearance: '{}' };
    ap.applyForm(s, { theme: 'ocean' }, []);
    ap.applyForm(s, { voicePanel_labels: 'on', voicePanel_text: 'on', voicePanel_headline: 'Моя комната', voicePanel_intro: 'Жмите кнопки' }, ['voicePanel']);
    const box = room.panelPayload({ look: ap.read(s) }).components[0].toJSON();
    const json = JSON.stringify(box);
    assert(box.accent_color === parseInt(ap.THEMES.ocean.accent.slice(1), 16), 'colour');
    assert(json.includes('Моя комната') && json.includes('Жмите кнопки'), 'texts');
    const buttons = box.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert(buttons.length === 15 && buttons.every((b) => b.label && b.emoji && !b.emoji.id), 'names on buttons, ordinary emojis while own icons are off');
    const plain = room.panelPayload({ look: ap.read({ appearance: JSON.stringify({ targets: { voicePanel: { card: true, text: false } } }) }) }).components[0].toJSON();
    assert(!JSON.stringify(plain).includes('Название'), 'no lines with names when the text is off');
  });

  // ---- the panel page ----
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard'));
  app.use((err, req, res, next) => res.status(500).send(String(err.stack)));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/dashboard/777000000000000002`;
  await test('panel: «Оформление» in «Настройки панели» with five tabs; saving a tab keeps the theme; the previews are PNG', async () => {
    const M = require('../web/modules');
    assert(M.SYSTEM_GROUP[0] === 'system' && M.MODULES.find((m) => m.key === 'appearance').group === 'system', 'in the system block');
    for (const p of ['appearance', 'appearance-levels', 'appearance-achievements', 'appearance-fun', 'appearance-voice']) {
      const r = await fetch(`${base}/${p}`); assert(r.status === 200, p + ' ' + r.status + ' ' + (await r.text()).slice(0, 300));
    }
    const post = (page, body) => fetch(`${base}/${page}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    let r = await post('appearance', { theme: 'crimson' }); assert(r.status === 302, 'saved');
    r = await post('appearance-fun', { fun_card: 'on', fun_text: 'on' }); assert(r.status === 302, 'tab saved');
    const l = ap.read(await GuildSettings.findByPk('777000000000000002'));
    assert(l.theme === 'crimson' && l.targets.fun.card && l.targets.fun.text && !l.targets.fun.frame, 'stored');
    const html = await (await fetch(`${base}/appearance`)).text();
    assert(/value="crimson"[^>]*checked/.test(html), 'theme ticked on the page');
    for (const k of ['levelup', 'profile', 'top', 'achievement', 'dice', 'coin', '8ball', 'rps']) {
      const res = await fetch(`${base}/appearance/preview/${k}.png?theme=light&accent=33ddee&headline=Hi`);
      assert(res.status === 200 && res.headers.get('content-type') === 'image/png' && PNG(Buffer.from(await res.arrayBuffer())), 'preview ' + k);
    }
    assert((await fetch(`${base}/appearance/preview/nope.png`)).status === 404, 'unknown preview');
  });
  server.close();

  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
