// Splits an EJS template into pieces of Russian text that can be translated as a whole: a sentence with its inline markup
// (<b>, <code>, <a>, <%= value %>…) is one piece, so the English can put the words in its own order. Inline tags and EJS
// outputs become tokens ⟦0⟧, ⟦1⟧… in the key; the translation carries the same tokens and they are put back as they were.
// Also gives JS string literals with Russian inside <% %> code, inline <script> and on…="" handlers.
const CYR = /[А-Яа-яЁё]/;
const INLINE = new Set(['b', 'strong', 'em', 'i', 'code', 'a', 'br', 'small', 'span', 'kbd', 's', 'u', 'mark', 'time', 'sup', 'sub']);
const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'value', 'label', 'data-confirm', 'content']);

/** JS string literals with Russian in a piece of code: [{ start, end, text }] (positions of the content, without quotes). */
function jsLiterals(code, offset = 0) {
  const out = [];
  for (let i = 0; i < code.length; i++) {
    const q = code[i];
    if (q === '/' && code[i + 1] === '/') { const e = code.indexOf('\n', i); i = e < 0 ? code.length : e; continue; }
    if (q === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 1; continue; }
    if (q !== "'" && q !== '"' && q !== '`') continue;
    let j = i + 1;
    while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++; }
    const text = code.slice(i + 1, j);
    if (CYR.test(text)) out.push({ start: offset + i + 1, end: offset + j, text, quote: q });
    i = j;
  }
  return out;
}

/** Tokens of the template: { t: 'ejs'|'tag'|'text', s, start, end, kind } */
function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    if (src.startsWith('<%', i)) {
      const e = src.indexOf('%>', i + 2); const end = e < 0 ? src.length : e + 2;
      const mark = src[i + 2];
      toks.push({ t: 'ejs', s: src.slice(i, end), start: i, end, kind: mark === '=' || mark === '-' ? 'out' : mark === '#' ? 'comment' : 'code' });
      i = end; continue;
    }
    if (src[i] === '<' && /[a-zA-Z/!]/.test(src[i + 1] || '')) {
      // a tag may contain EJS inside its attributes: skip over <% %> while looking for '>'
      let j = i + 1; let quote = null;
      while (j < src.length) {
        if (src.startsWith('<%', j)) { const e = src.indexOf('%>', j + 2); j = e < 0 ? src.length : e + 2; continue; }
        const c = src[j];
        if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
        j++;
      }
      const s = src.slice(i, j + 1);
      const name = (s.match(/^<\/?([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase() || '';
      toks.push({ t: 'tag', s, start: i, end: j + 1, name, closing: s[1] === '/' });
      i = j + 1; continue;
    }
    let j = i + 1;
    while (j < src.length && !(src[j] === '<' && (src[j + 1] === '%' || /[a-zA-Z/!]/.test(src[j + 1] || '')))) j++;
    toks.push({ t: 'text', s: src.slice(i, j), start: i, end: j });
    i = j;
  }
  return toks;
}

/**
 * All translatable pieces of a template: [{ start, end, key, tokens, type }]. `key` is what the dictionary is looked up by;
 * `tokens` are the originals of ⟦n⟧. Pieces never overlap.
 */
function units(src) {
  const toks = tokenize(src);
  const out = [];
  let run = []; // soft tokens of the current piece
  const flush = () => {
    // trim tags/outputs and whitespace at both ends; keep the piece only if its text is Russian
    let a = 0, b = run.length - 1;
    const isText = (t) => t.t === 'text';
    while (a <= b && (!isText(run[a]) || !run[a].s.trim())) a++;
    while (b >= a && (!isText(run[b]) || !run[b].s.trim())) b--;
    if (a <= b && run.slice(a, b + 1).some((t) => isText(t) && CYR.test(t.s))) {
      const first = run[a], last = run[b];
      const lead = first.s.length - first.s.trimStart().length, trail = last.s.length - last.s.trimEnd().length;
      const start = first.start + lead, end = last.end - trail;
      const tokens = []; let key = '';
      for (let k = a; k <= b; k++) {
        const t = run[k];
        if (t.t === 'text') key += src.slice(Math.max(t.start, start), Math.min(t.end, end));
        else { key += `⟦${tokens.length}⟧`; tokens.push(t.s); }
      }
      out.push({ start, end, key: key.replace(/\s+/g, ' '), tokens, type: 'text' });
    }
    run = [];
  };
  let skip = null; // inside <script>/<style>
  for (const t of toks) {
    if (skip) {
      if (t.t === 'tag' && t.closing && t.name === skip) { skip = null; continue; }
      if (skip === 'script' && t.t === 'text') for (const l of jsLiterals(t.s, t.start)) out.push({ start: l.start, end: l.end, key: l.text, tokens: [], type: 'js', quote: l.quote });
      if (skip === 'script' && t.t === 'ejs') { /* JSON from the server: translated as data */ }
      continue;
    }
    if (t.t === 'ejs') {
      if (t.kind === 'code' || t.kind === 'out') {
        const body = t.s.slice(t.kind === 'out' ? 3 : 2, -2);
        for (const l of jsLiterals(body, t.start + (t.kind === 'out' ? 3 : 2))) out.push({ start: l.start, end: l.end, key: l.text, tokens: [], type: 'js', quote: l.quote });
      }
      if (t.kind === 'out' && !/^\s*<%-\s*include\(/.test(t.s)) { run.push(t); continue; }
      flush(); continue;
    }
    if (t.t === 'tag') {
      // attributes with text
      const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g; let m;
      const body = t.s;
      while ((m = re.exec(body))) {
        const name = m[1].toLowerCase(); const val = m[3] ?? m[4]; if (!CYR.test(val)) continue;
        const vStart = t.start + m.index + m[0].indexOf(m[2]) + 1;
        if (name.startsWith('on')) { for (const l of jsLiterals(val, vStart)) out.push({ start: l.start, end: l.end, key: l.text, tokens: [], type: 'js', quote: l.quote }); continue; }
        if (!TEXT_ATTRS.has(name) && !name.startsWith('data-')) continue;
        // EJS inside the value becomes tokens
        const parts = val.split(/(<%[\s\S]*?%>)/); const tokens = []; let key = '';
        for (const p of parts) { if (p.startsWith('<%')) { key += `⟦${tokens.length}⟧`; tokens.push(p); } else key += p; }
        if (CYR.test(key)) out.push({ start: vStart, end: vStart + val.length, key: key.trim(), tokens, type: 'attr', raw: val });
      }
      if (!t.closing && (t.name === 'script' || t.name === 'style')) { flush(); skip = t.name; continue; }
      if (INLINE.has(t.name)) { run.push(t); continue; }
      flush(); continue;
    }
    run.push(t);
  }
  flush();
  // attribute pieces sit inside tag tokens that may be inside a text piece: drop text pieces that contain them? No —
  // a text piece holds the whole tag as a token, so an inner attribute piece is replaced only through that token.
  return out.sort((x, y) => x.start - y.start);
}

/** Puts the translation of each piece into the template. `translate(key, unit)` returns the English (with tokens) or null. */
function apply(src, translate) {
  const list = units(src);
  // pieces inside a bigger piece (attribute inside an inline tag that is a token of a text piece) are applied to the token
  const top = []; for (const u of list) { const outer = top.find((o) => u.start >= o.start && u.end <= o.end && o !== u); if (outer) (outer.inner = outer.inner || []).push(u); else top.push(u); }
  let res = ''; let pos = 0;
  for (const u of top) {
    res += src.slice(pos, u.start);
    let tokens = u.tokens;
    if (u.inner) tokens = tokens.map((tok) => { const at = src.indexOf(tok, u.start); return at < 0 ? tok : apply(tok, translate); });
    const en = translate(u.key, u);
    if (en == null) res += u.inner ? rebuild(src.slice(u.start, u.end), u, tokens) : src.slice(u.start, u.end);
    else res += en.replace(/⟦(\d+)⟧/g, (m, n) => tokens[Number(n)] ?? '');
    pos = u.end;
  }
  return res + src.slice(pos);
}
function rebuild(text, u, tokens) { return text.replace(/<%[\s\S]*?%>|<[^>]+>/g, (m) => (u.tokens.includes(m) ? tokens[u.tokens.indexOf(m)] : m)); }

module.exports = { units, apply, jsLiterals, tokenize, CYR };
