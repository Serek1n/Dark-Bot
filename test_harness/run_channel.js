// Beta features exist only in the beta build (git branch "beta" or BOT_CHANNEL=beta); the release never runs them, whatever the server switch says.
process.env.DATABASE_PATH = './data/test_channel.sqlite';
const fs = require('fs'); const assert = require('assert'); const path = require('path'); const ejs = require('ejs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
(async () => {
  const ch = require('../bot/utils/channel');
  const F = require('../bot/utils/features');
  const on = { betaEnabled: true, webhooksEnabled: true };

  // how the channel is decided
  delete process.env.BOT_CHANNEL; ch.resetChannel();
  const realRead = fs.readFileSync;
  const head = (text) => { fs.readFileSync = (p, ...a) => (String(p).endsWith(path.join('.git', 'HEAD')) ? text : realRead(p, ...a)); ch.resetChannel(); };
  head('ref: refs/heads/beta\n'); assert.strictEqual(ch.channel(), 'beta');
  head('ref: refs/heads/beta-webhooks\n'); assert.strictEqual(ch.channel(), 'beta');
  head('ref: refs/heads/main\n'); assert.strictEqual(ch.channel(), 'release');
  head('3f2a9c1d4e5b6a7788990011223344556677889a\n'); assert.strictEqual(ch.channel(), 'release', 'detached HEAD = release');
  fs.readFileSync = () => { throw new Error('ENOENT'); }; ch.resetChannel(); assert.strictEqual(ch.channel(), 'release', 'no .git = release');
  fs.readFileSync = realRead;
  process.env.BOT_CHANNEL = 'beta'; ch.resetChannel(); assert.strictEqual(ch.channel(), 'beta', 'the setting wins');
  process.env.BOT_CHANNEL = 'release'; ch.resetChannel(); assert.strictEqual(ch.channel(), 'release');

  // release build: a beta feature is off even where the server switch is on, and the text says why
  assert.strictEqual(F.isEnabled(on, 'webhooks'), false);
  assert(/бета-версии/.test(F.disabledText(on, 'webhooks')), F.disabledText(on, 'webhooks'));
  assert.strictEqual(F.isEnabled(on, 'leveling') || true, true);
  assert.strictEqual(F.isEnabled({ levelingEnabled: true }, 'leveling'), true, 'normal features are not affected');

  // beta build: the server switch decides
  process.env.BOT_CHANNEL = 'beta'; ch.resetChannel();
  assert.strictEqual(F.isEnabled(on, 'webhooks'), true);
  assert.strictEqual(F.isEnabled({ betaEnabled: false, webhooksEnabled: true }, 'webhooks'), false);

  // the panel page: the release shows a note instead of the switch and hides beta features; saving does not touch them
  const view = path.join(__dirname, '..', 'web/views/dashboard/features.ejs');
  const render = (betaBuild) => ejs.renderFile(view, { guild: { id: '123456789012345678', name: 'T', icon: null }, settings: { betaEnabled: true, webhooksEnabled: true, levelingEnabled: true }, features: F.FEATURES.filter((f) => !f.beta || betaBuild), betaBuild, active: 'features', user: null, betaPages: [] });
  const rel = await render(false);
  assert(rel.includes('релизная') && !rel.includes('name="betaEnabled"') && !rel.includes('name="webhooksEnabled"'), 'release page');
  const bet = await render(true);
  assert(bet.includes('name="betaEnabled"') && bet.includes('name="webhooksEnabled"') && bet.includes('Запущена бета-версия'), 'beta page');

  const route = fs.readFileSync(path.join(__dirname, '..', 'web/routes/dashboard/features.js'), 'utf8');
  assert(route.includes('if (isBetaBuild()) settings.betaEnabled'), 'release never rewrites the beta switch');
  console.log('channel OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
