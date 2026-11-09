// What the panel's search finds besides the pages themselves: every card heading, field label and switch of every page,
// read once from the page templates. A result opens the page at that setting (#find=… — ui.js scrolls to it and lights it).
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, 'views', 'dashboard');
let cache = null;

const clean = (s) => String(s)
  .replace(/<%[\s\S]*?%>/g, ' ') // template code is not text
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function pageEntries(file) {
  let src = fs.readFileSync(path.join(VIEWS, file), 'utf8');
  // parts of a page that live in a partial (the message builder of "Вебхуки")
  for (const m of src.matchAll(/include\('\.\.\/partials\/(msg-builder)'/g)) src += fs.readFileSync(path.join(VIEWS, '..', 'partials', m[1] + '.ejs'), 'utf8');
  const page = file.replace(/\.ejs$/, '');
  const title = clean((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(src) || [])[1] || '');
  const seen = new Set(); const out = [];
  const add = (text, kind) => {
    const t = clean(text).replace(/[:：]\s*$/, '');
    if (t.length < 3 || t.length > 90 || !/[A-Za-zА-Яа-яЁё]/.test(t) || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase()); out.push({ page, text: t, kind });
  };
  for (const m of src.matchAll(/<h2[^>]*>([\s\S]*?)(?:<span class="sub"|<\/h2>)/g)) add(m[1], 'card');
  for (const m of src.matchAll(/<span class="rule-text">\s*<b>([\s\S]*?)<\/b>/g)) add(m[1], 'switch');
  for (const m of src.matchAll(/<label(?![^>]*class="(?:rule|msg-radio|msg-check|checkbox-row)")[^>]*>([\s\S]*?)<\/label>/g)) {
    const text = m[1].split(/<(?:input|select|textarea|span class="muted")/)[0];
    add(text, 'field');
  }
  return { page, title: title || (page === 'overview' ? 'Обзор' : page), entries: out };
}

/** [{ page, title, entries: [{ page, text, kind }] }] for every panel page; built once. */
function settingsIndex() {
  if (cache) return cache;
  cache = fs.readdirSync(VIEWS).filter((f) => f.endsWith('.ejs')).sort().map(pageEntries);
  return cache;
}

module.exports = { settingsIndex, _clean: clean };
