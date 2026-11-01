// Which Russian texts of the bot and the panel have no English yet. `node i18n/check.js` lists them; the test fails on any.
const fs = require('fs'); const path = require('path');
const espree = require('espree');
const { units, jsLiterals } = require('./templateUnits');
const EN = require('./en.json');
const ROOT = path.join(__dirname, '..');
const CYR = /[А-Яа-яЁё]/;
// Not shown to people: word lists, input words the bot understands, SQL defaults, single letters used in code.
const IGNORE_FILES = /(profanity|duration)\.js$|[\\/]migrations[\\/]|[\\/]i18n[\\/]/;
const IGNORE = new Set(['е', 'л', 'Л', 'и', 'ь']);

function walk(dir, ext, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p, ext, out); } else if (f.endsWith(ext)) out.push(p);
  }
  return out;
}

function codeStrings(file) {
  const out = []; const src = fs.readFileSync(file, 'utf8');
  let ast; try { ast = espree.parse(src, { ecmaVersion: 2024, sourceType: 'script' }); } catch { return out; }
  const visit = (node, quiet) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const c = node.callee; const name = c.type === 'MemberExpression' ? `${c.object.name || c.object.property?.name || ''}.${c.property.name || ''}` : c.name;
      if (/^(logger|console)\./.test(name) || name === 'require') quiet = true;
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && CYR.test(node.value) && !quiet) out.push(node.value);
    if (node.type === 'TemplateLiteral' && !quiet) {
      const s = node.quasis.map((q, i) => q.value.cooked + (i < node.expressions.length ? `{${i}}` : '')).join('');
      if (CYR.test(s)) out.push(s);
    }
    for (const k of Object.keys(node)) { const v = node[k]; if (Array.isArray(v)) v.forEach((x) => visit(x, quiet)); else if (v && typeof v.type === 'string') visit(v, quiet); }
  };
  visit(ast, false);
  return out;
}

function missing() {
  const res = [];
  const files = [...walk(path.join(ROOT, 'bot'), '.js'), ...walk(path.join(ROOT, 'web'), '.js').filter((f) => !f.includes(`${path.sep}public${path.sep}`)), ...walk(path.join(ROOT, 'db'), '.js')].filter((f) => !IGNORE_FILES.test(f));
  for (const f of files) for (const s of codeStrings(f)) if (!(s in EN) && !IGNORE.has(s)) res.push({ file: path.relative(ROOT, f), text: s });
  for (const f of walk(path.join(ROOT, 'web', 'views'), '.ejs')) for (const u of units(fs.readFileSync(f, 'utf8'))) {
    if (/<%|%>/.test(u.key) && u.type === 'js') continue;
    if (!(u.key in EN) && !(u.key.trim() in EN) && !IGNORE.has(u.key) && !/^(English|Русский)$/.test(u.key)) res.push({ file: path.relative(ROOT, f), text: u.key });
  }
  for (const f of walk(path.join(ROOT, 'web', 'public', 'js'), '.js')) for (const l of jsLiterals(fs.readFileSync(f, 'utf8'))) if (!(l.text in EN) && !IGNORE.has(l.text)) res.push({ file: path.relative(ROOT, f), text: l.text });
  const seen = new Set();
  return res.filter((r) => (seen.has(r.text) ? false : seen.add(r.text)));
}

if (require.main === module) {
  const m = missing();
  m.forEach((r, i) => console.log(`${i}\t${r.file}\t${JSON.stringify(r.text)}`));
  console.log(`missing: ${m.length}`);
}
module.exports = { missing };
