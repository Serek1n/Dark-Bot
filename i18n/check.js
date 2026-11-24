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

const sourceFiles = () => [...walk(path.join(ROOT, 'bot'), '.js'), ...walk(path.join(ROOT, 'web'), '.js').filter((f) => !f.includes(`${path.sep}public${path.sep}`)), ...walk(path.join(ROOT, 'db'), '.js'), ...walk(path.join(ROOT, 'shared'), '.js')].filter((f) => !IGNORE_FILES.test(f));

function missing() {
  const res = [];
  const files = sourceFiles();
  for (const f of files) for (const s of codeStrings(f)) if (!(s in EN) && !IGNORE.has(s)) res.push({ file: path.relative(ROOT, f), text: s });
  for (const f of walk(path.join(ROOT, 'web', 'views'), '.ejs')) for (const u of units(fs.readFileSync(f, 'utf8'))) {
    if (/<%|%>/.test(u.key) && u.type === 'js') continue;
    if (!(u.key in EN) && !(u.key.trim() in EN) && !IGNORE.has(u.key) && !/^(English|Русский)$/.test(u.key)) res.push({ file: path.relative(ROOT, f), text: u.key });
  }
  for (const f of walk(path.join(ROOT, 'web', 'public', 'js'), '.js')) for (const l of jsLiterals(fs.readFileSync(f, 'utf8'))) if (!(l.text in EN) && !IGNORE.has(l.text)) res.push({ file: path.relative(ROOT, f), text: l.text });
  const seen = new Set();
  return res.filter((r) => (seen.has(r.text) ? false : seen.add(r.text)));
}

/**
 * Keys of en.json that no text of the bot or the panel uses any more: left from removed or renamed screens. A key counts
 * as used when it is a text found in the code or the templates, or when some text contains it (fragments and patterns:
 * "{0}" and "⟦0⟧" stand for any part). The test keeps their number from growing (i18n/orphans-baseline.json).
 */
function orphans() {
  const used = new Set(); const all = [];
  const add = (s) => { if (typeof s === 'string' && s) { used.add(s); used.add(s.trim()); all.push(s); } };
  for (const f of sourceFiles()) codeStrings(f).forEach(add);
  for (const f of walk(path.join(ROOT, 'web', 'views'), '.ejs')) for (const u of units(fs.readFileSync(f, 'utf8'))) add(u.key);
  for (const f of walk(path.join(ROOT, 'web', 'public', 'js'), '.js')) for (const l of jsLiterals(fs.readFileSync(f, 'utf8'))) add(l.text);
  // texts kept in the i18n folder itself (the bot's Discord texts, defaults of settings)
  for (const f of walk(path.join(ROOT, 'i18n'), '.js')) codeStrings(f).forEach(add);
  const blob = all.join('\n');
  const PH = /\{\w+\}|⟦\d+⟧/;
  return Object.keys(EN).filter((k) => {
    if (used.has(k) || used.has(k.trim())) return false;
    const parts = k.split(/\{\w+\}|⟦\d+⟧/).map((p) => p.trim()).filter((p) => p.length > 2);
    if (PH.test(k)) return !parts.every((p) => blob.includes(p));
    return !blob.includes(k.trim());
  });
}

if (require.main === module) {
  if (process.argv.includes('--orphans')) { const o = orphans(); o.forEach((k) => console.log(JSON.stringify(k))); console.log(`orphans: ${o.length}`); process.exit(0); }
  const m = missing();
  m.forEach((r, i) => console.log(`${i}\t${r.file}\t${JSON.stringify(r.text)}`));
  console.log(`missing: ${m.length}`);
}
module.exports = { missing, orphans };
