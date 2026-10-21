// Theme and side menu: markup, the 17 pages are all in the menu with a description, light theme tokens, theme script.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ejs = require('ejs');
const web = path.join(__dirname, '..', 'web');

(async () => {
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const render = (active) => ejs.renderFile(path.join(web, 'views/partials/sidebar.ejs'), { guild: { id: '123456789012345678', name: 'Т', icon: null }, active, user: { id: '1', username: 'a', avatar: null } });

  await test('menu: 17 links, each with a name and a description, the current page is marked', async () => {
    const html = await render('webhooks');
    const links = html.match(/<a href="\/dashboard\/123456789012345678[^"]*" class="[^"]*" title="[^"]+"/g) || [];
    assert(links.length === 17, 'links ' + links.length);
    assert((html.match(/<small>[^<]+<\/small>/g) || []).length === 17, 'descriptions');
    assert(/href="\/dashboard\/123456789012345678\/webhooks" class="active"/.test(html) && (html.match(/class="active"/g) || []).length === 1, 'one active');
    assert(html.includes('data-rail-pin') && html.includes('data-theme-toggle'), 'pin and theme buttons');
  });
  await test('every page of the panel still has its entry in the menu', async () => {
    const html = await render('x'); const routes = fs.readFileSync(path.join(web, 'routes/dashboard.js'), 'utf8');
    for (const p of ['features', 'leveling', 'economy', 'channel-boosts', 'shop', 'leaderboard', 'moderation', 'logs', 'automod', 'welcome', 'level-roles', 'reaction-roles', 'custom-commands', 'temp-voice', 'alerts', 'webhooks']) {
      assert(html.includes(`/dashboard/123456789012345678/${p}"`), 'missing in menu: ' + p);
      assert(routes.includes(`'/:guildId/${p}'`), 'route gone: ' + p);
    }
  });
  await test('stylesheet: light theme overrides every colour token of the dark one', async () => {
    const css = fs.readFileSync(path.join(web, 'public/css/style.css'), 'utf8');
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
