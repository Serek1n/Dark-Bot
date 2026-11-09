// Navigation and search: the settings index is built from the page templates, the route answers JSON, and the client
// script has the drawer, the tabs and the find-on-page jump.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const results = []; let failed = 0;
function test(name, fn) { try { fn(); results.push(`PASS  ${name}`); } catch (e) { failed++; results.push(`FAIL  ${name}\n      ${String(e.stack || e).split('\n').slice(0, 2).join(' | ')}`); } }
const { settingsIndex, _clean } = require('../web/settingsIndex');
const pages = settingsIndex();
test('every panel page is indexed with its title and settings', () => {
  const views = fs.readdirSync(path.join(__dirname, '..', 'web', 'views', 'dashboard')).filter((f) => f.endsWith('.ejs'));
  assert.strictEqual(pages.length, views.length);
  for (const p of pages) assert(p.title, 'title of ' + p.page);
  assert(pages.reduce((n, p) => n + p.entries.length, 0) > 150, 'enough settings');
});
test('known settings are findable by their words', () => {
  const all = pages.flatMap((p) => p.entries);
  const has = (page, text) => assert(all.some((e) => e.page === page && e.text === text), page + ': ' + text);
  has('automod', 'Блокировать мат'); has('automod', 'Фильтр ссылок'); has('leveling', 'Пауза между начислениями, секунд'); has('shop', 'Магазин и журнал покупок');
  assert(!all.some((e) => /<%|%>|<|>/.test(e.text)), 'no template code or tags in texts');
});
test('template code and tags are cleaned out of texts', () => {
  assert.strictEqual(_clean('<%= x %> за <b>новый</b>   уровень'), 'за новый уровень');
});
test('the client has the drawer, the tabs and the find-on-page jump', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'js', 'ui.js'), 'utf8');
  assert(ui.includes('function navUi()') && ui.includes("'/dashboard/settings-index.json'") && ui.includes('function findOnPage()') && ui.includes("'#find='"));
  const idx = fs.readFileSync(path.join(__dirname, '..', 'web', 'routes', 'dashboard', 'index.js'), 'utf8');
  assert(idx.indexOf("router.get('/settings-index.json'") < idx.indexOf('router.use(require'), 'the route comes before /:guildId pages');
});
test('the panel font is Onest, served from the panel itself', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'css', 'fonts.css'), 'utf8');
  assert(css.includes("font-family: 'Onest'") && fs.existsSync(path.join(__dirname, '..', 'web', 'public', 'fonts', 'onest-cyrillic-wght-normal.woff2')));
});
console.log(results.join('\n')); console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
