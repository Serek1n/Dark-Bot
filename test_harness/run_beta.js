// Beta mode: beta features work only where "Бета-функции" is on; the panel shows the switch and tags.
process.env.BOT_CHANNEL = 'beta'; // these tests are about the beta build
require('./betaFeature'); // treat the webhooks as a beta feature in this test
process.env.DATABASE_PATH = './data/test_beta.sqlite';
const fs = require('fs'); const path = require('path'); const ejs = require('ejs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { MessageFlags } = require('discord.js');

(async () => {
  const db = require('../db'); await db.init();
  const F = require('../bot/utils/features');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await test('a beta feature is off until the server switches beta on; ordinary features are not affected', async () => {
    const off = { webhooksEnabled: true, betaEnabled: false, levelingEnabled: true }; const on = { ...off, betaEnabled: true };
    assert(!F.isEnabled(off, 'webhooks') && F.isEnabled(on, 'webhooks'), 'webhooks follow beta');
    assert(!F.isEnabled({ ...on, webhooksEnabled: false }, 'webhooks'), 'still can be switched off inside beta');
    assert(F.isEnabled(off, 'leveling') && F.isEnabled(on, 'leveling'), 'ordinary feature unchanged');
    assert(!F.isEnabled(null, 'webhooks') && F.isEnabled(null, 'leveling'), 'no settings row');
  });
  await test('the message for a refused beta feature says how to get it; an ordinary one says it is off', async () => {
    assert(F.disabledText({ betaEnabled: false }, 'webhooks').includes('бета-функция') && F.disabledText({ betaEnabled: false }, 'webhooks').includes('Бета-функции'), 'beta text');
    assert(F.disabledText({ betaEnabled: true }, 'webhooks').includes('отключена') && F.disabledText({}, 'leveling').includes('отключена'), 'ordinary text');
  });
  await test('slash command of a beta feature is refused with the explanation, then works after the switch', async () => {
    const { GuildSettings } = db; await GuildSettings.create({ guildId: 'B1' });
    const ev = require('../bot/events/interactionCreate'); const replies = []; let ran = 0;
    const mk = () => ({ isChatInputCommand: () => true, isAutocomplete: () => false, isContextMenuCommand: () => false, isButton: () => false, isModalSubmit: () => false, isAnySelectMenu: () => false, isStringSelectMenu: () => false, isMessageContextMenuCommand: () => false,
      commandName: 'webhook', guildId: 'B1', client: { commands: new Map([['webhook', { execute: async () => { ran++; } }]]) }, reply: async (x) => replies.push(x), replied: false, deferred: false });
    await ev.execute(mk());
    assert(ran === 0 && JSON.stringify(replies).includes('бета-функция') && replies[0].flags === MessageFlags.Ephemeral, 'refused: ' + JSON.stringify(replies));
    await GuildSettings.update({ betaEnabled: true }, { where: { guildId: 'B1' } }); require('../bot/modules/leveling').getOrCreateSettings; // cache is cleared by the save hook
    await ev.execute(mk()); assert(ran === 1, 'allowed after the switch');
  });
  await test('features page: the beta switch comes first, beta features carry a tag, saving stores it', async () => {
    const html = await ejs.renderFile(path.join(__dirname, '..', 'web/views/dashboard/features.ejs'), { guild: { id: '123456789012345678', name: 'T', icon: null }, settings: { betaEnabled: true, webhooksEnabled: true }, features: F.FEATURES, betaBuild: true, active: 'features', betaPages: F.betaPages });
    assert(html.indexOf('name="betaEnabled"') > 0 && html.indexOf('name="betaEnabled"') < html.indexOf('name="levelingEnabled"') && /name="betaEnabled" checked/.test(html), 'switch first and checked');
    assert(html.includes('Сейчас в бете: Вебхуки') && (html.match(/beta-tag/g) || []).length >= 2, 'tags');
    const src = fs.readFileSync(path.join(__dirname, '..', 'web/routes/dashboard/features.js'), 'utf8');
    assert(src.includes("settings.betaEnabled = req.body.betaEnabled === 'on'"), 'saved by the route (beta build only)');
  });
  await test('menu: the webhooks entry is tagged as beta, other entries are not', async () => {
    const html = await ejs.renderFile(path.join(__dirname, '..', 'web/views/partials/sidebar.ejs'), { guild: { id: '123456789012345678', name: 'T', icon: null }, active: 'overview', betaPages: F.betaPages, user: null });
    assert((html.match(/class="beta-tag"/g) || []).length === F.betaPages.length && F.betaPages.includes('webhooks'), 'one tag per beta page');
    const item = html.slice(html.indexOf('/webhooks"'), html.indexOf('</a>', html.indexOf('/webhooks"'))); assert(item.includes('beta-tag'), 'webhooks tagged');
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : '\n      ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
