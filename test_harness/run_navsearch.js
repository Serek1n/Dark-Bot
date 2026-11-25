// Navigation and search: the settings index is built from the page templates, the route answers JSON, and the client
// script has the drawer, the tabs and the find-on-page jump.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const results = []; let failed = 0;
function test(name, fn) { try { fn(); results.push(`PASS  ${name}`); } catch (e) { failed++; results.push(`FAIL  ${name}\n      ${String(e.stack || e).split('\n').slice(0, 2).join(' | ')}`); } }
const { settingsIndex, _clean } = require('../web/settingsIndex');
const pages = settingsIndex();
test('every panel page is indexed with its title and settings', () => {
  const views = fs.readdirSync(path.join(__dirname, '..', 'web', 'views', 'dashboard')).filter((f) => f.endsWith('.ejs'));
  assert(pages.length >= views.length, "a template with tabs gives a page per tab");
  assert(["leveling", "leveling-rewards", "leveling-notify", "leveling-data"].every((p) => pages.some((x) => x.page === p)), "the tabs of Уровни");
  for (const p of pages) assert(p.title, 'title of ' + p.page);
  assert(pages.reduce((n, p) => n + p.entries.length, 0) > 150, 'enough settings');
});
test('known settings are findable by their words', () => {
  const all = pages.flatMap((p) => p.entries);
  const has = (page, text) => assert(all.some((e) => e.page === page && e.text === text), page + ': ' + text);
  has('automod', 'Блокировать мат'); has('automod', 'Фильтр ссылок'); has('leveling', 'Пауза между начислениями'); has('leveling-notify', 'Канал поздравлений'); has('leveling-rewards', 'Новая роль за уровень'); has('shop', 'Журнал покупок'); has('leaderboard', 'Рейтинг'); has('economy', 'Ежедневная награда');
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
test('the panel font is Manrope (same as the bot cards), served from the panel itself', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'css', 'fonts.css'), 'utf8');
  assert(css.includes("font-family: 'Manrope'") && fs.existsSync(path.join(__dirname, '..', 'web', 'public', 'fonts', 'manrope-cyrillic-wght-normal.woff2')));
});
test('Ctrl+K: every module of the four groups and «Настройки панели» is found, by its name and by its words; no link leads nowhere', () => {
  const M = require('../web/modules');
  const ejs = require('ejs');
  let html = '';
  ejs.renderFile(path.join(__dirname, '..', 'web', 'views', 'partials', 'sidebar.ejs'), { guild: { id: '123456789012345678', name: 'Т', icon: null }, active: 'overview', user: null }, { async: false }, (e, h) => { if (e) throw e; html = h; });
  const links = [...html.matchAll(/<a href="([^"]+)"[^>]*title="([^"]+)"(?: data-kw="([^"]*)")?/g)].map((m) => ({ href: m[1], name: m[2].split(' — ')[0], kw: m[3] || '' }));
  const st = M.moduleState({});
  for (const m of [...st.groups.flatMap((g) => g.modules), ...st.system.modules]) {
    const l = links.find((x) => x.name === m.title);
    assert(l, 'not in the search: ' + m.title);
    assert(l.kw.includes(m.group === 'system' ? M.SYSTEM_GROUP[1] : M.GROUPS.find((g) => g[0] === m.group)[1]), 'the group is a search word: ' + m.key);
    for (const part of m.parts) assert(l.kw.includes(part.title), 'a part is found by its module: ' + part.title);
  }
  // the words: «магазин» finds Экономика, «тикет» Жалобы и тикеты, «кнопки» Роли по реакциям и кнопкам
  const find = (w) => links.filter((l) => (l.name + ' ' + l.kw).toLowerCase().includes(w)).map((l) => l.name);
  assert(find('магазин').includes('Экономика') && find('тикет').includes('Жалобы и тикеты') && find('кнопк').includes('Роли по реакциям и кнопкам') && find('язык').includes('Базовые настройки'), 'keywords');
  const routes = fs.readdirSync(path.join(__dirname, '..', 'web', 'routes', 'dashboard'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'web', 'routes', 'dashboard', f), 'utf8')).join('\n');
  for (const l of links) {
    const page = (l.href.match(/^\/dashboard\/\d+\/([\w-]+)/) || [])[1];
    if (page) assert(routes.includes(`'/:guildId/${page}'`) || routes.includes(`/:guildId/${page}`) || new RegExp(`TABS[^\\n]*'${page}'`).test(routes) || routes.includes(`'${page}'`), 'a link leads nowhere: ' + l.href);
  }
});
console.log(results.join('\n')); console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
