// English: every Russian text of the bot and the panel has a translation; servers set to English get messages, embeds,
// buttons, modals and pictures in English; the panel renders in English for viewers who chose it; slash commands carry
// English descriptions for English Discord clients.
process.env.DATABASE_PATH = './data/test_i18n.sqlite';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const d = require('discord.js');
const G = '777000000000000001', CH = '800000000000000001', R1 = '600000000000000001';
const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('middleware/ensureAuth.js', { ensureAuth: (q, s, n) => n() });
stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.guildAccess = { owner: true }; n(); } });
stub('discordApi.js', {
  getBotGuildIds: async () => new Set([G]), getBotGuilds: async () => new Map([[G, { id: G, name: 'Night Club', icon: null }]]), getUsers: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: 'Alice' }])),
  getGuildChannels: async () => [{ id: CH, name: 'general', type: 0 }, { id: '800000000000000002', name: 'Lobby', type: 2 }, { id: '800000000000000003', name: 'Games', type: 4 }, { id: '800000000000000004', name: 'logs', type: 15 }],
  getGuildRoles: async () => [{ id: R1, name: 'Members', position: 1 }],
  getGuild: async (id) => ({ id, name: 'Night Club', icon: null, approximate_member_count: 10 }),
  botApi: { get: require('./ownerGuild').ownerGet(G, [R1]), post: async () => ({ data: {} }), delete: async () => ({}), put: async () => ({}) }
});
// stand-ins for Discord's own send/reply: the translator wraps whatever is there, so the payload it hands over can be checked
const sent = [];
for (const [cls, m] of [[d.BaseGuildTextChannel, 'send'], [d.DMChannel, 'send'], [d.CommandInteraction, 'reply'], [d.MessageComponentInteraction, 'update'], [d.CommandInteraction, 'showModal'], [d.MessageManager, 'edit']]) {
  cls.prototype[m] = async function (...args) { sent.push({ m, args }); return args; };
}
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

(async () => {
  const db = require('../db'); await db.init();
  const i18n = require('../i18n');
  const client = { guilds: { cache: new Map([['GEN', { preferredLocale: 'en-US' }], ['GRU', { preferredLocale: 'ru' }]]) }, emit() { return true; } };
  require('../i18n/discord').install(client);

  await test('every Russian text of the bot, the panel and its scripts has an English translation', async () => {
    const m = require('../i18n/check').missing();
    assert.strictEqual(m.length, 0, m.slice(0, 5).map((x) => `${x.file}: ${x.text}`).join(' | '));
    const EN = require('../i18n/en.json');
    const tk = (s) => (s.match(/⟦\d+⟧|\{\d+\}|\{[a-zA-Z]+\}/g) || []).sort().join();
    const bad = Object.entries(EN).filter(([ru, en]) => tk(ru) !== tk(en));
    assert.strictEqual(bad.length, 0, 'placeholders kept: ' + bad.slice(0, 3).map(([k]) => k).join(' | '));
  });

  await test('texts built from parts are translated: templates, joined lines, glued phrases; names stay', async () => {
    const t = (s) => i18n.toEnglish(s, true);
    assert.strictEqual(t('Розыгрыш №5 начался в <#1> и закончится через 1 д.'), 'Giveaway #5 has started in <#1> and ends in 1 д.'.replace(' д', ' д'));
    assert.strictEqual(t('Уровень <@1>: 3 → **5**.\nРоли за уровни обновлены.'), 'Level of <@1>: 3 → **5**.\nLevel roles updated.');
    assert.strictEqual(t('Добро пожаловать, <@1>, на сервере **Клуб**!'), 'Welcome, <@1>, to **Клуб**!', 'the server name stays');
    assert.strictEqual(t('⚠️ <@1>, сообщение удалено: запрещённое слово. Выдано: мут на 10 мин.'), '⚠️ <@1>, your message was deleted: a banned word. Given: mute for 10 min.');
    assert.strictEqual(t('Вася'), 'Вася'); assert.strictEqual(t('> магазин'), '> магазин', 'quoted words of people stay');
    assert.strictEqual(i18n.toEnglish('магазин', false), 'shop'); assert.strictEqual(i18n.toEnglish('Мой магазин', false), 'Мой магазин', 'without loose: only whole known texts');
  });

  await test('server language: chosen in the panel, or by the server\'s Discord language; defaults switch, own texts stay', async () => {
    i18n.setGuildLang('GEN', 'auto'); i18n.setGuildLang('GRU', 'auto'); i18n.setGuildLang('X', 'en'); i18n.setGuildLang('Y', 'ru');
    assert.deepStrictEqual(['GEN', 'GRU', 'X', 'Y'].map(i18n.langOf), ['en', 'ru', 'en', 'ru']);
    const row = await db.GuildSettings.create({ guildId: 'S1', welcomeMessage: 'Мой текст' });
    assert.strictEqual(row.language, 'auto', 'a new server follows Discord');
    const { switchDefaults } = require('../i18n/settings');
    const changed = switchDefaults(row, 'en');
    assert(changed.includes('leaveMessage') && changed.includes('currencyName') && row.currencyName === 'coins' && row.welcomeMessage === 'Мой текст', JSON.stringify(changed));
    switchDefaults(row, 'ru'); assert.strictEqual(row.currencyName, 'монеты');
    row.language = 'en'; await row.save(); assert.strictEqual(i18n.langOf('S1'), 'en', 'the map follows the database');
  });

  await test('everything the bot sends on an English server is English: embeds, buttons, menus, modals; names, links and typed values stay', async () => {
    sent.length = 0;
    const ch = Object.create(d.TextChannel.prototype); Object.defineProperty(ch, 'guildId', { value: 'X' });
    const embed = new d.EmbedBuilder().setTitle('Покупка совершена').setDescription('Ваш баланс: 10 монеты · 2 кристаллы').addFields({ name: 'Ваш товар', value: 'Ключ: абв' }).setFooter({ text: 'Остаток: 5 монеты' }).setURL('https://x.ru/путь');
    const row = new d.ActionRowBuilder().addComponents(new d.ButtonBuilder().setCustomId('shop:buy:1').setLabel('Купить').setStyle(1), new d.ButtonBuilder().setCustomId('c').setLabel('Отмена').setStyle(2));
    const menu = new d.ActionRowBuilder().addComponents(new d.StringSelectMenuBuilder().setCustomId('m').setPlaceholder('Выберите, что купить').addOptions({ label: 'Мои покупки', value: 'мои', description: 'Таблица лидеров' }));
    await ch.send({ content: 'Магазин', embeds: [embed], components: [row, menu] });
    const p = sent[0].args[0]; const e = p.embeds[0];
    assert(p.content === 'Shop' && e.title === 'Purchase complete' && e.description === 'Your balance: 10 coins · 2 crystals' && e.fields[0].name === 'Your item' && e.footer.text === 'Left: 5 coins' && e.url === 'https://x.ru/путь', JSON.stringify(p));
    assert(e.fields[0].value === 'Ключ: абв', 'what the admin wrote (a key) stays');
    assert(p.components[0].components[0].label === 'Buy' && p.components[0].components[0].custom_id === 'shop:buy:1' && p.components[1].components[0].placeholder === 'Choose what to buy' && p.components[1].components[0].options[0].value === 'мои', JSON.stringify(p.components));
    const ru = Object.create(d.TextChannel.prototype); Object.defineProperty(ru, 'guildId', { value: 'Y' });
    await ru.send({ content: 'Магазин' }); assert.strictEqual(sent[1].args[0].content, 'Магазин', 'Russian servers are untouched');
  });

  await test('interactions: the server\'s language; in DMs the person\'s Discord language; modal fields keep what was typed', async () => {
    sent.length = 0;
    const it = Object.create(d.ChatInputCommandInteraction.prototype); Object.defineProperty(it, 'guildId', { value: 'X' });
    await it.reply({ content: 'Участник не найден.', flags: 64 });
    const dm = Object.create(d.ChatInputCommandInteraction.prototype); Object.defineProperties(dm, { guildId: { value: null }, locale: { value: 'en-GB' } });
    await dm.reply('Эта команда работает только на сервере.');
    const modal = new d.ModalBuilder().setCustomId('m').setTitle('Новый вебхук').addComponents(new d.ActionRowBuilder().addComponents(new d.TextInputBuilder().setCustomId('n').setLabel('Имя (до 32 символов)').setStyle(1).setValue('Новости')));
    await it.showModal(modal);
    assert.strictEqual(sent[0].args[0].content, 'Member not found.');
    assert.strictEqual(sent[1].args[0], 'This command only works on a server.');
    const m = sent[2].args[0]; const input = m.components[0].components[0];
    assert(m.title === 'New webhook' && input.label === 'Name (up to 32 characters)' && input.value === 'Новости', JSON.stringify(m));
  });

  await test('events run "inside" their server: DMs and durations follow its language; pictures are drawn in English', async () => {
    const seen = [];
    const fake = { emit(event, ...a) { seen.push([i18n.currentLang(), require('../bot/utils/duration').formatDuration(90 * 60000)]); return true; }, guilds: client.guilds };
    require('../i18n/discord').install(fake);
    fake.emit('messageCreate', { guildId: 'X' }); fake.emit('messageCreate', { guildId: 'Y' });
    assert.deepStrictEqual(seen, [['en', '1 h 30 min'], ['ru', '1 ч 30 мин']]);
    const { createCanvas } = require('@napi-rs/canvas'); const ctx = createCanvas(10, 10).getContext('2d');
    const drawn = []; const realMeasure = Object.getPrototypeOf(ctx).measureText;
    i18n.runWith({ guildId: 'X', lang: null }, () => drawn.push(ctx.measureText('уровень').width, ctx.measureText('level').width));
    assert.strictEqual(drawn[0], drawn[1], 'the same width: the word was drawn in English');
    assert(realMeasure.__i18n);
  });

  await test('slash commands: English descriptions and choice names for English clients; Russian stays the default', async () => {
    const { localizeCommand } = require('../i18n/discord');
    const { loadCommands } = require('../bot/handlers/loadCommands');
    let checked = 0;
    for (const c of loadCommands().values()) {
      const j = localizeCommand(c.data.toJSON());
      const walk = (o) => {
        if (o.description && /[А-Яа-яЁё]/.test(o.description)) { assert(o.description_localizations?.['en-US'] && o.description_localizations['en-US'].length <= 100 && !/[А-Яа-яЁё]/.test(o.description_localizations['en-US']), `${j.name}: ${o.description}`); checked++; }
        (o.choices || []).forEach((ch) => { if (/[А-Яа-яЁё]/.test(ch.name)) assert(ch.name_localizations?.['en-US'], ch.name); });
        (o.options || []).forEach(walk);
      };
      walk(j);
    }
    assert(checked > 100, 'descriptions checked: ' + checked);
    // names stay English for everyone: no translated command, menu or option names
    for (const c of loadCommands().values()) {
      const j = localizeCommand(c.data.toJSON());
      const walk = (o) => { assert(!o.name_localizations || o.value !== undefined, `${j.name}: name ${o.name} is localized`); assert(!/[А-Яа-яЁё]/.test(o.name) || o.value !== undefined, o.name); (o.options || []).forEach(walk); };
      walk(j);
    }
  });

  // ---------- panel ----------
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views'));
  Object.assign(app.locals, { assetV: 'x', tplRef: require('../bot/utils/replacers').REFERENCE, termText: require('../bot/utils/duration').formatTerm, errorTexts: require('../bot/utils/discordErrors').ERROR_TEXT });
  const pi = require('../web/i18n');
  app.use(pi.englishScripts); app.use(express.static(path.join(__dirname, '..', 'web', 'public')));
  app.use((q, r, n) => { r.locals.reqPath = q.originalUrl; n(); });
  app.use(pi.panelLanguage); app.get('/lang/:lang', pi.switchLanguage);
  app.use(express.urlencoded({ extended: true })); app.use(require('./ownerGuild').asOwner);
  app.use('/dashboard', require('../web/routes/dashboard'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, lang) => fetch(base + p, { headers: lang ? { cookie: `lang=${lang}` } : {} }).then(async (r) => ({ status: r.status, text: await r.text() }));
  await db.GuildSettings.findOrCreate({ where: { guildId: G } });

  await test('panel in English: every page renders, with no Russian left outside names of the server', async () => {
    const pages = ['overview', 'features', 'leveling', 'economy', 'channel-boosts', 'shop', 'leaderboard', 'moderation', 'logs', 'automod', 'welcome', 'level-roles', 'reaction-roles', 'interactive', 'starboard', 'custom-commands', 'temp-voice', 'alerts', 'webhooks', 'changelog'];
    const left = {};
    for (const p of pages) {
      const r = await get(`/dashboard/${G}${p === 'overview' ? '' : '/' + p}`, 'en');
      assert.strictEqual(r.status, 200, p + ' ' + (r.text.match(/<pre>[\s\S]*?<\/pre>|Error[^<]{0,400}/) || [r.text.slice(0, 300)])[0]);
      const visible = r.text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
      const words = visible.match(/[А-Яа-яЁё][А-Яа-яЁё\s.,«»—-]*/g) || [];
      const real = words.map((w) => w.trim()).filter((w) => w && !/^Русский$/.test(w));
      if (real.length) left[p] = real.slice(0, 4);
    }
    // the changelog is history written in Russian (data), the rest must be clean
    delete left.changelog;
    assert.deepStrictEqual(left, {}, JSON.stringify(left));
  });

  await test('panel: Russian by default for Russian browsers, English for others; the switch remembers and only goes back to this site', async () => {
    const ru = await fetch(`${base}/dashboard/${G}/features`, { headers: { 'accept-language': 'ru-RU,ru;q=0.9' } }).then((r) => r.text());
    const en = await fetch(`${base}/dashboard/${G}/features`, { headers: { 'accept-language': 'en-US,en;q=0.9' } }).then((r) => r.text());
    assert(ru.includes('Функции') && en.includes('Bot language on the server') && en.includes('<html lang="en">'), 'by browser');
    const r = await fetch(`${base}/lang/en?next=/dashboard/${G}/shop`, { redirect: 'manual' });
    assert(r.headers.get('set-cookie').includes('lang=en') && r.headers.get('location') === `/dashboard/${G}/shop`);
    for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) assert.strictEqual((await fetch(`${base}/lang/en?next=${encodeURIComponent(evil)}`, { redirect: 'manual' })).headers.get('location'), '/', evil);
    assert(en.includes('/lang/ru?next=') && ru.includes('/lang/en?next='), 'the switch link');
  });

  await test('panel: scripts in English for English pages, the language of the bot is saved with the default texts', async () => {
    const js = await get('/js/ui.js?v=x-en'); const jsRu = await get('/js/ui.js?v=x');
    assert(js.text.includes('Section or setting: shop, pause, swearing') && jsRu.text.includes('Раздел или настройка: магазин'), 'translated script');
    const page = await get(`/dashboard/${G}/features`, 'en'); assert(page.text.includes('/js/ui.js?v=x-en'), 'English pages ask for English scripts');
    const loc = await fetch(`${base}/dashboard/${G}/language`, { method: 'POST', body: new URLSearchParams({ language: 'en' }), redirect: 'manual' }).then((x) => x.headers.get('location'));
    assert(loc.includes('saved'));
    const s = await db.GuildSettings.findByPk(G);
    assert(s.language === 'en' && s.welcomeMessage === 'Welcome, {user}, to **{server}**!' && s.crystalName === 'crystals', s.welcomeMessage);
    assert.strictEqual(i18n.langOf(G), 'en');
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
