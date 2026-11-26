// Theme and side menu: markup, the 17 pages are all in the menu with a description, light theme tokens, theme script.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ejs = require('ejs'); require('../web/modules');
const web = path.join(__dirname, '..', 'web');

(async () => {
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const render = (active) => ejs.renderFile(path.join(web, 'views/partials/sidebar.ejs'), { guild: { id: '123456789012345678', name: 'Т', icon: null }, active, user: { id: '1', username: 'a', avatar: null } });

  await test('menu: every module and every page of a module is listed with a title, the current page is marked; switches for modules', async () => {
    const html = await render('webhooks');
    const M = require('../web/modules');
    const links = html.match(/<a href="\/dashboard\/123456789012345678[^"]*" class="[^"]*" title="[^"]+"/g) || [];
    const top = M.MODULES.filter((m) => !m.partOf); // the parts of a module (Магазин, Жалобы, Голосовые роли…) are tabs, not menu items
    // the tabs of a module are listed under it only while one of its pages is open
    const subPages = M.modulesOfPage('webhooks').flatMap((m) => m.pages.slice(1)).filter((p) => M.PAGE_LABELS[p] && M.pageVisible(p, undefined));
    assert(links.length === 3 + top.length + subPages.length, 'links ' + links.length);
    const onMod = await render('moderation-log');
    assert(onMod.includes('/moderation-warnings"') && !onMod.includes('/economy-journal"'), 'tabs of the open module only');
    assert(/href="\/dashboard\/123456789012345678\/webhooks" class="active"/.test(html) && (html.match(/class="active"/g) || []).length === 1, 'one active');
    assert(html.includes('data-menu-open') && html.includes('data-theme-toggle') && html.includes('data-quick-jump') && html.includes('data-mods-open'), 'menu, modules, theme and search buttons');
    for (const m of top) {
      if (m.field) assert(html.includes(`data-mod-switch="${m.key}"`), 'no switch: ' + m.key);
      else assert(!html.includes(`data-mod-switch="${m.key}"`), 'a module that is always on got a switch: ' + m.key);
    }
    assert(/class="tb-group tb-mods is-on"/.test(html), 'on a module page "Модули" is lit');
  });
  await test('taxonomy: four groups of modules and «Настройки панели» apart; every page has one module; no duplicates, no hidden parents', async () => {
    const M = require('../web/modules');
    assert(M.GROUPS.map((g) => g[1]).join('|') === 'Активность и экономика|Модерация и безопасность|Сервер и общение|Инструменты и медиа', 'groups: ' + M.GROUPS.map((g) => g[1]));
    assert(M.SYSTEM_GROUP[1] === 'Настройки панели', 'system block');
    assert(!M.MODULES.some((m) => 'parent' in m), 'no parent redirects');
    const owner = new Map();
    for (const m of M.MODULES) for (const p of m.pages) { assert(!owner.has(p), `page ${p} in two modules: ${owner.get(p)} and ${m.key}`); owner.set(p, m.key); }
    for (const m of M.MODULES.filter((x) => x.partOf)) {
      assert(!m.pages.length && M.BY_KEY.get(m.partOf).pages.includes(m.page), 'a part lives on a tab of its module: ' + m.key);
      assert(M.BY_KEY.get(m.partOf).group === m.group, 'a part is in its module group: ' + m.key);
    }
    const st = M.moduleState({});
    const where = (k) => st.groups.find((g) => g.modules.some((m) => m.key === k))?.id;
    const expect = { leveling: 'activity', achievements: 'activity', economy: 'activity', giveaways: 'activity', polls: 'activity', fun: 'activity',
      moderation: 'moderation', automod: 'moderation', tickets: 'moderation', appeals: 'moderation', logs: 'moderation',
      welcome: 'server', reactionRoles: 'server', tempVoice: 'server', serverStats: 'server', customCommands: 'server',
      webhooks: 'tools', alerts: 'tools', events: 'tools', music: 'tools', reminders: 'tools', listing: 'tools' };
    for (const [k, g] of Object.entries(expect)) assert(where(k) === g, `${k} in ${where(k)}, expected ${g}`);
    assert(st.system.modules.map((m) => m.key).join() === 'appearance,core', 'system: ' + st.system.modules.map((m) => m.key));
    assert(st.groups.every((g) => g.modules.length >= 2), 'no group of one module');
    assert(st.total === Object.keys(expect).length, 'counted modules: ' + st.total);
    for (const m of M.MODULES) assert(M.ICONS[m.key], 'icon of ' + m.key);
    // the shop, the reports and the button messages are tabs of their module, their switch on their tab
    assert(M.modulesOfPage('shop').map((m) => m.key).join() === 'economy,shop' && M.modulesOfPage('moderation-reports').map((m) => m.key).join() === 'tickets,report'
      && M.modulesOfPage('interactive').map((m) => m.key).join() === 'reactionRoles,interactive' && M.modulesOfPage('economy').map((m) => m.key).join() === 'economy', 'pages and their switches');
    // every page names its grid
    assert(M.layoutOf('leveling') === 'layout-form' && M.layoutOf('leaderboard') === 'layout-wide' && M.layoutOf('webhooks') === 'layout-form', 'layouts');
  });
  await test('groups: a strip at the top of the page and its copy for the top bar; the current group is marked; the side menu has «Настройки панели»', async () => {
    const html = await render('economy-journal');
    const strip = html.match(/<nav class="grp-bar"[\s\S]*?<\/nav>/)[0];
    const dock = html.match(/<nav class="tb-dock"[\s\S]*?<\/nav>/)[0];
    for (const part of [strip, dock]) {
      assert((part.match(/data-grp-open=/g) || []).length === 5, 'four groups and the system block');
      assert((part.match(/class="grp-tab is-cur"/g) || []).length === 1 && /is-cur" data-grp-open="activity"/.test(part), 'Экономика is in Активность и экономика');
    }
    assert(/class="tb-dock"[^>]*aria-hidden="true"/.test(html) && (dock.match(/tabindex="-1"/g) || []).length === 5, 'the copy is out of reach until it is shown');
    assert(html.indexOf('class="tb-dock"') < html.indexOf('class="tb-actions"'), 'the copy sits on the left of the top bar');
    const pop = html.match(/<div class="grp-pop"[\s\S]*?\n<\/div>/)[0];
    assert((pop.match(/data-grp-list=/g) || []).length === 5 && pop.includes('/dashboard/123456789012345678/shop"') === false && pop.includes('/economy"'), 'a list per group, parts not listed');
    assert(/class="nd-group nd-system"[\s\S]*Оформление[\s\S]*Базовые настройки/.test(html), 'side menu: «Настройки панели» apart');
    assert(/<div class="grp-wrap layout-wide">/.test(html), 'the strip is as wide as the page');
    const sys = await render('settings');
    assert(/is-cur is-system" data-grp-open="system"/.test(sys), 'the settings page is in «Настройки панели»');
    const ui = fs.readFileSync(path.join(web, 'public/js/ui.js'), 'utf8');
    assert(ui.includes('IntersectionObserver') && ui.includes('var STEP = 12') && ui.includes('requestAnimationFrame') && ui.includes("'tb-docked'") && ui.includes('prefers-reduced-motion'), 'the scroll script');
    const css = require('../web/styles').stylesheet().text;
    assert(/prefers-reduced-motion: reduce\)\s*\{\s*html\.tb-docked \.tb-dock \.grp-tab/.test(css.replace(/\n/g, ' ')) || css.includes('html.tb-docked .tb-dock .grp-tab,html.tb-leaving'), 'no sliding with reduced motion');
    for (const kf of css.match(/@keyframes grp-[a-z]+\{[^@]*?\}\}/g) || []) assert(!/width|left|height|top|margin/.test(kf), 'the slide moves only transform and opacity: ' + kf);
  });
  await test('the scroll states of the top bar: docked going down past the strip, undocked going up; a small jitter changes nothing', async () => {
    const src = fs.readFileSync(path.join(web, 'public/js/ui.js'), 'utf8');
    const start = src.indexOf('// --- The groups of modules: a strip');
    const code = src.slice(start, src.indexOf('\n// --- ', start + 10) > 0 ? src.indexOf('\n// --- ', start + 10) : undefined);
    const classes = new Set(); let ioCb = null; const listeners = {}; let raf = [];
    const el = (attrs = {}) => ({ attrs, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, querySelectorAll: () => [], querySelector: () => null, contains: () => false, getBoundingClientRect: () => ({ height: 60, top: 0, bottom: 60, left: 0 }), hidden: true, focus() {} });
    const dock = el({ 'aria-hidden': 'true' });
    const top = Object.assign(el(), { querySelector: (q) => (q === '.tb-dock' ? dock : null) });
    const win = { scrollY: 0, innerWidth: 1280, matchMedia: () => ({ matches: false }), addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener() {},
      IntersectionObserver: function (cb) { ioCb = cb; this.observe = () => {}; } };
    const document = { documentElement: { classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) } },
      getElementById: (id) => (id === 'grpBar' ? el() : id === 'topbar' ? top : el()), querySelectorAll: () => [], addEventListener() {} };
    vm.runInNewContext(code, { window: win, document, IntersectionObserver: win.IntersectionObserver, requestAnimationFrame: (f) => { raf.push(f); return raf.length; }, setTimeout: (f) => { f(); return 1; }, clearTimeout() {}, Math, Array });
    const scrollTo = (y) => { win.scrollY = y; listeners.scroll(); const r = raf; raf = []; r.forEach((f) => f()); };
    scrollTo(5); scrollTo(10); assert(!classes.has('tb-docked'), 'near the top nothing moves');
    ioCb([{ isIntersecting: false, boundingClientRect: { top: 9 } }]); // the strip went under the top bar (60 px), its top still on screen
    scrollTo(300); assert(classes.has('tb-docked') && dock.attrs['aria-hidden'] === 'false', 'down past the strip: the groups are in the top bar');
    scrollTo(295); assert(classes.has('tb-docked'), 'five pixels back: still docked (hysteresis)');
    scrollTo(280); assert(!classes.has('tb-docked') && dock.attrs['aria-hidden'] === 'true', 'up by 15 px: the groups leave the top bar');
    scrollTo(500); assert(classes.has('tb-docked'), 'down again: back in the top bar');
    ioCb([{ isIntersecting: true, boundingClientRect: { top: 70 } }]); assert(!classes.has('tb-docked'), 'the strip is in view: the top bar is as usual');
  });
  await test('every page of the panel still has its entry in the menu', async () => {
    const html = await render('x'); const routes = fs.readdirSync(path.join(web, 'routes/dashboard')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(web, 'routes/dashboard', f), 'utf8')).join('\n');
    const M = require('../web/modules');
    for (const p of ['features', 'leveling', 'economy', 'channel-boosts', 'shop', 'moderation', 'logs', 'automod', 'welcome', 'reaction-roles', 'custom-commands', 'temp-voice', 'alerts', 'webhooks']) {
      const main = M.moduleOfPage(p); // a tab is reached from its module's page
      assert(html.includes(`/dashboard/123456789012345678/${p}"`) || (main && html.includes(`/dashboard/123456789012345678/${main.page}"`)), 'missing in menu: ' + p);
      assert(routes.includes(`'/:guildId/${p}'`), 'route gone: ' + p);
    }
  });
  await test('stylesheet: light theme overrides every colour token of the dark one', async () => {
    const css = require('../web/styles').stylesheet().text;
    const block = (re) => css.match(re)[1];
    const names = (b) => new Set((b.match(/--[a-z-]+(?=:)/g) || []));
    const dark = names(block(/:root \{([\s\S]*?)\n\}/)); const light = names(block(/\[data-theme="light"\] \{([\s\S]*?)\n\}/));
    for (const n of dark) if (!/^--(font|radius)/.test(n)) assert(light.has(n), 'light theme lacks ' + n);
  });
  await test('theme script: valid, remembers the choice, keeps the pin, and does not crash without storage', async () => {
    const src = fs.readFileSync(path.join(web, 'public/js/theme.js'), 'utf8');
    const store = {}; const attrs = {}; const classes = new Set(); const listeners = [];
    const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c), toggle: (c) => { classes.has(c) ? classes.delete(c) : classes.add(c); return classes.has(c); } } },
      querySelector: () => null, querySelectorAll: () => [], addEventListener: (ev, fn) => listeners.push([ev, fn]) };
    const run = (storage) => vm.runInNewContext(src, { document: doc, localStorage: storage, Array });
    run({ getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } });
    assert(attrs['data-theme'] === 'dark', 'dark by default');
    store['dark-theme'] = 'light'; store['dark-rail'] = '1'; run({ getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } });
    assert(attrs['data-theme'] === 'light' && classes.has('rail-pinned'), 'restored');
    attrs['data-theme'] = undefined; run({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    assert(attrs['data-theme'] === 'dark', 'works with storage blocked');
    const ready = listeners.find((l) => l[0] === 'DOMContentLoaded'); assert(ready, 'waits for the page');
  });
  await test('season: Vice Nights runs until the end of 30 November (Moscow), SITE_SEASON overrides, the page gets it', async () => {
    const { currentSeason } = require('../web/utils/season');
    assert(currentSeason(Date.parse('2026-11-18T12:00:00Z'), '') === 'vice', 'on in November');
    assert(currentSeason(Date.parse('2026-11-30T20:59:00Z'), '') === 'vice', 'on at 23:59 Moscow time');
    assert(currentSeason(Date.parse('2026-11-30T21:00:00Z'), '') === null, 'off at midnight Moscow time');
    assert(currentSeason(Date.parse('2026-11-18T12:00:00Z'), 'off') === null && currentSeason(Date.parse('2027-01-01T00:00:00Z'), 'vice') === 'vice', 'env override');
    const head = await ejs.renderFile(path.join(web, 'views/partials/head.ejs'), { season: 'vice' });
    assert(head.indexOf('name="dark-season" content="vice"') > -1 && head.indexOf('dark-season') < head.indexOf('theme.js'), 'meta before the theme script');
    assert(!(await ejs.renderFile(path.join(web, 'views/partials/head.ejs'), {})).includes('dark-season'), 'no meta out of season');
    const src = fs.readFileSync(path.join(web, 'public/js/theme.js'), 'utf8'); const attrs = {};
    const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], classList: { add() {}, contains: () => false } },
      querySelector: (q) => (q.includes('dark-season') ? { getAttribute: () => 'vice' } : null), querySelectorAll: () => [], addEventListener() {} };
    vm.runInNewContext(src, { document: doc, localStorage: { getItem: () => null, setItem() {} }, Array });
    assert(attrs['data-season'] === 'vice', 'html gets data-season');
    // the visitor switched it off: it stays off on the next page, and the switch turns it back on
    const store = { 'dark-season-off': 'vice' }; const a2 = {}; const listeners = []; const btn = { setAttribute() {}, hasAttribute: (k) => k === 'data-season-toggle' };
    const doc2 = { documentElement: { setAttribute: (k, v) => { a2[k] = v; }, getAttribute: (k) => a2[k], hasAttribute: (k) => k in a2, removeAttribute: (k) => { delete a2[k]; }, classList: { add() {}, contains: () => false } },
      querySelector: (q) => (q.includes('dark-season') ? { getAttribute: () => 'vice' } : null), querySelectorAll: () => [btn], addEventListener: (ev, fn) => listeners.push([ev, fn]) };
    vm.runInNewContext(src, { document: doc2, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, Array });
    assert(!('data-season' in a2), 'stays off after the visitor turned it off');
    listeners.find((l) => l[0] === 'DOMContentLoaded')[1]();
    const click = listeners.filter((l) => l[0] === 'click').pop()[1];
    click({ target: { closest: () => btn } });
    assert(a2['data-season'] === 'vice' && store['dark-season-off'] === '', 'the switch turns it on and remembers');
    click({ target: { closest: () => btn } });
    assert(!('data-season' in a2) && store['dark-season-off'] === 'vice', 'and off again');
    const sw = await ejs.renderFile(path.join(web, 'views/partials/season-switch.ejs'), { season: 'vice', variant: 'icon' });
    assert(sw.includes('data-season-toggle') && sw.includes('role="switch"'), 'switch markup');
    assert(!(await ejs.renderFile(path.join(web, 'views/partials/season-switch.ejs'), {})).includes('button'), 'no switch out of season');
    const css = require('../web/styles').stylesheet().text;
    assert(css.includes('html[data-season="vice"] {') && css.includes('html[data-season="vice"][data-theme="light"] {'), 'both themes styled');
    for (const f of ['vice-grid-dark.svg', 'vice-grid-light.svg', 'vice-palms-left-dark.svg', 'vice-palms-right-dark.svg', 'vice-palms-left-light.svg', 'vice-palms-right-light.svg']) assert(fs.existsSync(path.join(web, 'public/season', f)), 'scene ' + f);
  });
  await test('head loads the theme script before the page is drawn, and the picker pages have a theme button', async () => {
    const head = fs.readFileSync(path.join(web, 'views/partials/head.ejs'), 'utf8');
    assert(/<script src="\/js\/theme\.js[^"]*"><\/script>/.test(head) && !/defer|async/.test(head.match(/<script[^>]*theme\.js[^>]*>/)[0]), 'script in head');
    for (const f of ['guilds', 'login']) assert(fs.readFileSync(path.join(web, `views/${f}.ejs`), 'utf8').includes('theme-fab'), f);
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : '\n      ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
