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

let cache = null;
function build() {
  const text = parts().map((f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\s*$/, '\n')).join('\n');
  return { text, etag: '"' + crypto.createHash('sha1').update(text).digest('base64url').slice(0, 20) + '"', mtimeMs: Math.max(...parts().map((f) => fs.statSync(path.join(DIR, f)).mtimeMs)) };
}

/** The whole stylesheet. Built once; outside production it is rebuilt when a part changes. */
function stylesheet() {
  if (cache && process.env.NODE_ENV === 'production') return cache;
  const latest = Math.max(...parts().map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
  if (!cache || latest !== cache.mtimeMs) cache = build();
  return cache;
}

module.exports = { stylesheet, parts };
