// The panel in English: a viewer's choice (cookie "lang", or the browser's language the first time) decides which copy of a
// page is rendered. The English copies of the templates are made once, at start, from the Russian ones and the dictionary:
// sentences are replaced as a whole, values printed with <%= %> pass through __t (names stay, known texts are translated),
// dates are written the English way. Scripts in /js are served translated too.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const i18n = require('../i18n');
const { apply, jsLiterals } = require('../i18n/templateUnits');

const VIEWS = path.join(__dirname, 'views');
const PUBLIC_JS = path.join(__dirname, 'public', 'js');
const LANG_COOKIE = 'lang';
const YEAR = 365 * 24 * 3600 * 1000;

/** Language of this visitor: their choice, else the browser's (Russian or Ukrainian → Russian, anything else → English). */
function langOfRequest(req) {
  const c = String(req.headers.cookie || '').match(/(?:^|;\s*)lang=(ru|en)(?:;|$)/);
  if (c) return c[1];
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  if (!al) return 'ru';
  return /^(ru|uk|be|kk)/.test(al) ? 'ru' : 'en';
}

const tokensOk = (key, en) => { const tk = (s) => (s.match(/⟦\d+⟧/g) || []).sort().join(); return tk(key) === tk(en); };

/** One template in English. */
function translateTemplate(src) {
  let out = apply(src, (key, unit) => {
    let en = i18n.exact.get(key);
    if (en === undefined && unit.type !== 'js') en = i18n.exact.get(key.trim());
    if (en === undefined) {
      const t = i18n.toEnglish(key, false); // a key with ⟦n⟧ tokens may still match a pattern
      if (t !== key) en = t;
    }
    if (en === undefined || en === null) return null;
    if (unit.type === 'js') en = en.replace(/\\/g, '\\\\').replace(unit.quote === "'" ? /'/g : unit.quote === '"' ? /"/g : /`/g, (q) => `\\${q}`);
    if (!tokensOk(key, en)) return null;
    return en;
  });
  // printed values go through __t; includes and raw output stay as they are
  out = out.replace(/<%=([\s\S]*?)%>/g, (m, expr) => `<%= __t(${expr.trim()}) %>`);
  out = out.replace(/'ru-RU'/g, "'en-US'").replace(/<html lang="ru">/g, '<html lang="en">');
  out = out.replace(/(\.js\?v=)<%= __t\(([\s\S]*?)\) %>/g, '$1<%= $2 %>-en'); // English scripts for English pages
  return out;
}

let enDir = null;
/** Makes (once) the English copy of all templates and returns its folder. */
function englishViews() {
  if (enDir) return enDir;
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.ejs')) files.push(p); } };
  walk(VIEWS);
  const hash = crypto.createHash('sha1');
  for (const f of files) hash.update(f).update(fs.readFileSync(f));
  hash.update(JSON.stringify(Object.keys(require('../i18n/en.json')).length));
  for (const f of [path.join(__dirname, '..', 'i18n', 'en.json'), path.join(__dirname, '..', 'i18n', 'templateUnits.js'), __filename]) hash.update(fs.readFileSync(f));
  const dir = path.join(os.tmpdir(), `dark-views-en-${hash.digest('hex').slice(0, 12)}`);
  if (!fs.existsSync(path.join(dir, '.done'))) {
    for (const f of files) {
      const target = path.join(dir, path.relative(VIEWS, f));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, translateTemplate(fs.readFileSync(f, 'utf8')));
    }
    fs.writeFileSync(path.join(dir, '.done'), new Date().toISOString());
  }
  enDir = dir;
  return dir;
}

const t = (v) => (typeof v === 'string' ? i18n.toEnglish(v, false) : v);
const same = (v) => v;
let enErrorTexts = null;

/** Middleware: req.lang, and res.render picks the English copy for English viewers. */
function panelLanguage(req, res, next) {
  req.lang = langOfRequest(req);
  res.locals.lang = req.lang;
  res.locals.__t = same;
  if (req.lang === 'en') {
    res.locals.__t = t;
    enErrorTexts = enErrorTexts || Object.fromEntries(Object.entries(req.app.locals.errorTexts || {}).map(([k, v]) => [k, t(v)]));
    res.locals.errorTexts = enErrorTexts;
    const render = res.render.bind(res);
    res.render = (view, opts, cb) => {
      if (typeof view === 'string' && !path.isAbsolute(view)) {
        const file = path.join(englishViews(), `${view}.ejs`);
        if (fs.existsSync(file)) return render(file, opts, cb);
      }
      return render(view, opts, cb);
    };
  }
  next();
}

// ---------- scripts ----------
const jsCache = new Map();
function translateJs(src) {
  let out = ''; let pos = 0;
  for (const l of jsLiterals(src)) {
    let en = i18n.exact.get(l.text);
    if (en == null || /<%|%>/.test(l.text)) continue;
    en = en.replace(/\\/g, '\\\\').replace(l.quote === "'" ? /'/g : l.quote === '"' ? /"/g : /`/g, (q) => `\\${q}`);
    out += src.slice(pos, l.start) + en; pos = l.end;
  }
  return out + src.slice(pos);
}
/** /js/*.js?v=…-en → the script with English texts. */
function englishScripts(req, res, next) {
  if (!/^\/js\/[\w.-]+\.js$/.test(req.path) || !String(req.query.v || '').endsWith('-en')) return next();
  const file = path.join(PUBLIC_JS, path.basename(req.path));
  if (!file.startsWith(PUBLIC_JS) || !fs.existsSync(file)) return next();
  let body = jsCache.get(file);
  if (!body) { body = translateJs(fs.readFileSync(file, 'utf8')); jsCache.set(file, body); }
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=604800' });
  res.send(body);
}

/** /lang/en?next=/dashboard/… — remembers the choice and goes back. */
function switchLanguage(req, res) {
  const lang = req.params.lang === 'en' ? 'en' : 'ru';
  res.cookie(LANG_COOKIE, lang, { maxAge: YEAR, sameSite: 'lax', httpOnly: false, secure: (process.env.WEB_BASE_URL || '').startsWith('https://') });
  const next = String(req.query.next || '/');
  res.redirect(/^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : '/'); // only a path on this site
}

module.exports = { panelLanguage, englishScripts, switchLanguage, translateTemplate, englishViews, langOfRequest, translateJs };
