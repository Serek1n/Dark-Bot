// DCP — «Discord Chat Preview»: one renderer for every message preview of the panel (the «Сообщения» builder, welcome,
// level-up, achievements, own commands, template previews). It draws a message as Discord's current client does: the
// header (round avatar, the APP badge, the time), Discord markdown (headings, subtext, lists, quotes, code and ANSI
// blocks, spoilers, masked links, mentions, timestamps, custom and jumbo emoji), classic embeds (author, title,
// thumbnail, fields in rows of up to three, image, footer), buttons in all six styles and select menus, and Components
// V2 (container, text, section, thumbnail, gallery, file, separator). Themes Ash / Dark / Onyx / Light and the
// desktop / phone width are switched in the preview's own bar; the limits of Discord's API are checked as you type.
//
//   DCP.render(payload, opts) → HTML        payload: Discord JSON (content, embeds, components, flags, attachments)
//   DCP.md(text, opts) → HTML               Discord markdown alone
//   DCP.validate(payload) → [{ level, text }]
//   DCP.mount(host, draw, { onImport })     a preview with its bar; draw() returns { payload, opts }; returns { update }
//   DCP.toolbar(textarea)                   the formatting bar over a text field (textareas with data-md get it by themselves)
//   DCP.context()                           a promise of the server's names: roles, channels, emoji, the bot, the viewer
//
// Everything that comes from a field is escaped; only known marks become tags. Pictures load only from https.
(function () {
  'use strict';
  if (window.DCP) return;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>\x22\x27]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // https pictures, or the panel's own (a path on this site, e.g. the card previews)
  var safeImg = function (u) { return /^(?:https:\/\/[^\s\x22\x27<>\\]+|\/(?!\/)[^\s\x22\x27<>\\]*)$/i.test(String(u || '')) ? esc(u) : ''; };
  var safeLink = function (u) { return /^https?:\/\/[^\s\x22\x27<>\\]+$/i.test(String(u || '')) ? esc(u) : ''; };
  var lang = function () { return (document.documentElement.getAttribute('lang') || 'ru').slice(0, 2) === 'en' ? 'en-GB' : 'ru-RU'; };
  var V2 = 1 << 15;

  // ---------- the server's names (for mentions and emoji) ----------
  var CTX = { bot: { name: 'Dark', avatar: '', verified: true }, user: { id: '', name: 'Вы', avatar: '' }, roles: {}, channels: {}, emojis: [], guildName: '' };
  var ctxPromise = null;
  function guildId() { var m = /\/dashboard\/(\d{15,25})/.exec(location.pathname); return m ? m[1] : ''; }
  function context() {
    if (ctxPromise) return ctxPromise;
    var g = guildId();
    if (!g) { ctxPromise = Promise.resolve(CTX); return ctxPromise; }
    ctxPromise = fetch('/dashboard/' + g + '/preview-context', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return CTX;
        CTX.bot = j.bot || CTX.bot; CTX.user = j.user || CTX.user; CTX.guildName = j.guildName || '';
        (j.roles || []).forEach(function (r) { CTX.roles[r.id] = r; });
        (j.channels || []).forEach(function (c) { CTX.channels[c.id] = c; });
        CTX.emojis = j.emojis || [];
        listeners.forEach(function (f) { try { f(); } catch (e) { /* one preview must not stop the others */ } });
        return CTX;
      })
      .catch(function () { return CTX; });
    return ctxPromise;
  }
  var listeners = [];

  // ---------- timestamps <t:unix:style> ----------
  function stamp(sec, style) {
    var d = new Date(sec * 1000); var L = lang();
    if (isNaN(d)) return String(sec);
    var o = function (x) { return new Intl.DateTimeFormat(L, x).format(d); };
    switch (style) {
      case 't': return o({ hour: '2-digit', minute: '2-digit' });
      case 'T': return o({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
      case 'd': return o({ day: '2-digit', month: '2-digit', year: 'numeric' });
      case 'D': return o({ day: 'numeric', month: 'long', year: 'numeric' });
      case 'F': return o({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      case 's': return o({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      case 'S': return o({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      case 'R': {
        var diff = (d - Date.now()) / 1000; var abs = Math.abs(diff);
        var units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
        for (var i = 0; i < units.length; i++) if (abs >= units[i][1] || units[i][0] === 'second') return new Intl.RelativeTimeFormat(L, { numeric: 'auto' }).format(Math.round(diff / units[i][1]), units[i][0]);
        return '';
      }
      default: return o({ day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
  var STYLES = [['t', 'Короткое время'], ['T', 'Время с секундами'], ['d', 'Короткая дата'], ['D', 'Длинная дата'], ['f', 'Дата и время'], ['F', 'С днём недели'], ['s', 'Короткие дата и время'], ['S', 'Дата и время с секундами'], ['R', 'Относительное']];

  // ---------- ANSI ----------
  var ANSI_FG = { 30: '#4f545c', 31: '#dc322f', 32: '#859900', 33: '#b58900', 34: '#268bd2', 35: '#d33682', 36: '#2aa198', 37: '#ffffff' };
  var ANSI_BG = { 40: '#002b36', 41: '#cb4b16', 42: '#586e75', 43: '#657b83', 44: '#839496', 45: '#6c71c4', 46: '#93a1a1', 47: '#fdf6e3' };
  function ansiHtml(text, plain) {
    var out = ''; var st = {}; var parts = String(text).split(/\u001b\[([\d;]*)m/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2) {
        (parts[i] || '0').split(';').forEach(function (c) {
          c = +c;
          if (c === 0) st = {}; else if (c === 1) st.b = 1; else if (c === 4) st.u = 1; else if (ANSI_FG[c]) st.fg = ANSI_FG[c]; else if (ANSI_BG[c]) st.bg = ANSI_BG[c];
        });
      } else if (parts[i]) {
        var css = plain ? '' : (st.fg ? 'color:' + st.fg + ';' : '') + (st.bg ? 'background:' + st.bg + ';' : '') + (st.b ? 'font-weight:700;' : '') + (st.u ? 'text-decoration:underline;' : '');
        out += css ? '<span style="' + css + '">' + esc(parts[i]) + '</span>' : esc(parts[i]);
      }
    }
    return out;
  }

  // ---------- markdown ----------
  var EMOJI_RE = /^(?:\s|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|‍|️|⃣|<a?:\w{2,32}:\d{15,25}>)+$/u;
  var EMOJI_ONE = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*|[0-9#*]️?⃣|\p{Regional_Indicator}{2}|<a?:\w{2,32}:\d{15,25}>/gu;
  function isJumbo(text) {
    var t = String(text || '').trim();
    if (!t || !EMOJI_RE.test(t)) return false;
    var n = (t.match(EMOJI_ONE) || []).length;
    return n > 0 && n <= 27 && !/[0-9A-Za-zА-Яа-я]/.test(t.replace(/<a?:\w{2,32}:\d{15,25}>/g, '').replace(/[0-9#*]️?⃣/g, ''));
  }
  var CHANNEL_ICON = { 0: '#', 5: '📣', 2: '🔊', 13: '🎙️', 15: '💬', 16: '🖼️', 11: '🧵', 12: '🧵' };
  var NAV = { customize: 'Каналы и роли', browse: 'Просмотр каналов', guide: 'Путеводитель по серверу', 'linked-roles': 'Связанные роли' };

  /** Inline marks of one piece of text. `hold` keeps finished HTML out of the later replacements. */
  function inline(src, o, hold) {
    var s = String(src);
    // escapes: \* \_ \~ \| \` \> \# \- \\ show the character itself
    s = s.replace(/\\([*_~|\x60>#\-\\[\]()<:@])/g, function (_, ch) { return hold(esc(ch)); });
    s = s.replace(/\x60([^\x60\n]+)\x60/g, function (_, code) { return hold('<code class="dcp-icode">' + esc(code) + '</code>'); });
    // raw tokens before escaping (their < > are part of the syntax)
    s = s.replace(/<t:(-?\d{1,13})(?::([tTdDfFsSR]))?>/g, function (_, t, f) { return hold('<span class="dcp-time" title="' + esc(stamp(+t, 'F')) + '">' + esc(stamp(+t, f || 'f')) + '</span>'); });
    s = s.replace(/<(a?):(\w{2,32}):(\d{15,25})>/g, function (_, a, name, id) { return hold('<img class="dcp-emoji" alt=":' + esc(name) + ':" title=":' + esc(name) + ':" src="https://cdn.discordapp.com/emojis/' + id + '.' + (a ? 'gif' : 'webp') + '?size=96" />'); });
    s = s.replace(/<@!?(\d{15,25})>/g, function (_, id) { var me = CTX.user && CTX.user.id === id; var u = (o.users && o.users[id]) || (me ? CTX.user : null); return hold('<span class="dcp-mention">@' + esc(u ? u.name : 'участник') + '</span>'); });
    s = s.replace(/<@&(\d{15,25})>/g, function (_, id) {
      var r = CTX.roles[id];
      var c = r && r.color ? '#' + ('000000' + Number(r.color).toString(16)).slice(-6) : '';
      return hold('<span class="dcp-mention' + (c ? ' role' : '') + '"' + (c ? ' style="--rc:' + c + '"' : '') + '>@' + esc(r ? r.name : 'роль') + '</span>');
    });
    s = s.replace(/<#(\d{15,25})>/g, function (_, id) { var c = CTX.channels[id]; return hold('<span class="dcp-mention"><i class="dcp-chi">' + esc(CHANNEL_ICON[c ? c.type : 0] || '#') + '</i>' + esc(c ? c.name : 'неизвестный-канал') + '</span>'); });
    s = s.replace(/<\/([\w-]{1,32}(?: [\w-]{1,32}){0,2}):(\d{15,25})>/g, function (_, name) { return hold('<span class="dcp-mention cmd">/' + esc(name) + '</span>'); });
    s = s.replace(/<id:(customize|browse|guide|linked-roles)(?::\d{15,25})?>/g, function (_, k) { return hold('<span class="dcp-mention">' + esc(NAV[k]) + '</span>'); });
    s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, function (_, u) { return hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(u) + '</a>'); });
    if (o.links !== false) {
      s = s.replace(/\[([^\]\n]{1,256})\]\((https?:\/\/[^\s)\x22]+)(?: \x22([^\x22\n]{0,256})\x22)?\)/g, function (_, t, u, tip) { return hold('<a href="' + esc(u) + '" title="' + esc(tip || u) + '" target="_blank" rel="noopener noreferrer nofollow">' + inlineMarks(esc(t)) + '</a>'); });
      s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;\x22\x27)\]])/g, function (_, pre, u) { return pre + hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(u) + '</a>'); });
    }
    s = s.replace(/@(everyone|here)\b/g, function (_, w) { return hold('<span class="dcp-mention">@' + w + '</span>'); });
    if (o.tokens) s = s.replace(/\{([a-z_][\w.]{0,40})\}/gi, function (_, k) { return hold('<span class="dcp-token" title="Заменитель — в Discord здесь будет значение">{' + esc(k) + '}</span>'); });
    return inlineMarks(esc(s));
  }
  function inlineMarks(s) {
    var prev;
    do { // nested marks in any order: repeat until nothing changes
      prev = s;
      s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dcp-spoiler" tabindex="0" role="button" aria-label="Спойлер">$1</span>')
        .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<b><i>$1</i></b>')
        .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
        .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
        .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
        .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>')
        .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1<i>$2</i>');
    } while (s !== prev);
    return s;
  }

  /**
   * Discord markdown → HTML. opts: headings (false in titles and field names), links (false in titles), lists, quotes,
   * plain (true: ANSI without colours, as on a phone), users ({ id: { name } }).
   */
  function md(src, opts) {
    opts = opts || {};
    var keep = [];
    var hold = function (html) { keep.push(html); return '\u0000' + (keep.length - 1) + '\u0000'; };
    var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    // code blocks first: nothing inside them is markdown
    text = text.replace(/\x60{3}(?:([\w+#.-]{1,20})\n)?([\s\S]*?)\x60{3}/g, function (_, lng, code, at, all) {
      var body = code.replace(/^\n/, '').replace(/\n$/, '');
      var before = at > 0 && all[at - 1] !== '\n' ? '\n' : ''; var after = all[at + _.length] !== undefined && all[at + _.length] !== '\n' ? '\n' : '';
      return before + hold('<pre class="dcp-code' + (lng ? ' lang-' + esc(lng.toLowerCase()) : '') + '"><code>' + (lng && lng.toLowerCase() === 'ansi' ? ansiHtml(body, opts.plain) : esc(body)) + '</code></pre>') + after;
    });
    var lines = text.split('\n'); var html = []; var quoteRest = false;
    var quote = []; var list = []; // list: [{ depth, ordered, start, html }]
    var flushQuote = function () { if (quote.length) { html.push('<blockquote class="dcp-quote"><div>' + block(quote.join('\n'), true) + '</div></blockquote>'); quote = []; } };
    var flushList = function () {
      if (!list.length) return;
      var out = ''; var stack = [];
      list.forEach(function (it) {
        while (stack.length && stack[stack.length - 1].depth > it.depth) out += '</li></' + stack.pop().tag + '>';
        var top = stack[stack.length - 1];
        if (top && top.depth === it.depth && top.tag !== (it.ordered ? 'ol' : 'ul')) { out += '</li></' + stack.pop().tag + '>'; top = stack[stack.length - 1]; } // a bulleted list after a numbered one: a new list
        if (!top || top.depth < it.depth) { var tag = it.ordered ? 'ol' : 'ul'; stack.push({ depth: it.depth, tag: tag }); out += '<' + tag + ' class="dcp-list d' + Math.min(stack.length, 3) + '"' + (it.ordered && it.start !== 1 ? ' start="' + it.start + '"' : '') + '><li>'; } else out += '</li><li>';
        out += it.html;
      });
      while (stack.length) out += '</li></' + stack.pop().tag + '>';
      html.push(out); list = [];
    };
    function block(t, inQuote) {
      // one level of lines inside a quote (no nested quotes, as in Discord)
      return t.split('\n').map(function (l) { return lineHtml(l, inQuote); }).join('');
    }
    function lineHtml(line, inQuote) {
      var h = opts.headings === false ? null : /^(#{1,3}) +(.+)$/.exec(line);
      if (h) return '<div class="dcp-h' + h[1].length + '">' + inline(h[2], opts, hold) + '</div>';
      var sub = opts.headings === false ? null : /^-# +(.+)$/.exec(line);
      if (sub) return '<div class="dcp-sub">' + inline(sub[1], opts, hold) + '</div>';
      if (/^\u0000\d+\u0000$/.test(line)) return line;
      return '<div class="dcp-line">' + (line ? inline(line, opts, hold) : '<br>') + '</div>';
    }
    lines.forEach(function (line) {
      if (quoteRest) { quote.push(line); return; }
      var q3 = opts.quotes === false ? null : /^>>> ?(.*)$/.exec(line);
      if (q3) { flushList(); quoteRest = true; quote.push(q3[1]); return; }
      var q = opts.quotes === false ? null : /^> (.*)$|^>$/.exec(line);
      if (q) { flushList(); quote.push(q[1] || ''); return; }
      flushQuote();
      var li = opts.lists === false ? null : /^( *)([-*]|(\d{1,9})\.) +(.+)$/.exec(line);
      if (li) { list.push({ depth: li[1].length ? Math.min(2, Math.ceil(li[1].length / 2)) : 0, ordered: Boolean(li[3]), start: li[3] ? +li[3] : 1, html: inline(li[4], opts, hold) }); return; }
      flushList();
      html.push(lineHtml(line, false));
    });
    flushQuote(); flushList();
    var out = html.join('');
    for (var guard = 0; guard < 3 && /\u0000\d+\u0000/.test(out); guard++) out = out.replace(/\u0000(\d+)\u0000/g, function (_, n) { return keep[+n]; });
    return out;
  }
  function mdBlock(text, opts) {
    return '<div class="dcp-md' + (isJumbo(text) ? ' jumbo' : '') + '">' + md(text, opts) + '</div>';
  }

  // ---------- colours ----------
  function colorOf(c) {
    if (typeof c === 'number' && isFinite(c)) return '#' + ('000000' + (c >>> 0).toString(16)).slice(-6);
    var s = String(c || '').trim();
    if (/^#?[0-9a-f]{6}$/i.test(s)) return s[0] === '#' ? s : '#' + s;
    return '';
  }

  // ---------- pieces of a message ----------
  var ICON_LINK = '<svg class="dcp-ext" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 4H16V9M16 4L9 11M14 12V16H4V6H8"/></svg>';
  var ICON_FILE = '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M2 2h18l8 8v28H2z" fill="currentColor" opacity=".18"/><path d="M20 2v8h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var CHECK = '<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function emojiHtml(e) {
    if (!e) return '';
    if (typeof e === 'string') { var m = /^<?(a?):?(\w{2,32}):(\d{15,25})>?$/.exec(e); if (m) e = { animated: Boolean(m[1]), name: m[2], id: m[3] }; else return '<span class="dcp-bemoji">' + esc(e) + '</span>'; }
    if (e.id) return '<img class="dcp-bemoji" alt="" src="https://cdn.discordapp.com/emojis/' + esc(e.id) + '.' + (e.animated ? 'gif' : 'webp') + '?size=48" />';
    return e.name ? '<span class="dcp-bemoji">' + esc(e.name) + '</span>' : '';
  }
  var BTN = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link', 6: 'premium' };
  function buttonHtml(b) {
    var st = BTN[b.style] || (b.url ? 'link' : 'secondary');
    if (st === 'premium') return '<span class="dcp-btn premium' + (b.disabled ? ' off' : '') + '">🛒 <span>Купить</span></span>';
    return '<span class="dcp-btn ' + st + (b.disabled ? ' off' : '') + '"' + (st === 'link' && safeLink(b.url) ? ' title="' + safeLink(b.url) + '"' : '') + '>' + emojiHtml(b.emoji) + (b.label ? '<span>' + esc(b.label) + '</span>' : '') + (st === 'link' ? ICON_LINK : '') + '</span>';
  }
  function selectHtml(s) {
    var chosen = (s.options || []).filter(function (o) { return o.default; });
    var text = chosen.length ? chosen.map(function (o) { return esc(o.label); }).join(', ') : esc(s.placeholder || (s.type === 5 ? 'Выберите участника' : s.type === 6 ? 'Выберите роль' : s.type === 8 ? 'Выберите канал' : 'Выберите вариант'));
    return '<div class="dcp-select' + (s.disabled ? ' off' : '') + (chosen.length ? '' : ' empty') + '"><span>' + text + '</span><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg></div>';
  }
  function rowHtml(r) {
    var items = r.components || [];
    if (items.length && items[0].type !== 2) return '<div class="dcp-row">' + selectHtml(items[0]) + '</div>';
    return '<div class="dcp-row">' + items.map(buttonHtml).join('') + '</div>';
  }
  function mediaUrl(u, files) {
    u = String(u || '');
    var m = /^attachment:\/\/(.+)$/.exec(u);
    if (m) return files && files[m[1]] ? files[m[1]] : '';
    return u;
  }
  function imgTag(url, cls, alt, files) {
    var u = safeImg(mediaUrl(url, files));
    return u ? '<img class="' + cls + '" src="' + u + '" alt="' + esc(alt || '') + '" loading="lazy" />' : '<span class="' + cls + ' dcp-noimg" title="Картинка не показана: нужна ссылка https://"></span>';
  }
  function gallery(items, files) {
    items = items.slice(0, 10);
    return '<div class="dcp-gallery n' + Math.min(items.length, 5) + '">' + items.map(function (it) {
      var u = it.media ? it.media.url : it.url;
      return '<span class="dcp-gi' + (it.spoiler ? ' spoiler' : '') + '">' + imgTag(u, 'dcp-gimg', it.description, files) + (it.description ? '<i class="dcp-alt">ALT</i>' : '') + (it.spoiler ? '<i class="dcp-spoil">SPOILER</i>' : '') + '</span>';
    }).join('') + '</div>';
  }
  function fileCard(name, size, spoiler) {
    return '<div class="dcp-file' + (spoiler ? ' spoiler' : '') + '">' + ICON_FILE + '<div><b>' + esc(name || 'file') + '</b><small>' + esc(size || '') + '</small></div><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3v10M5 9l5 5 5-5M4 17h12"/></svg></div>';
  }

  // embed fields: inline ones share a row (up to three), anything else starts a new row
  function fieldsHtml(fields, o) {
    var rows = []; var cur = null;
    fields.slice(0, 25).forEach(function (f) {
      if (!f.inline) { rows.push([f]); cur = null; return; }
      if (!cur || cur.length === 3) { cur = []; rows.push(cur); }
      cur.push(f);
    });
    return '<div class="dcp-fields">' + rows.map(function (r) {
      return '<div class="dcp-frow n' + r.length + '">' + r.map(function (f) {
        return '<div class="dcp-field"><div class="dcp-fname">' + md(f.name, { headings: false, lists: false, quotes: false, users: o.users, tokens: o.tokens }) + '</div><div class="dcp-fvalue">' + md(f.value, { headings: false, plain: o.plain, users: o.users, tokens: o.tokens }) + '</div></div>';
      }).join('') + '</div>';
    }).join('') + '</div>';
  }
  function whenText(d) {
    var now = new Date(); var L = lang();
    var hm = new Intl.DateTimeFormat(L, { hour: '2-digit', minute: '2-digit' }).format(d);
    if (d.toDateString() === now.toDateString()) return (L === 'en-GB' ? 'Today at ' : 'Сегодня в ') + hm;
    return new Intl.DateTimeFormat(L, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) + ' ' + hm;
  }
  function embedHtml(e, o) {
    var color = colorOf(e.color);
    var thumb = e.thumbnail && e.thumbnail.url ? imgTag(e.thumbnail.url, 'dcp-thumb', '', o.files) : '';
    var h = '<div class="dcp-embed"' + (color ? ' style="--bar:' + color + '"' : '') + '><div class="dcp-egrid' + (thumb ? ' has-thumb' : '') + '"><div class="dcp-emain">';
    if (e.author && e.author.name) {
      var an = safeLink(e.author.url) ? '<a href="' + safeLink(e.author.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(e.author.name) + '</a>' : '<span>' + esc(e.author.name) + '</span>';
      h += '<div class="dcp-author">' + (e.author.icon_url ? imgTag(e.author.icon_url, 'dcp-aicon', '', o.files) : '') + an + '</div>';
    }
    if (e.title) {
      var t = md(e.title, { headings: false, lists: false, quotes: false, links: false, users: o.users, tokens: o.tokens });
      h += '<div class="dcp-etitle">' + (safeLink(e.url) ? '<a href="' + safeLink(e.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + t + '</a>' : t) + '</div>';
    }
    if (e.description) h += '<div class="dcp-edesc">' + md(e.description, { plain: o.plain, users: o.users, tokens: o.tokens }) + '</div>';
    if (e.fields && e.fields.length) h += fieldsHtml(e.fields.filter(function (f) { return f && (f.name || f.value); }), o);
    h += '</div>' + thumb + '</div>';
    if (e.image && e.image.url) h += imgTag(e.image.url, 'dcp-eimage', '', o.files);
    var ts = e.timestamp ? new Date(e.timestamp) : null;
    if ((e.footer && e.footer.text) || (ts && !isNaN(ts))) {
      h += '<div class="dcp-efoot">' + (e.footer && e.footer.icon_url && e.footer.text ? imgTag(e.footer.icon_url, 'dcp-ficon', '', o.files) : '') + '<span>' + esc(e.footer ? e.footer.text : '') + (e.footer && e.footer.text && ts && !isNaN(ts) ? ' • ' : '') + (ts && !isNaN(ts) ? esc(whenText(ts)) : '') + '</span></div>';
    }
    return h + '</div>';
  }

  // Components V2
  function v2(list, o, inContainer) {
    return (list || []).map(function (c) {
      if (!c) return '';
      switch (c.type) {
        case 10: return mdBlock(c.content, { plain: o.plain, users: o.users, tokens: o.tokens });
        case 14: return '<div class="dcp-sep' + (Number(c.spacing) === 2 ? ' big' : '') + (c.divider !== false ? ' line' : '') + '"></div>';
        case 12: return gallery(c.items || [], o.files);
        case 13: return fileCard(String((c.file && c.file.url) || '').replace(/^attachment:\/\//, ''), '', c.spoiler);
        case 1: return rowHtml(c);
        case 9: {
          var acc = c.accessory || {};
          var right = acc.type === 11 ? '<span class="dcp-sthumb' + (acc.spoiler ? ' spoiler' : '') + '">' + imgTag(acc.media && acc.media.url, 'dcp-simg', acc.description, o.files) + (acc.description ? '<i class="dcp-alt">ALT</i>' : '') + '</span>' : acc.type === 2 ? buttonHtml(acc) : '';
          return '<div class="dcp-section"><div class="dcp-stext">' + (c.components || []).map(function (t) { return mdBlock(t.content, { plain: o.plain, users: o.users, tokens: o.tokens }); }).join('') + '</div>' + right + '</div>';
        }
        case 17: {
          if (inContainer) return '';
          var col = colorOf(c.accent_color);
          return '<div class="dcp-container' + (c.spoiler ? ' spoiler' : '') + (col ? ' has-bar' : '') + '"' + (col ? ' style="--bar:' + col + '"' : '') + '>' + v2(c.components, o, true) + (c.spoiler ? '<i class="dcp-spoil">SPOILER</i>' : '') + '</div>';
        }
        default: return '';
      }
    }).join('');
  }

  /**
   * The whole message. opts: author { name, avatar, bot, verified, webhook, color }, files { name: url } for attachment://,
   * device ('desktop' | 'mobile'), interaction { user, command }, ephemeral, edited, empty (text when there is nothing).
   */
  function render(p, opts) {
    p = p || {}; opts = opts || {};
    var o = { plain: opts.device === 'mobile', files: opts.files || {}, users: opts.users, tokens: Boolean(opts.tokens) };
    var a = opts.author || {};
    var name = a.name || (CTX.bot && CTX.bot.name) || 'Dark';
    var avatar = safeImg(a.avatar || (a.webhook ? '' : CTX.bot && CTX.bot.avatar));
    var badge = a.webhook ? '' : '<span class="dcp-app">' + ((a.verified !== false && CTX.bot && CTX.bot.verified !== false) ? CHECK : '') + 'APP</span>';
    var v2on = Boolean(p.v2) || (Number(p.flags) & V2) === V2;
    var body = '';
    if (v2on) body += v2(p.components, o, false);
    else {
      if (p.content) body += mdBlock(p.content, { plain: o.plain, users: o.users, tokens: o.tokens });
      (p.embeds || []).slice(0, 10).forEach(function (e) { if (e) body += embedHtml(e, o); });
      var att = (p.attachments || []).filter(function (x) { return x && x.url; });
      var imgs = att.filter(function (x) { return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(x.filename || x.url) && !(p.embeds || []).some(function (e) { return e && e.image && e.image.url === 'attachment://' + x.filename; }); });
      if (imgs.length) body += gallery(imgs.map(function (x) { return { url: x.url, description: x.description, spoiler: /^SPOILER_/.test(x.filename || '') }; }), o.files);
      att.filter(function (x) { return imgs.indexOf(x) < 0 && !/\.(png|jpe?g|gif|webp)(\?|$)/i.test(x.filename || x.url); }).forEach(function (x) { body += fileCard(x.filename, x.size, false); });
      (p.components || []).slice(0, 5).forEach(function (r) { if (r && r.type === 1) body += rowHtml(r); });
    }
    if (!body) body = '<div class="dcp-empty">' + esc(opts.empty || 'Здесь появится сообщение.') + '</div>';
    var mentionsMe = !v2on && /<@!?(\d+)>|@everyone|@here/.test(p.content || '') && (/@everyone|@here/.test(p.content || '') || (CTX.user && CTX.user.id && (p.content || '').indexOf('<@' + CTX.user.id + '>') >= 0) || (CTX.user && CTX.user.id && (p.content || '').indexOf('<@!' + CTX.user.id + '>') >= 0));
    var head = '';
    if (opts.interaction) {
      head += '<div class="dcp-ctx"><span class="dcp-spine"></span><span class="dcp-mini">' + (safeImg(CTX.user.avatar) ? '<img src="' + safeImg(CTX.user.avatar) + '" alt="" />' : '') + '</span><b>' + esc(opts.interaction.user || CTX.user.name || 'Участник') + '</b> использует <span class="dcp-cmd">/' + esc(opts.interaction.command || 'команда') + '</span></div>';
    }
    var time = whenText(opts.time ? new Date(opts.time) : new Date());
    return '<div class="dcp-msg' + (opts.ephemeral ? ' ephemeral' : '') + (mentionsMe ? ' mentioned' : '') + '">' + head +
      '<div class="dcp-line-msg"><div class="dcp-ava">' + (avatar ? '<img src="' + avatar + '" alt="" />' : '<span>' + esc(name.slice(0, 1).toUpperCase()) + '</span>') + '</div>' +
      '<div class="dcp-body"><div class="dcp-head"><b class="dcp-name"' + (colorOf(a.color) ? ' style="color:' + colorOf(a.color) + '"' : '') + '>' + esc(name) + '</b>' + badge + '<span class="dcp-when">' + esc(time) + '</span></div>' +
      '<div class="dcp-content">' + body + (opts.edited ? '<span class="dcp-edited">(изменено)</span>' : '') + '</div>' +
      (opts.ephemeral ? '<div class="dcp-eph"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/><circle cx="10" cy="10" r="2.5"/></svg>Это сообщение видите только вы • <u>Скрыть сообщение</u></div>' : '') +
      '</div></div></div>';
  }

  // ---------- limits of Discord's API ----------
  function validate(p) {
    p = p || {}; var out = [];
    var err = function (t) { out.push({ level: 'error', text: t }); };
    var len = function (s) { return String(s || '').length; };
    var v2on = Boolean(p.v2) || (Number(p.flags) & V2) === V2;
    if (v2on) {
      var count = 0; var text = 0;
      var walk = function (list, depth, inContainer) {
        (list || []).forEach(function (c) {
          if (!c) return; count++;
          if (c.type === 10) text += len(c.content);
          if (c.type === 17) { if (inContainer) err('Контейнер нельзя класть в другой контейнер.'); var n = (c.components || []).length; if (n < 1 || n > 10) err('В контейнере должно быть от 1 до 10 блоков (сейчас ' + n + ').'); walk(c.components, depth + 1, true); }
          if (c.type === 9) { var m = (c.components || []).length; if (m < 1 || m > 3) err('В блоке «текст с картинкой или кнопкой» от 1 до 3 текстов (сейчас ' + m + ').'); walk(c.components, depth + 1, inContainer); if (c.accessory) count++; }
          if (c.type === 12) { var g = (c.items || []).length; if (g < 1 || g > 10) err('В галерее от 1 до 10 картинок (сейчас ' + g + ').'); }
          if (c.type === 1) walk(c.components, depth + 1, inContainer);
        });
      };
      walk(p.components, 0, false);
      if (count > 40) err('Компонентов больше 40 (сейчас ' + count + ').');
      if (text > 4000) err('Во всех текстах вместе больше 4000 символов (сейчас ' + text + ').');
      if (p.content || (p.embeds && p.embeds.length)) out.push({ level: 'warn', text: 'В формате «Компоненты» обычный текст и эмбеды не отправляются.' });
      return out;
    }
    if (len(p.content) > 2000) err('Текст длиннее 2000 символов (' + len(p.content) + ').');
    var embeds = p.embeds || [];
    if (embeds.length > 10) err('Эмбедов больше 10 (' + embeds.length + ').');
    var total = 0;
    embeds.forEach(function (e, i) {
      if (!e) return; var n = embeds.length > 1 ? ' (эмбед ' + (i + 1) + ')' : '';
      if (len(e.title) > 256) err('Заголовок длиннее 256 символов' + n + '.');
      if (len(e.description) > 4096) err('Текст эмбеда длиннее 4096 символов' + n + '.');
      if (e.author && len(e.author.name) > 256) err('Имя автора длиннее 256 символов' + n + '.');
      if (e.footer && len(e.footer.text) > 2048) err('Подпись внизу длиннее 2048 символов' + n + '.');
      var f = e.fields || [];
      if (f.length > 25) err('Полей больше 25' + n + '.');
      f.forEach(function (x) { if (len(x.name) > 256) err('Название поля длиннее 256 символов' + n + '.'); if (len(x.value) > 1024) err('Значение поля длиннее 1024 символов' + n + '.'); total += len(x.name) + len(x.value); });
      total += len(e.title) + len(e.description) + len(e.author && e.author.name) + len(e.footer && e.footer.text);
      if (!e.title && !e.description && !(f.length) && !(e.image && e.image.url) && !(e.thumbnail && e.thumbnail.url) && !(e.author && e.author.name) && !(e.footer && e.footer.text)) out.push({ level: 'warn', text: 'Пустой эмбед не отправится' + n + '.' });
    });
    if (total > 6000) err('Во всех эмбедах вместе больше 6000 символов (' + total + ').');
    var rows = (p.components || []).filter(function (r) { return r && r.type === 1; });
    if (rows.length > 5) err('Рядов кнопок больше 5.');
    rows.forEach(function (r) {
      var c = r.components || [];
      if (c.length > 5) err('В ряду больше 5 кнопок.');
      c.forEach(function (b) { if (b.type === 2 && len(b.label) > 80) err('Надпись кнопки длиннее 80 символов.'); });
    });
    return out;
  }

  // ---------- the preview with its bar ----------
  var THEMES = [['ash', 'Ash'], ['dark', 'Dark'], ['onyx', 'Onyx'], ['light', 'Light']];
  var DEVICES = [['desktop', 'ПК'], ['mobile', 'Телефон']];
  var store = { get: function (k, d) { try { return localStorage.getItem('dcp-' + k) || d; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem('dcp-' + k, v); } catch (e) { /* storage off */ } } };
  var hosts = [];
  function seg(kind, list, cur) {
    return '<span class="dcp-seg" role="group" aria-label="' + (kind === 'theme' ? 'Тема Discord' : 'Устройство') + '">' + list.map(function (x) { return '<button type="button" data-dcp-' + kind + '="' + x[0] + '" aria-pressed="' + (x[0] === cur) + '">' + esc(x[1]) + '</button>'; }).join('') + '</span>';
  }
  function mount(host, draw, mopts) {
    mopts = mopts || {};
    if (!host) return { update: function () {} };
    var theme = store.get('theme', document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    var device = store.get('device', 'desktop');
    host.classList.add('dcp-host');
    host.innerHTML = '<div class="dcp-bar">' + seg('theme', THEMES, theme) + seg('device', DEVICES, device) +
      '<button type="button" class="dcp-json" data-dcp-json aria-expanded="false">JSON</button></div>' +
      '<div class="dcp-stage"><div class="dcp" data-dcp-theme="' + theme + '" data-device="' + device + '"><div class="dcp-screen" data-dcp-screen></div></div></div>' +
      '<ul class="dcp-issues" data-dcp-issues hidden></ul>' +
      '<div class="dcp-jsonbox" data-dcp-jsonbox hidden><textarea rows="8" spellcheck="false" aria-label="Сообщение в формате Discord API JSON"></textarea><div class="dcp-jsonacts"><button type="button" class="btn btn-secondary" data-dcp-copy>Скопировать</button>' + (mopts.onImport ? '<button type="button" class="btn" data-dcp-import>Загрузить из JSON</button>' : '') + '<span class="dcp-jsonmsg" data-dcp-jsonmsg></span></div></div>';
    var root = host.querySelector('.dcp'); var screen = host.querySelector('[data-dcp-screen]');
    var issues = host.querySelector('[data-dcp-issues]'); var box = host.querySelector('[data-dcp-jsonbox]'); var ta = box.querySelector('textarea');
    var last = null;
    function update() {
      var r = draw() || {}; last = r.payload || {};
      var ro = Object.assign({}, r.opts || {}, { device: root.getAttribute('data-device') });
      screen.innerHTML = render(last, ro);
      screen.querySelectorAll('img').forEach(function (img) { img.addEventListener('error', function () { img.classList.add('dcp-broken'); }, { once: true }); });
      var list = r.validate === false ? [] : validate(last);
      issues.hidden = !list.length;
      issues.innerHTML = list.map(function (x) { return '<li class="' + x.level + '">' + esc(x.text) + '</li>'; }).join('');
      if (!box.hidden && document.activeElement !== ta) ta.value = JSON.stringify(api(last), null, 2);
    }
    host.addEventListener('click', function (ev) {
      var t = ev.target.closest('button'); if (!t || !host.contains(t)) {
        var sp = ev.target.closest('.dcp-spoiler, .dcp-container.spoiler, .dcp-gi.spoiler, .dcp-sthumb.spoiler'); if (sp) sp.classList.add('open'); return;
      }
      if (t.hasAttribute('data-dcp-theme')) { theme = t.getAttribute('data-dcp-theme'); store.set('theme', theme); syncAll(); return; }
      if (t.hasAttribute('data-dcp-device')) { device = t.getAttribute('data-dcp-device'); store.set('device', device); syncAll(); return; }
      if (t.hasAttribute('data-dcp-json')) { box.hidden = !box.hidden; t.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) ta.value = JSON.stringify(api(last), null, 2); return; }
      if (t.hasAttribute('data-dcp-copy')) { ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand('copy'); } say('Скопировано'); return; }
      if (t.hasAttribute('data-dcp-import')) {
        try { mopts.onImport(JSON.parse(ta.value)); say('Загружено'); } catch (e) { say('Это не JSON сообщения Discord'); }
      }
    });
    host.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('dcp-spoiler')) { ev.preventDefault(); ev.target.classList.add('open'); } });
    function say(t) { var m = host.querySelector('[data-dcp-jsonmsg]'); m.textContent = t; setTimeout(function () { m.textContent = ''; }, 2000); }
    var h = { host: host, update: update, sync: function () { root.setAttribute('data-dcp-theme', store.get('theme', theme)); root.setAttribute('data-device', store.get('device', device)); host.querySelectorAll('[data-dcp-theme]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-dcp-theme') === root.getAttribute('data-dcp-theme'))); }); host.querySelectorAll('[data-dcp-device]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-dcp-device') === root.getAttribute('data-device'))); }); update(); } };
    hosts.push(h); listeners.push(update);
    update(); context();
    return h;
  }
  function syncAll() { hosts.forEach(function (h) { h.sync(); }); }
  /** The payload as Discord's API takes it: colours as numbers, the V2 flag set, our own keys left out. */
  function api(p) {
    p = JSON.parse(JSON.stringify(p || {}));
    var v2on = Boolean(p.v2) || (Number(p.flags) & V2) === V2;
    delete p.v2; delete p.mentions; delete p.attachments;
    var num = function (c) { var h = colorOf(c); return h ? parseInt(h.slice(1), 16) : undefined; };
    if (v2on) {
      p.flags = (Number(p.flags) || 0) | V2; delete p.content; delete p.embeds;
      var fix = function (list) { (list || []).forEach(function (c) { if (c && c.type === 17 && c.accent_color !== undefined) { c.accent_color = num(c.accent_color); if (c.accent_color === undefined) delete c.accent_color; } if (c && c.components) fix(c.components); }); };
      fix(p.components);
    } else {
      (p.embeds || []).forEach(function (e) { if (e.color !== undefined) { e.color = num(e.color); if (e.color === undefined) delete e.color; } });
      if (!p.content) delete p.content;
      if (p.components && !p.components.length) delete p.components;
      if (p.embeds && !p.embeds.length) delete p.embeds;
    }
    if (!p.username) delete p.username; if (!p.avatar_url) delete p.avatar_url;
    return p;
  }

  // ---------- the formatting bar over a text field ----------
  var TOOLS = [
    ['b', '<b>B</b>', 'Жирный', '**', '**'], ['i', '<i>I</i>', 'Курсив', '*', '*'], ['u', '<u>U</u>', 'Подчёркнутый', '__', '__'], ['s', '<s>S</s>', 'Зачёркнутый', '~~', '~~'],
    ['sp', '▒', 'Спойлер', '||', '||'], ['c', '&lt;/&gt;', 'Код в строке', '`', '`'], ['cb', '{ }', 'Блок кода', '```\n', '\n```'],
    ['|'], ['h1', 'H1', 'Заголовок 1', '# ', '', 'line'], ['h2', 'H2', 'Заголовок 2', '## ', '', 'line'], ['h3', 'H3', 'Заголовок 3', '### ', '', 'line'], ['sub', '-#', 'Мелкий текст', '-# ', '', 'line'],
    ['q', '❝', 'Цитата', '> ', '', 'line'], ['ul', '•', 'Список', '- ', '', 'line'], ['ol', '1.', 'Нумерованный список', '1. ', '', 'line'],
    ['|'], ['link', '🔗', 'Ссылка с текстом'], ['time', '🕒', 'Дата и время'], ['at', '@', 'Упоминание, канал или эмодзи'], ['ansi', '🎨', 'Цветной текст (ANSI)']
  ];
  function wrapSel(ta, before, after, perLine) {
    var a = ta.selectionStart; var b = ta.selectionEnd; var v = ta.value;
    if (perLine) {
      var ls = v.lastIndexOf('\n', a - 1) + 1; var seg2 = v.slice(ls, b);
      var lines = seg2.split('\n').map(function (l, i) { return (before === '1. ' ? (i + 1) + '. ' : before) + l; }).join('\n');
      ta.value = v.slice(0, ls) + lines + v.slice(b); ta.selectionStart = ls; ta.selectionEnd = ls + lines.length;
    } else {
      var sel = v.slice(a, b) || '';
      ta.value = v.slice(0, a) + before + sel + after + v.slice(b);
      ta.selectionStart = a + before.length; ta.selectionEnd = a + before.length + sel.length;
    }
    ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function insertAt(ta, text) {
    var a = ta.selectionStart; var b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
    ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function popHtml(kind) {
    if (kind === 'link') return '<label>Текст<input type="text" data-p="text" maxlength="200" /></label><label>Ссылка<input type="url" data-p="url" placeholder="https://" /></label><button type="button" class="btn" data-p-ok>Вставить</button>';
    if (kind === 'time') {
      var d = new Date(Date.now() + 3600000); d.setSeconds(0, 0);
      var local = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      return '<label>Когда<input type="datetime-local" data-p="when" value="' + local + '" /></label><label>Вид<select data-p="style">' + STYLES.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === 'f' ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('') + '</select></label><div class="dcp-pv" data-p-pv></div><button type="button" class="btn" data-p-ok>Вставить</button><small>Каждый увидит время в своём часовом поясе.</small>';
    }
    if (kind === 'ansi') {
      var fg = [['', 'Обычный'], ['30', 'Серый'], ['31', 'Красный'], ['32', 'Зелёный'], ['33', 'Жёлтый'], ['34', 'Синий'], ['35', 'Розовый'], ['36', 'Бирюзовый'], ['37', 'Белый']];
      var bg = [['', 'Без фона'], ['40', 'Тёмно-синий'], ['41', 'Оранжевый'], ['42', 'Мраморно-синий'], ['43', 'Серо-бирюзовый'], ['44', 'Серый'], ['45', 'Индиго'], ['46', 'Светло-серый'], ['47', 'Белый']];
      var opt = function (l) { return l.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + '</option>'; }).join(''); };
      return '<label>Текст<input type="text" data-p="text" maxlength="300" /></label><div class="dcp-p2"><label>Цвет<select data-p="fg">' + opt(fg) + '</select></label><label>Фон<select data-p="bg">' + opt(bg) + '</select></label></div><div class="dcp-p2"><label class="dcp-pc"><input type="checkbox" data-p="b" /> Жирный</label><label class="dcp-pc"><input type="checkbox" data-p="un" /> Подчёркнутый</label></div><div class="dcp-pv" data-p-pv></div><button type="button" class="btn" data-p-ok>Вставить</button><small>Цвета видны на ПК и в браузере; в телефоне — обычный текст.</small>';
    }
    // mentions, channels, emoji
    var roles = Object.keys(CTX.roles).map(function (k) { return CTX.roles[k]; }).slice(0, 60);
    var chans = Object.keys(CTX.channels).map(function (k) { return CTX.channels[k]; }).filter(function (c) { return c.type !== 4; }).slice(0, 80);
    var item = function (ins, label, extra) { return '<button type="button" class="dcp-pi" data-p-ins="' + esc(ins) + '">' + (extra || '') + esc(label) + '</button>'; };
    return '<input type="search" data-p-find placeholder="Найти…" aria-label="Найти" />' +
      '<div class="dcp-plist">' +
      '<div class="dcp-pgroup">Особые</div>' + item('{user}', 'Участник (заменитель)') + item('@everyone', '@everyone') + item('@here', '@here') + item('<id:customize>', 'Каналы и роли') + item('<id:browse>', 'Просмотр каналов') + item('<id:guide>', 'Путеводитель') +
      (roles.length ? '<div class="dcp-pgroup">Роли</div>' + roles.map(function (r) { return item('<@&' + r.id + '>', '@' + r.name, r.color ? '<i class="dcp-dot" style="background:#' + ('000000' + Number(r.color).toString(16)).slice(-6) + '"></i>' : ''); }).join('') : '') +
      (chans.length ? '<div class="dcp-pgroup">Каналы</div>' + chans.map(function (c) { return item('<#' + c.id + '>', (CHANNEL_ICON[c.type] || '#') + ' ' + c.name); }).join('') : '') +
      (CTX.emojis.length ? '<div class="dcp-pgroup">Эмодзи сервера</div><div class="dcp-pemo">' + CTX.emojis.slice(0, 120).map(function (e) { return '<button type="button" data-p-ins="<' + (e.animated ? 'a' : '') + ':' + esc(e.name) + ':' + esc(e.id) + '>" title=":' + esc(e.name) + ':"><img src="https://cdn.discordapp.com/emojis/' + esc(e.id) + '.' + (e.animated ? 'gif' : 'webp') + '?size=48" alt=":' + esc(e.name) + ':" loading="lazy" /></button>'; }).join('') + '</div>' : '') +
      '</div>';
  }
  function ansiCode(pop) {
    var g = function (k) { return pop.querySelector('[data-p="' + k + '"]'); };
    var codes = [g('b').checked ? '1' : '', g('un').checked ? '4' : '', g('bg').value, g('fg').value].filter(Boolean);
    var t = g('text').value || 'текст';
    return codes.length ? '\u001b[' + codes.join(';') + 'm' + t + '\u001b[0m' : t;
  }
  function toolbar(ta) {
    if (!ta || ta.dataset.mdBar) return;
    ta.dataset.mdBar = '1';
    var bar = document.createElement('div'); bar.className = 'dcp-tools'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Оформление текста');
    bar.innerHTML = TOOLS.map(function (t) { return t[0] === '|' ? '<span class="dcp-tsep" aria-hidden="true"></span>' : '<button type="button" data-tool="' + t[0] + '" title="' + esc(t[2]) + '" aria-label="' + esc(t[2]) + '">' + t[1] + '</button>'; }).join('');
    var pop = document.createElement('div'); pop.className = 'dcp-pop'; pop.hidden = true;
    var wrap = document.createElement('div'); wrap.className = 'dcp-tw'; // the bar may scroll sideways on a phone; the popup stays outside it
    wrap.appendChild(bar); wrap.appendChild(pop);
    ta.parentNode.insertBefore(wrap, ta);
    var open = '';
    var close = function () { pop.hidden = true; open = ''; };
    var refreshPv = function () {
      var pv = pop.querySelector('[data-p-pv]'); if (!pv) return;
      if (open === 'time') { var w = pop.querySelector('[data-p="when"]').value; var d = w ? new Date(w) : null; pv.innerHTML = d && !isNaN(d) ? '<span class="dcp-time">' + esc(stamp(Math.floor(d / 1000), pop.querySelector('[data-p="style"]').value)) + '</span>' : ''; }
      if (open === 'ansi') pv.innerHTML = '<pre class="dcp-code"><code>' + ansiHtml(ansiCode(pop)) + '</code></pre>';
    };
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('[data-tool]')) e.preventDefault(); }); // keep the selection in the field
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tool]');
      if (b) {
        var t = TOOLS.filter(function (x) { return x[0] === b.getAttribute('data-tool'); })[0];
        if (t[3] !== undefined) { close(); wrapSel(ta, t[3], t[4], t[5] === 'line'); return; }
        if (open === t[0]) { close(); return; }
        open = t[0];
        var render2 = function () { pop.innerHTML = popHtml(open); pop.hidden = false; refreshPv(); var f = pop.querySelector('input,select'); if (f) f.focus(); };
        if (open === 'at') context().then(render2); else render2();
        if (open === 'link') { var s = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (s) pop.querySelector('[data-p="text"]').value = s; }
        return;
      }
      var ins = e.target.closest('[data-p-ins]');
      if (ins) { insertAt(ta, ins.getAttribute('data-p-ins')); close(); return; }
      if (e.target.closest('[data-p-ok]')) {
        if (open === 'link') {
          var u = pop.querySelector('[data-p="url"]').value.trim(); var tx = pop.querySelector('[data-p="text"]').value.trim() || u;
          if (!/^https?:\/\//.test(u)) { pop.querySelector('[data-p="url"]').focus(); return; }
          insertAt(ta, '[' + tx + '](' + u + ')');
        } else if (open === 'time') {
          var w = pop.querySelector('[data-p="when"]').value; if (!w) return;
          insertAt(ta, '<t:' + Math.floor(new Date(w) / 1000) + ':' + pop.querySelector('[data-p="style"]').value + '>');
        } else if (open === 'ansi') {
          var code = ansiCode(pop); var v = ta.value; var at = ta.selectionStart;
          var inside = /\x60{3}ansi\n[^\x60]*$/.test(v.slice(0, at)) && /^[^\x60]*\x60{3}/.test(v.slice(at));
          insertAt(ta, inside ? code : '```ansi\n' + code + '\n```');
        }
        close();
      }
    });
    pop.addEventListener('input', function (e) {
      if (e.target.matches('[data-p-find]')) { var q = e.target.value.toLowerCase(); pop.querySelectorAll('.dcp-pi, .dcp-pemo button').forEach(function (x) { x.hidden = q && (x.textContent + ' ' + (x.title || '')).toLowerCase().indexOf(q) < 0; }); return; }
      refreshPv();
    });
    pop.addEventListener('change', refreshPv);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { close(); ta.focus(); } });
    document.addEventListener('click', function (e) { if (!pop.hidden && !wrap.contains(e.target)) close(); });
    // Ctrl+B / Ctrl+I / Ctrl+U in the field
    ta.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = e.key.toLowerCase(); var map = { b: ['**', '**'], i: ['*', '*'], u: ['__', '__'] };
      if (map[k]) { e.preventDefault(); wrapSel(ta, map[k][0], map[k][1], false); }
    });
  }
  function autoToolbars(root) { (root || document).querySelectorAll('textarea[data-md]').forEach(toolbar); }
  if (window.MutationObserver) new MutationObserver(function (list) { list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('textarea[data-md]')) toolbar(n); else autoToolbars(n); } }); }); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { autoToolbars(); }); else autoToolbars();

  // ---------- sample values for the panel's {templates} ----------
  // Shown in previews instead of the raw names, so the message reads as it will in Discord. Unknown names stay as tokens.
  function sample(text) {
    var u = CTX.user || {}; var g = CTX.guildName || 'Сервер';
    var map = {
      user: u.id ? '<@' + u.id + '>' : '@' + (u.name || 'участник'), 'user.mention': u.id ? '<@' + u.id + '>' : '@участник', member: u.id ? '<@' + u.id + '>' : '@участник', mention: u.id ? '<@' + u.id + '>' : '@участник',
      'user.name': u.name || 'Участник', username: u.name || 'Участник', name: u.name || 'Участник', 'user.tag': u.name || 'Участник', 'member.name': u.name || 'Участник', 'user.id': u.id || '0',
      server: g, 'server.name': g, guild: g, 'guild.name': g, 'server.members': '1 234', membercount: '1 234', 'guild.members': '1 234', count: '7',
      level: '12', 'user.level': '12', oldlevel: '11', xp: '4 520', rank: '3', coins: '500', crystals: '3', reward: '500 монет', reward_line: 'Награда: 500 монет', role: '', achievement: 'Болтун', description: 'Написать 1 000 сообщений'
    };
    return String(text || '').replace(/\{([a-z_][\w.]{0,40})\}/gi, function (all, k) { return Object.prototype.hasOwnProperty.call(map, k.toLowerCase()) ? map[k.toLowerCase()] : all; });
  }

  window.DCP = { render: render, md: md, validate: validate, mount: mount, toolbar: toolbar, context: context, sample: sample, api: api, stamp: stamp, isJumbo: isJumbo, ctx: CTX, onContext: function (f) { listeners.push(f); } };
})();
