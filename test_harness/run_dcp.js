// The message preview (web/public/js/dcp.js) as Discord draws a message: markdown (headings only at the start of a line and
// only up to ###, subtext, nested lists, quotes and >>>, code and ANSI blocks, escapes, spoilers, masked links, mentions,
// timestamps, jumbo emoji), embeds (fields in rows of up to three), buttons in six styles, Components V2 and the API limits.
// Nothing typed in a field may become HTML.
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'js', 'dcp.js'), 'utf8');
const doc = { documentElement: { getAttribute: (k) => (k === 'lang' ? 'ru' : null) }, readyState: 'complete', querySelectorAll: () => [], addEventListener: () => {} };
const sandbox = { window: {}, document: doc, location: { pathname: '/dashboard/1' }, Intl, Date, Math, JSON, Promise, String, Number, Object, Array, RegExp, isFinite, isNaN, parseInt, setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('offline')), localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const D = sandbox.window.DCP;
const results = []; const test = (l, f) => { try { f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.message }); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const has = (html, s) => assert(html.includes(s), `нет ${s} в ${html.slice(0, 400)}`);
const not = (html, s) => assert(!html.includes(s), `лишнее ${s} в ${html.slice(0, 400)}`);

test('inline: bold, italic, bold italic, underline (not bold), strike, spoiler, code, nested', () => {
  const h = D.md('**ж** *к* _к2_ ***жк*** __п__ ~~з~~ ||с|| `**не жирный**` ||~~__***всё***__~~||');
  ['<b>ж</b>', '<i>к</i>', '<i>к2</i>', '<b><i>жк</i></b>', '<u>п</u>', '<s>з</s>', 'dcp-spoiler', '<code class="dcp-icode">**не жирный**</code>', '<u><b><i>всё</i></b></u>'].forEach((s) => has(h, s));
});
test('escapes: \\* shows the star, no italics', () => { const h = D.md('\\*не курсив\\*'); not(h, '<i>'); has(h, '*не курсив*'); });
test('headings only #..### at a line start with a space; #### stays text; subtext -#', () => {
  const h = D.md('# Один\n## Два\n### Три\n#### Четыре\n#Без пробела\n-# мелкий');
  has(h, 'dcp-h1'); has(h, 'dcp-h2'); has(h, 'dcp-h3'); has(h, '#### Четыре'); has(h, '#Без пробела'); has(h, '<div class="dcp-sub">мелкий</div>');
  not(D.md('# нет', { headings: false }), 'dcp-h1');
});
test('lists: bullets nest by spaces, numbered keep their start, a new kind starts a new list', () => {
  const h = D.md('- а\n  - б\n3. три\n4. четыре');
  has(h, '<ul class="dcp-list d1"><li>а<ul class="dcp-list d2"><li>б'); has(h, '<ol class="dcp-list d1" start="3"><li>три</li><li>четыре');
});
test('quotes: > per line, >>> to the end', () => {
  has(D.md('> раз\nдва'), '<blockquote class="dcp-quote"><div><div class="dcp-line">раз</div></div></blockquote><div class="dcp-line">два</div>');
  const q = D.md('a\n>>> раз\nдва'); has(q, 'раз</div><div class="dcp-line">два</div></div></blockquote>');
});
test('code blocks: nothing inside is markdown; ANSI coloured on PC, plain on a phone', () => {
  const h = D.md('```js\n**x** <b>\n```'); has(h, 'lang-js'); has(h, '**x** &lt;b&gt;'); not(h, '<b>x');
  const a = D.md('```ansi\n\u001b[1;31mкрасный\u001b[0m\n```'); has(a, 'color:#dc322f'); has(a, 'font-weight:700');
  not(D.md('```ansi\n\u001b[31mк\u001b[0m\n```', { plain: true }), 'color:');
});
test('links: masked with a tooltip, plain, <suppressed>; javascript: never becomes a link', () => {
  const h = D.md('[текст](https://a.b "подсказка") https://c.d/e <https://f.g>');
  has(h, 'href="https://a.b" title="подсказка"'); has(h, 'href="https://c.d/e"'); has(h, 'href="https://f.g"');
  not(D.md('[x](javascript:alert(1))'), 'href="javascript');
});
test('mentions: user, role with its colour, channel, slash command, navigation, everyone; tokens only when asked', () => {
  D.ctx.roles['111111111111111111'] = { id: '111111111111111111', name: 'Админ', color: 0xff0000 };
  D.ctx.channels['222222222222222222'] = { id: '222222222222222222', name: 'общий', type: 0 };
  const h = D.md('<@333333333333333333> <@&111111111111111111> <#222222222222222222> </ping sub:444444444444444444> <id:customize> @everyone {user}');
  has(h, '@участник'); has(h, '--rc:#ff0000'); has(h, '@Админ'); has(h, 'общий'); has(h, '/ping sub'); has(h, 'Каналы и роли'); has(h, '@everyone'); not(h, 'dcp-token');
  has(D.md('{user}', { tokens: true }), 'dcp-token');
});
test('timestamps: all nine styles', () => {
  ['t', 'T', 'd', 'D', 'f', 'F', 's', 'S', 'R'].forEach((s) => has(D.md('<t:1700000000:' + s + '>'), 'dcp-time'));
  has(D.md('<t:1700000000:d>'), '14.11.2023');
});
test('emoji: custom from the CDN, jumbo when only emoji, inline with text', () => {
  has(D.md('<a:dance:123456789012345678>'), 'emojis/123456789012345678.gif');
  assert(D.isJumbo('😀 🎉 <:xx:123456789012345678>'), 'jumbo'); assert(!D.isJumbo('😀 привет'), 'not jumbo'); assert(!D.isJumbo('123'), 'digits');
});
test('nothing from a field becomes HTML', () => {
  const h = D.render({ content: '<img src=x onerror=alert(1)> **<script>**', embeds: [{ title: '<b>t</b>', description: '"><svg onload=1>', footer: { text: '<i>f</i>' }, image: { url: 'javascript:alert(1)' } }] }, {});
  not(h, '<img src=x'); not(h, '<script>'); not(h, '<svg onload'); not(h, 'javascript:'); has(h, '&lt;script&gt;');
});
test('embed: author, title link, thumbnail, fields 3 in a row then a full one, image, footer with time', () => {
  const h = D.render({ embeds: [{ author: { name: 'A' }, title: 'T', url: 'https://x.y', description: 'd', color: 0x112233, thumbnail: { url: 'https://i.png' }, fields: [1, 2, 3, 4].map((i) => ({ name: 'n' + i, value: 'v', inline: true })).concat([{ name: 'w', value: 'v' }]), image: { url: 'https://img.png' }, footer: { text: 'F' }, timestamp: new Date().toISOString() }] }, {});
  ['dcp-author', 'href="https://x.y"', 'has-thumb', 'dcp-frow n3', 'dcp-frow n1', 'dcp-eimage', 'F • Сегодня в', '--bar:#112233'].forEach((s) => has(h, s));
});
test('buttons: six styles, link with ↗, disabled; selects; APP badge; ephemeral and the command line', () => {
  const h = D.render({ components: [{ type: 1, components: [1, 2, 3, 4].map((s) => ({ type: 2, style: s, label: 'b' + s })).concat([{ type: 2, style: 5, label: 'l', url: 'https://a' }]) }, { type: 1, components: [{ type: 3, placeholder: 'выбери' }] }] }, { ephemeral: true, interaction: { command: 'stats' } });
  ['dcp-btn primary', 'dcp-btn secondary', 'dcp-btn success', 'dcp-btn danger', 'dcp-btn link', 'dcp-ext', 'dcp-select', 'выбери', 'dcp-app', 'ephemeral', '/stats'].forEach((s) => has(h, s));
});
test('Components V2: container with bar, section with thumbnail, separator, gallery, file; no nested containers', () => {
  const h = D.render({ flags: 32768, content: 'не видно', components: [{ type: 17, accent_color: 0xff00ff, components: [{ type: 9, components: [{ type: 10, content: '**s**' }], accessory: { type: 11, media: { url: 'https://t.png' } } }, { type: 14, divider: true, spacing: 2 }, { type: 12, items: [{ media: { url: 'https://a.png' } }, { media: { url: 'https://b.png' } }] }, { type: 13, file: { url: 'attachment://a.pdf' } }, { type: 17, components: [{ type: 10, content: 'вложенный' }] }] }] }, {});
  ['dcp-container has-bar', '--bar:#ff00ff', 'dcp-section', 'dcp-simg', 'dcp-sep big line', 'dcp-gallery n2', 'a.pdf'].forEach((s) => has(h, s));
  not(h, 'не видно'); not(h, 'вложенный');
});
test('limits: text 2000, embeds 10 / 6000, fields 25, buttons 5 in a row; V2: 40 components, 4000 text, 1–10 in a container', () => {
  const t = (p) => D.validate(p).filter((x) => x.level === 'error').map((x) => x.text).join(' | ');
  assert(/2000/.test(t({ content: 'x'.repeat(2001) })), 'content');
  assert(/больше 10/.test(t({ embeds: Array.from({ length: 11 }, () => ({ title: 'a' })) })), '10 embeds');
  assert(/6000/.test(t({ embeds: [{ description: 'x'.repeat(4000) }, { description: 'x'.repeat(2500) }] })), '6000');
  assert(/25/.test(t({ embeds: [{ fields: Array.from({ length: 26 }, () => ({ name: 'a', value: 'b' })) }] })), 'fields');
  assert(/5 кнопок/.test(t({ components: [{ type: 1, components: Array.from({ length: 6 }, () => ({ type: 2, label: 'a' })) }] })), 'buttons');
  assert(/40/.test(t({ flags: 32768, components: Array.from({ length: 41 }, () => ({ type: 10, content: 'a' })) })), '40');
  assert(/4000/.test(t({ flags: 32768, components: [{ type: 10, content: 'x'.repeat(4001) }] })), '4000');
  assert(/от 1 до 10/.test(t({ flags: 32768, components: [{ type: 17, components: [] }] })), 'container');
  assert(t({ content: 'ok', embeds: [{ title: 'a' }] }) === '', 'clean');
});
test('API JSON: colours as numbers, the V2 flag, no own keys', () => {
  const a = D.api({ content: '', embeds: [{ title: 'a', color: '#ff0000' }], components: [], mentions: 'none' });
  assert(a.embeds[0].color === 0xff0000 && !('content' in a) && !('mentions' in a) && !('components' in a), JSON.stringify(a));
  const b = D.api({ v2: true, components: [{ type: 17, accent_color: '#00ff00', components: [] }] });
  assert(b.flags === 32768 && b.components[0].accent_color === 0x00ff00 && !('v2' in b), JSON.stringify(b));
});

results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
