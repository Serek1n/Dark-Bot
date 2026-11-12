// The panel's stylesheet is kept in parts (web/styles/NN-*.css, read in the order of their numbers) and served as one
// file, /css/style.css. The order is the cascade: a later part may override an earlier one, so new rules go into the
// part where they belong, and the parts are never reordered.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

function parts() {
  return fs.readdirSync(DIR).filter((f) => /^\d\d-[\w-]+\.css$/.test(f)).sort();
}

/**
 * What the browser gets: the same rules without comments and spare spaces (about a quarter smaller after gzip). Quoted
 * text is left exactly as written; spaces are only dropped where CSS ignores them (around { } ; , and the > combinator).
 */
function minify(css) {
  const strings = [];
  const keep = (s) => `\u0000${strings.push(s) - 1}\u0000`;
  return css
    // one pass, so a quote inside a comment or a comment mark inside quotes can't fool it: quoted text is put aside,
    // comments are dropped
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?\*\//g, (m, str) => (str ? keep(str) : ''))
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => strings[i])
    .trim();
}

let cache = null;
function build() {
  const text = parts().map((f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\s*$/, '\n')).join('\n');
  const min = minify(text);
  return { text, min, etag: '"' + crypto.createHash('sha1').update(min).digest('base64url').slice(0, 20) + '"', mtimeMs: Math.max(...parts().map((f) => fs.statSync(path.join(DIR, f)).mtimeMs)) };
}

/** The whole stylesheet. Built once; outside production it is rebuilt when a part changes. */
function stylesheet() {
  if (cache && process.env.NODE_ENV === 'production') return cache;
  const latest = Math.max(...parts().map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
  if (!cache || latest !== cache.mtimeMs) cache = build();
  return cache;
}

module.exports = { stylesheet, parts, minify };
