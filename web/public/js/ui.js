// --- Saved channels and roles gone in Discord get their «⚠️» option before anything reads the lists (see below).
(function () {
  var data = null;
  try { var el = document.getElementById('guild-entities'); data = el ? JSON.parse(el.textContent) : null; } catch (e) { data = null; }
  var gone = (data && data.gone) || {};
  Object.keys(gone).forEach(function (field) {
    var g = gone[field];
    document.querySelectorAll('.content select[name="' + field + '"]').forEach(function (sel) {
      if (sel.querySelector('option[value="' + g.id + '"]')) return;
      var o = document.createElement('option');
      o.value = g.id; o.setAttribute('data-gone', g.kind); o.selected = true; o.defaultSelected = true;
      o.textContent = '⚠️ ' + (g.kind === 'role' ? 'Удалённая роль' : 'Удалённый канал') + ' (ID: ' + g.id + ')';
      sel.appendChild(o);
    });
  });
})();

// --- Lists of channels and roles, before they become searchable lists below: a channel list is grouped by its Discord
// category with an icon of the kind (# text, 🔊 voice, 🗂 forum), a role gets its colour. The data comes from the page
// (#guild-entities, web/middleware/ensureGuildAccess.js); a list that is not of channels or roles stays as it is.
(function () {
  var box = document.getElementById('guild-entities');
  if (!box) return;
  var data; try { data = JSON.parse(box.textContent); } catch (e) { return; }
  var ch = {}; (data.channels || []).forEach(function (c) { ch[c.id] = c; });
  var roles = {}; (data.roles || []).forEach(function (r) { roles[r.id] = r; });
  var ICON = { 0: '#', 5: '#', 2: '🔊', 13: '🔊', 15: '🗂', 16: '🗂', 4: '📁' };
  document.querySelectorAll('.content select:not([multiple])').forEach(function (sel) {
    var opts = Array.prototype.slice.call(sel.options);
    var known = opts.filter(function (o) { return ch[o.value]; });
    if (known.length && known.length >= opts.filter(function (o) { return o.value; }).length / 2 && !sel.querySelector('optgroup')) {
      var groups = {}; var order = [];
      known.forEach(function (o) {
        var c = ch[o.value];
        var icon = ICON[c.t] || '#';
        o.textContent = icon + ' ' + o.textContent.replace(/^\s*(#|🔊|🗂|📁)\s*/u, '').trim();
        var cat = c.t === 4 ? null : (c.p && ch[c.p] ? ch[c.p] : null);
        var key = cat ? cat.id : '';
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(o);
      });
      if (order.length > 1) {
        order.sort(function (a, b) { return (a ? ch[a].o : -1) - (b ? ch[b].o : -1); });
        order.forEach(function (key) {
          var g = document.createElement('optgroup');
          g.label = key ? ch[key].n : 'Без категории';
          groups[key].sort(function (x, y) { var vx = ch[x.value].t === 2 || ch[x.value].t === 13 ? 1 : 0, vy = ch[y.value].t === 2 || ch[y.value].t === 13 ? 1 : 0; return vx - vy || ch[x.value].o - ch[y.value].o; }).forEach(function (o) { g.appendChild(o); });
          sel.appendChild(g);
        });
        // what is not a channel («не выбрано», a deleted one) stays first
        opts.filter(function (o) { return !ch[o.value]; }).forEach(function (o) { sel.insertBefore(o, sel.firstChild); });
        var cur = opts.filter(function (o) { return o.defaultSelected; })[0]; if (cur) cur.selected = true;
      }
      return;
    }
    opts.forEach(function (o) {
      var r = roles[o.value];
      if (r && r.c) o.setAttribute('data-color', '#' + Number(r.c).toString(16).padStart(6, '0'));
    });
  });
})();

// Small touches for the panel: a letter instead of a broken server icon, and a quiet scroll indicator for the side menu.
(function () {
  // 1) A server icon that fails to load (Discord CDN hiccup) becomes a tile with the first letter of the name.
  function tile(img) {
    var span = document.createElement('span');
    span.className = (img.className || '') + ' guild-initial';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = img.getAttribute('data-initial') || '?';
    img.replaceWith(span);
  }
  // A member's avatar that fails (deleted, CDN hiccup) becomes a round letter of the name next to it.
  function avatarTile(img) {
    var person = img.closest('.person');
    var name = person ? (person.textContent || '').trim() : '';
    var span = document.createElement('span');
    span.className = 'avatar-initial';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = (name.charAt(0) || '?').toUpperCase();
    img.replaceWith(span);
  }
  function broken(img) {
    if (img.hasAttribute('data-initial')) tile(img);
    else if (img.closest('.person')) avatarTile(img);
    else if (img.hasAttribute('data-fallback') && img.src !== img.getAttribute('data-fallback')) img.src = img.getAttribute('data-fallback');
  }
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG') broken(img);
  }, true);
  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-initial], .person img, img[data-fallback]'), function (img) {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) broken(img);
    });
    navUi();
    quickJump();
    findOnPage();
    templateHelp();
    typeFields();
    embedEditors();
  });

  // 2) Navigation: "≡" opens the list of all pages (Esc, the backdrop or a link closes it); the strip of the group's pages
  //    scrolls so the current page is in view (on a phone the strip is wider than the screen).
  function navUi() {
    var drawer = document.getElementById('navDrawer');
    var openers = document.querySelectorAll('[data-menu-open]');
    if (drawer) {
      var lastFocus = null;
      var open = function () {
        lastFocus = document.activeElement; drawer.hidden = false; document.documentElement.classList.add('nd-open');
        Array.prototype.forEach.call(openers, function (b) { b.setAttribute('aria-expanded', 'true'); });
        var cur = drawer.querySelector('.nd-nav a.active') || drawer.querySelector('.nd-nav a');
        if (cur) { cur.scrollIntoView({ block: 'center' }); cur.focus({ preventScroll: true }); }
      };
      var close = function () {
        drawer.hidden = true; document.documentElement.classList.remove('nd-open');
        Array.prototype.forEach.call(openers, function (b) { b.setAttribute('aria-expanded', 'false'); });
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      };
      Array.prototype.forEach.call(openers, function (b) { b.addEventListener('click', open); });
      Array.prototype.forEach.call(drawer.querySelectorAll('[data-menu-close]'), function (b) { b.addEventListener('click', close); });
      drawer.addEventListener('click', function (e) { if (e.target.closest('[data-quick-jump]')) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) close(); });
    }
    var tabs = document.querySelector('.tb-tabs'); var on = tabs && tabs.querySelector('.is-on');
    if (on && tabs.scrollWidth > tabs.clientWidth + 2) tabs.scrollLeft = on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2;
    // the profile menu closes when clicking elsewhere
    var user = document.querySelector('.tb-user');
    if (user) document.addEventListener('click', function (e) { if (user.open && !user.contains(e.target)) user.open = false; });
  }


  // 4) Search: Ctrl+K (⌘K) or "/" opens it. It finds pages and the settings inside them (card headings, fields, switches);
  //    a setting opens its page scrolled to it.
  function quickJump() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nd-nav a[title], .sidebar nav a[title]'));
    if (!links.length) return;
    var pages = links.map(function (a) {
      var t = a.getAttribute('title').split(' — ');
      return { name: t[0], desc: t[1] || '', kw: a.getAttribute('data-kw') || '', href: a.getAttribute('href'), icon: a.querySelector('svg') ? a.querySelector('svg').outerHTML : '' };
    });
    var base = (pages[0].href.match(/^\/dashboard\/\d+/) || [''])[0];
    var iconOf = {}; pages.forEach(function (p) { iconOf[(p.href.split('/')[3] || 'overview')] = p; });
    var settings = null, loading = false;
    function loadSettings() {
      if (settings || loading) return; loading = true;
      fetch('/dashboard/settings-index.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        settings = [];
        ((d && d.pages) || []).forEach(function (pg) {
          var host = iconOf[pg.page]; if (!host) return;
          pg.entries.forEach(function (e) { settings.push({ name: e.text, desc: host.name, href: base + (pg.page === 'overview' ? '' : '/' + pg.page) + '#find=' + encodeURIComponent(e.text), icon: host.icon, setting: true }); });
        });
        if (!box.hidden) draw();
      }).catch(function () { settings = []; });
    }
    var box = document.createElement('div');
    box.className = 'qj';
    box.hidden = true;
    box.innerHTML = '<div class="qj-panel" role="dialog" aria-modal="true" aria-label="Поиск по панели">' +
      '<div class="qj-field"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.3"/><path d="M12.8 12.8L16.5 16.5"/></svg>' +
      '<input class="qj-input" type="search" placeholder="Раздел или настройка: магазин, пауза, мат…" autocomplete="off" aria-label="Поиск раздела или настройки" role="combobox" aria-expanded="true" aria-controls="qjList" aria-autocomplete="list" />' +
      '<button type="button" class="qj-close" aria-label="Закрыть поиск">Esc</button></div>' +
      '<div class="qj-list" id="qjList" role="listbox" aria-label="Результаты поиска"></div><div class="qj-hint"><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span></div></div>';
    document.body.appendChild(box);
    var input = box.querySelector('.qj-input'), list = box.querySelector('.qj-list'), shown = [], sel = 0;
    function norm(s) { return s.toLowerCase().replace(/ё/g, 'е'); }
    function match(it, words) { var h = norm(it.name + ' ' + it.desc + ' ' + (it.kw || '')); return words.every(function (w) { return h.indexOf(w) !== -1; }); }
    function head(text) { var d = document.createElement('div'); d.className = 'qj-head'; d.textContent = text; return d; }
    // the typed words are lit in the result (built from text nodes: nothing typed can become markup)
    function mark(el, text, words) {
      var low = norm(text), spans = [];
      words.forEach(function (w) { var i = low.indexOf(w); if (w && i !== -1) spans.push([i, i + w.length]); });
      spans.sort(function (a, b) { return a[0] - b[0]; });
      var pos = 0;
      spans.forEach(function (sp) {
        if (sp[0] < pos) return;
        el.appendChild(document.createTextNode(text.slice(pos, sp[0])));
        var m = document.createElement('mark'); m.textContent = text.slice(sp[0], sp[1]); el.appendChild(m); pos = sp[1];
      });
      el.appendChild(document.createTextNode(text.slice(pos)));
    }
    var frame = 0;
    function drawSoon() { if (frame) return; frame = requestAnimationFrame(function () { frame = 0; draw(); }); }
    function draw() {
      var q = norm(input.value.trim()); var words = q ? q.split(/\s+/) : [];
      var foundPages = pages.filter(function (it) { return !words.length || match(it, words); });
      var foundSettings = words.length && settings ? settings.filter(function (it) { return norm(it.name).indexOf(words[0]) !== -1 && match(it, words); }).slice(0, 30) : [];
      shown = foundPages.concat(foundSettings);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      if (!shown.length) { list.innerHTML = '<div class="qj-empty" role="status">Ничего не найдено</div>'; input.removeAttribute('aria-activedescendant'); return; }
      shown.forEach(function (it, i) {
        if (i === 0 && foundPages.length && words.length) list.appendChild(head('Разделы'));
        if (i === foundPages.length) list.appendChild(head('Настройки'));
        var a = document.createElement('a');
        a.href = it.href; a.className = 'qj-item' + (i === sel ? ' sel' : '') + (it.setting ? ' qj-setting' : ''); a.setAttribute('role', 'option'); a.id = 'qjOpt' + i; a.setAttribute('aria-selected', i === sel ? 'true' : 'false');
        a.innerHTML = '<span class="qj-ic">' + it.icon + '</span><span class="qj-txt"><b></b><small></small></span>' + (i === sel ? '<kbd class="qj-enter">↵</kbd>' : '');
        mark(a.querySelector('b'), it.name, words); a.querySelector('small').textContent = it.setting ? '↳ ' + it.desc : it.desc;
        list.appendChild(a);
      });
      var cur = list.querySelectorAll('.qj-item')[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
      if (cur) input.setAttribute('aria-activedescendant', cur.id); else input.removeAttribute('aria-activedescendant'); // the chosen result is announced
    }
    function go(it) { var here = location.pathname === it.href.split('#')[0]; location.href = it.href; if (here) { close(); findOnPage(); } }
    var opener = null;
    // while the search is open the page behind it is out of reach of the keyboard and of screen readers
    function shut(on) { Array.prototype.forEach.call(document.body.children, function (el) { if (el !== box && el.tagName !== 'SCRIPT') { if (on) { if (!el.inert) { el.inert = true; el.setAttribute('data-qj-inert', ''); } } else if (el.hasAttribute('data-qj-inert')) { el.inert = false; el.removeAttribute('data-qj-inert'); } } }); }
    // the window drops down under the top bar, right under the "Поиск" button (like the "Модули" menu)
    function place() {
      var bar = document.querySelector('.topbar'), btn = document.querySelector('.tb-search');
      var top = bar ? Math.round(bar.getBoundingClientRect().bottom) + 6 : 64;
      var r = btn && btn.offsetParent !== null ? btn.getBoundingClientRect() : null;
      box.style.setProperty('--qj-top', top + 'px');
      box.style.setProperty('--qj-right', (r ? Math.max(12, Math.round(window.innerWidth - r.right)) : 12) + 'px');
    }
    window.addEventListener('resize', function () { if (!box.hidden) place(); });
    function open() { var mm = document.getElementById('modsMenu'); if (mm && !mm.hidden) { var mb = document.querySelector('[data-mods-open]'); if (mb) mb.click(); }
      opener = document.activeElement; shut(true); place(); box.hidden = false; input.value = ''; sel = 0; draw(); input.focus(); document.documentElement.classList.add('qj-open'); requestAnimationFrame(function () { box.classList.add('in'); }); loadSettings(); }
    function close() { if (box.hidden) return; box.classList.remove('in'); box.hidden = true; document.documentElement.classList.remove('qj-open'); shut(false); if (opener && opener.focus && document.contains(opener)) opener.focus(); opener = null; }
    input.addEventListener('input', function () { sel = 0; drawSoon(); });
    box.querySelector('.qj-close').addEventListener('click', function () { close(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) { go(shown[sel]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('click', function (e) { var a = e.target.closest('.qj-item'); if (!a) return; var i = Array.prototype.indexOf.call(list.querySelectorAll('.qj-item'), a); if (shown[i]) { e.preventDefault(); go(shown[i]); } });
    box.addEventListener('mousedown', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if ((e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); box.hidden ? open() : close(); }
      else if (e.key === '/' && !typing && box.hidden) { e.preventDefault(); open(); }
      else if (e.key === 'Escape' && !box.hidden) close();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-quick-jump]'), function (b) { b.addEventListener('click', open); });
  }

  // 4b) A setting found by the search (#find=…): the page scrolls to it, opens a folded block around it and lights it briefly.
  function findOnPage() {
    var m = /#find=([^&]+)/.exec(location.hash); if (!m) return;
    var want; try { want = decodeURIComponent(m[1]).toLowerCase().replace(/ё/g, 'е').trim(); } catch (e) { return; }
    var norm = function (el) { return (el.textContent || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); };
    var cands = Array.prototype.slice.call(document.querySelectorAll('.content h2, .content .rule-text b, .content label'));
    var exact = cands.filter(function (el) { var t = norm(el); return t === want || t.replace(/[:：]$/, '') === want || t.indexOf(want + ' ') === 0 || (el.tagName === 'H2' && t.indexOf(want) === 0); });
    var el = exact[0] || cands.filter(function (x) { return norm(x).indexOf(want) !== -1; })[0];
    if (!el) return;
    var target = el.closest('.rule') || el.closest('.card') && el.tagName === 'H2' && el.closest('.card') || el.parentElement;
    var d = el.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
    setTimeout(function () {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('find-hit'); void target.offsetWidth; target.classList.add('find-hit');
      var field = target.querySelector('input:not([type=hidden]), select, textarea');
      if (field && target !== el.closest('.card')) setTimeout(function () { try { field.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }, 450);
    }, 60);
    history.replaceState(null, '', location.pathname + location.search);
  }

  // 5) Templates: click a name to insert it at the cursor; "Предпросмотр" asks the server how the text will look.
  function templateHelp() {
    Array.prototype.forEach.call(document.querySelectorAll('.tpl-help[data-tpl-for]'), function (box) {
      var field = document.getElementById(box.getAttribute('data-tpl-for'));
      if (!field) return;
      box.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-insert]');
        if (chip) {
          var t = chip.getAttribute('data-insert'), a = field.selectionStart || field.value.length, b = field.selectionEnd || a;
          field.value = field.value.slice(0, a) + t + field.value.slice(b);
          field.focus(); field.selectionStart = field.selectionEnd = a + t.length;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        var btn = e.target.closest('[data-preview-url]');
        if (!btn) return;
        var out = box.querySelector('.tpl-preview');
        out.hidden = false; out.textContent = '…';
        fetch(btn.getAttribute('data-preview-url'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: field.value }) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!window.DCP || !j.text) { out.textContent = j.text || '(пусто)'; return; }
            var th = 'dark'; try { th = localStorage.getItem('dcp-theme') || th; } catch (e2) { /* storage off */ }
            out.innerHTML = '<div class="dcp" data-dcp-theme="' + th.replace(/[^a-z]/g, '') + '"><div class="dcp-screen">' + window.DCP.render({ content: j.text }, {}) + '</div></div>';
          })
          .catch(function () { out.textContent = 'Не удалось получить предпросмотр'; });
      });
    });
  }

  // 6) Forms with a "Тип" select: fields that only make sense for one type (data-role-only) are hidden for the others.
  function typeFields() {
    Array.prototype.forEach.call(document.querySelectorAll('form'), function (form) {
      var type = form.querySelector('select[name="type"]');
      var only = form.querySelectorAll('[data-role-only]');
      if (!type || !only.length) return;
      var sync = function () { Array.prototype.forEach.call(only, function (el) { el.hidden = type.value !== 'role'; }); };
      type.addEventListener('change', sync); sync();
    });
  }

  // 7) Message editor: the embed fields show up with the switch; the preview (web/public/js/dcp.js) shows the whole message —
  //    the text of the field named by data-text-for and the embed — with the {templates} filled in with examples.
  function embedEditors() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-embed-editor]'), function (box) {
      var toggle = box.querySelector('[data-embed-toggle]'), fields = box.querySelector('.embed-fields');
      var get = function (k) { return box.querySelector('[data-ef="' + k + '"]'); };
      var host = box.querySelector('[data-ee-preview]');
      var textField = host && host.getAttribute('data-text-for') ? document.getElementById(host.getAttribute('data-text-for')) : null;
      var pv = null;
      // a picture the bot attaches (the welcome card): the embed's image when there is an embed, a file under the text otherwise
      var attachBox = host && host.getAttribute('data-attach-field') ? (box.closest('form') || document).querySelector('[name="' + host.getAttribute('data-attach-field') + '"]') : null;
      var attachName = host ? host.getAttribute('data-attach-name') : '';
      var attached = function () { return Boolean(attachBox && attachBox.checked); };
      var payload = function () {
        var S = window.DCP.sample; var C = window.DCP.ctx;
        var msg = { content: textField ? S(textField.value) : '', embeds: [] };
        if (attached() && !toggle.checked) msg.attachments = [{ url: host.getAttribute('data-attach-url'), filename: attachName }];
        if (toggle.checked) {
          var th = get('thumbnail').value; var img = get('image').value.trim();
          msg.embeds.push({
            title: S(get('title').value), description: S(get('description').value), color: get('color').value || '#8b7cf6',
            image: attached() ? { url: 'attachment://' + attachName } : img ? { url: img } : undefined,
            thumbnail: th === 'avatar' ? { url: C.user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png' } : th === 'icon' ? { url: C.bot.avatar || 'https://cdn.discordapp.com/embed/avatars/1.png' } : undefined,
            footer: get('footer').value ? { text: S(get('footer').value) } : undefined,
            timestamp: get('timestamp').checked ? new Date().toISOString() : undefined
          });
        }
        return msg;
      };
      // the two-way link: a field lights its part of the preview, a click on a part opens its field
      var EF = { title: 'title', description: 'description', image: 'image', thumbnail: 'thumbnail', footer: 'footer', timestamp: 'footer', color: '' };
      var link = {
        scope: box.closest('form') || box,
        elOf: function (f) {
          if (textField && f === textField) return 'content';
          if (!box.contains(f)) return null;
          if (f.hasAttribute('data-embed-toggle')) return 'embed:0';
          var k = f.getAttribute('data-ef'); return k !== null && k in EF ? 'embed:0' + (EF[k] ? ':' + EF[k] : '') : null;
        },
        open: function (name) {
          var t = null;
          if (name === 'content' || name === 'sender') t = textField;
          else if (/^embed:0/.test(name)) {
            var part = name.split(':')[2] || 'title';
            var key = Object.keys(EF).filter(function (k) { return EF[k] === part; })[0] || 'title';
            t = toggle.checked ? get(key) : toggle;
          }
          if (t) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        }
      };
      var draw = function () {
        fields.hidden = !toggle.checked;
        if (!host || !window.DCP) return;
        if (!pv) pv = window.DCP.mount(host, function () { var f = {}; if (attached()) f[attachName] = host.getAttribute('data-attach-url'); return { payload: payload(), opts: { tokens: true, files: f, empty: 'Пустое сообщение не отправится — напишите текст или включите эмбед.' } }; }, { link: link });
        else pv.update();
      };
      box.addEventListener('input', draw); box.addEventListener('change', draw);
      if (textField) textField.addEventListener('input', draw);
      if (attachBox) attachBox.addEventListener('change', draw);
      draw();
    });
  }

  // 8) Number fields get the panel's own up/down arrows instead of the browser's grey ones. Arrow keys and typing work as before;
  //    holding a button keeps stepping. Fields added later (e.g. by the message builder) are picked up too.
  var arrow = function (d) { return '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; };
  function stepper(input) {
    if (input.dataset.stepper || input.closest('.num-field')) return;
    input.dataset.stepper = '1';
    var wrap = document.createElement('span'); wrap.className = 'num-field';
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    var box = document.createElement('span'); box.className = 'num-step';
    box.innerHTML = '<button type="button" tabindex="-1" data-dir="1" aria-label="Больше">' + arrow('M2 6.5L5 3.5L8 6.5') + '</button>' +
      '<button type="button" tabindex="-1" data-dir="-1" aria-label="Меньше">' + arrow('M2 3.5L5 6.5L8 3.5') + '</button>';
    wrap.appendChild(box);
    var timer = 0;
    var step = function (dir) {
      if (input.disabled || input.readOnly) return;
      try { if (dir > 0) input.stepUp(); else input.stepDown(); } catch (e) { input.value = (Number(input.value) || 0) + dir; }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    var stop = function () { clearTimeout(timer); clearInterval(timer); timer = 0; };
    box.addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      ev.preventDefault(); var dir = Number(b.getAttribute('data-dir'));
      step(dir); input.focus({ preventScroll: true });
      timer = setTimeout(function () { timer = setInterval(function () { step(dir); }, 70); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) { box.addEventListener(e, stop); });
  }
  document.querySelectorAll('input[type=number]').forEach(stepper);

  // 7) Choosing several channels or roles: a cloud of chips became a field with the chosen items (× removes one),
  //    a search box and a dropdown list with ticks, grouped by category. The checkboxes stay real, so forms send the same data.
  function multiPick(box) {
    if (box.dataset.ms) return;
    box.dataset.ms = '1';
    var items = Array.prototype.slice.call(box.querySelectorAll('label'));
    if (!items.length) return;
    var kind = box.getAttribute('data-kind') || (items[0].textContent.trim().charAt(0) === '#' ? 'channels' : 'roles');
    var wrap = document.createElement('div'); wrap.className = 'ms';
    var tokens = document.createElement('div'); tokens.className = 'ms-tokens';
    var search = document.createElement('input'); search.type = 'search'; search.className = 'ms-search'; search.autocomplete = 'off';
    search.placeholder = kind === 'channels' ? 'Поиск каналов…' : 'Поиск ролей…';
    search.setAttribute('aria-label', search.placeholder);
    var list = document.createElement('div'); list.className = 'ms-list'; list.hidden = true; list.setAttribute('role', 'listbox'); list.setAttribute('aria-multiselectable', 'true');
    var empty = document.createElement('div'); empty.className = 'ms-none'; empty.textContent = 'Ничего не найдено';
    box.parentNode.insertBefore(wrap, box);
    wrap.appendChild(tokens); wrap.appendChild(search); wrap.appendChild(list);
    var lastGroup = null;
    items.forEach(function (label) {
      var g = label.getAttribute('data-group') || '';
      if (g && g !== lastGroup) { var h = document.createElement('div'); h.className = 'ms-group'; h.textContent = g; list.appendChild(h); }
      lastGroup = g;
      label.classList.add('ms-item');
      list.appendChild(label);
    });
    list.appendChild(empty);
    box.remove();
    function draw() {
      tokens.innerHTML = '';
      var chosen = items.filter(function (l) { return l.querySelector('input').checked; });
      if (!chosen.length) { var n = document.createElement('span'); n.className = 'ms-placeholder'; n.textContent = 'Ничего не выбрано'; tokens.appendChild(n); }
      chosen.forEach(function (l) {
        var t = document.createElement('span'); t.className = 'ms-token';
        t.appendChild(document.createTextNode(l.querySelector('span').textContent));
        var x = document.createElement('button'); x.type = 'button'; x.className = 'ms-x'; x.setAttribute('aria-label', 'Убрать'); x.textContent = '×';
        x.addEventListener('click', function () { var i = l.querySelector('input'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); draw(); });
        t.appendChild(x); tokens.appendChild(t);
      });
    }
    function filter() {
      var q = search.value.trim().toLowerCase(); var shown = 0;
      items.forEach(function (l) { var ok = !q || l.textContent.toLowerCase().indexOf(q) >= 0; l.hidden = !ok; if (ok) shown++; });
      Array.prototype.forEach.call(list.querySelectorAll('.ms-group'), function (h) {
        var n = h.nextElementSibling, any = false;
        while (n && !n.classList.contains('ms-group')) { if (n.classList.contains('ms-item') && !n.hidden) any = true; n = n.nextElementSibling; }
        h.hidden = !any;
      });
      empty.hidden = shown > 0;
    }
    var open = function () { list.hidden = false; wrap.classList.add('open'); };
    var close = function () { list.hidden = true; wrap.classList.remove('open'); };
    search.addEventListener('focus', open);
    search.addEventListener('click', open);
    search.addEventListener('input', function () { open(); filter(); });
    search.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); search.blur(); } if (e.key === 'Enter') e.preventDefault(); });
    tokens.addEventListener('click', function (e) { if (!e.target.closest('.ms-x')) search.focus(); });
    list.addEventListener('change', draw);
    document.addEventListener('pointerdown', function (e) { if (!wrap.contains(e.target)) close(); });
    wrap.addEventListener('focusout', function (e) { if (e.relatedTarget && !wrap.contains(e.relatedTarget)) close(); });
    draw(); filter();
  }
  // 7a) Names for screen readers. A caption written next to its field (not around it and without "for") is tied to that
  //     field here, once, for every page; table headers say that they head a column. Runs before the lists below are
  //     rebuilt, so the custom dropdown finds its caption too.
  (function () {
    var n = 0, FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
    Array.prototype.forEach.call(document.querySelectorAll('label:not([for])'), function (lab) {
      if (lab.querySelector(FIELD)) return; // wraps its field: already tied
      var el = lab.nextElementSibling, field = null;
      for (var steps = 0; el && steps < 4 && !field; steps++, el = el.nextElementSibling) {
        if (el.tagName === 'LABEL') break;
        field = el.matches(FIELD) ? el : el.querySelector(FIELD);
      }
      if (!field || (field.labels && field.labels.length)) return;
      if (!field.id) field.id = 'fld' + (++n);
      lab.htmlFor = field.id;
    });
    Array.prototype.forEach.call(document.querySelectorAll('thead th:not([scope])'), function (th) { th.setAttribute('scope', 'col'); });
    // On a phone a table row becomes a card: every cell says which column it belongs to (CSS shows it as a caption).
    Array.prototype.forEach.call(document.querySelectorAll('.content table, .cm-page table'), function (t) {
      var heads = t.tHead ? Array.prototype.map.call(t.tHead.rows[0] ? t.tHead.rows[0].cells : [], function (th) { return { text: th.textContent.trim(), span: th.colSpan || 1 }; }) : [];
      if (!heads.length) return;
      var names = []; heads.forEach(function (h) { for (var k = 0; k < h.span; k++) names.push(k ? '' : h.text); });
      Array.prototype.forEach.call(t.tBodies, function (tb) {
        Array.prototype.forEach.call(tb.rows, function (tr) {
          var col = 0;
          Array.prototype.forEach.call(tr.cells, function (td) { if (names[col] && !td.hasAttribute('data-label')) td.setAttribute('data-label', names[col]); var fld = names[col] && td.querySelector('input:not([type=hidden]), select, textarea'); if (fld && !(fld.labels && fld.labels.length) && !fld.getAttribute('aria-label')) fld.setAttribute('aria-label', names[col]); if (td.colSpan > 1) td.classList.add('rt-wide'); if (/^(№|#)$/.test(names[col] || '')) td.classList.add('rt-head'); else if (!td.children.length && /^[\s—–-]*$/.test(td.textContent)) td.classList.add('rt-empty'); col += td.colSpan || 1; });
        });
      });
      t.classList.add('rt');
    });
  })();

  document.querySelectorAll('.pick').forEach(multiPick);

  // 8) Dropdowns: every single-choice list becomes a button with a popover list (search in long ones, keyboard, groups).
  //    The real <select> stays underneath: forms, labels and scripts that read or set .value keep working.
  var openSelect = null;
  function fancySelect(sel) {
    if (sel.dataset.fs || sel.multiple || sel.size > 1 || sel.closest('[data-native], .ms')) return;
    sel.dataset.fs = '1';
    var w = sel.offsetWidth, pw = sel.parentElement ? sel.parentElement.clientWidth : 0;
    var wrap = document.createElement('div'); wrap.className = 'fs';
    if (w && pw && w < pw * 0.85) { wrap.classList.add('fs-inline'); wrap.style.minWidth = 'min(' + w + 'px, 100%)'; }
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); sel.classList.add('fs-native'); sel.tabIndex = -1;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fs-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    if (sel.id) { var lab = document.querySelector('label[for="' + sel.id + '"]'); if (lab) { if (!lab.id) lab.id = sel.id + '-lbl'; btn.setAttribute('aria-labelledby', lab.id + ' ' + (sel.id + '-val')); } }
    if (!btn.hasAttribute('aria-labelledby')) { // a list inside its label, or with only a title: the button still gets a name
      var named = sel.getAttribute('aria-label') || sel.getAttribute('title') || (sel.labels && sel.labels[0] ? sel.labels[0].textContent.replace(/\s+/g, ' ').trim() : '');
      if (named) btn.setAttribute('aria-label', named);
    }
    btn.innerHTML = '<span class="fs-val"></span><svg class="fs-chev" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>';
    var val = btn.querySelector('.fs-val'); if (sel.id) val.id = sel.id + '-val';
    wrap.appendChild(btn);
    // The list lives at the top level of the page (not inside the card) with fixed coordinates: no card below it,
    // no card that clips its content and no animated block can cover or cut it.
    var pop = document.createElement('div'); pop.className = 'fs-pop'; pop.hidden = true;
    document.body.appendChild(pop);
    var items = [], active = -1, search = null;
    function label() {
      var o = sel.options[sel.selectedIndex];
      val.textContent = o ? o.textContent.trim() : '';
      wrap.classList.toggle('fs-empty', !o || o.value === '');
      btn.disabled = sel.disabled; wrap.hidden = sel.hidden;
    }
    function build() {
      pop.innerHTML = ''; items = [];
      var opts = Array.prototype.filter.call(sel.options, function (o) { return !o.hidden; });
      if (opts.length > 8) {
        var f = document.createElement('div'); f.className = 'fs-search';
        search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Поиск…'; search.autocomplete = 'off'; search.setAttribute('aria-label', 'Поиск в списке');
        f.appendChild(search); pop.appendChild(f);
        search.addEventListener('input', filter);
        search.addEventListener('keydown', keys);
      } else search = null;
      var list = document.createElement('div'); list.className = 'fs-list'; list.setAttribute('role', 'listbox'); pop.appendChild(list);
      var lastGroup = null;
      opts.forEach(function (o) {
        var g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '';
        if (g && g !== lastGroup) { var h = document.createElement('div'); h.className = 'fs-group'; h.textContent = g; list.appendChild(h); }
        lastGroup = g;
        var it = document.createElement('div'); it.className = 'fs-opt'; it.setAttribute('role', 'option');
        it.textContent = o.textContent.trim();
        if (o.getAttribute('data-color')) { var dot = document.createElement('i'); dot.className = 'fs-dot'; dot.style.background = o.getAttribute('data-color'); it.insertBefore(dot, it.firstChild); }
        if (o.disabled) { it.classList.add('off'); it.setAttribute('aria-disabled', 'true'); }
        if (o.selected) { it.classList.add('sel'); it.setAttribute('aria-selected', 'true'); }
        if (o.value === '') it.classList.add('none');
        it.addEventListener('mousedown', function (e) { e.preventDefault(); });
        it.addEventListener('click', function () { if (!o.disabled) choose(o); });
        it.addEventListener('mousemove', function () { setActive(items.indexOf(entry)); });
        var entry = { el: it, o: o }; items.push(entry); list.appendChild(it);
      });
      var none = document.createElement('div'); none.className = 'fs-nothing'; none.textContent = 'Ничего не найдено'; none.hidden = true; list.appendChild(none);
    }
    function visible() { return items.filter(function (x) { return !x.el.hidden && !x.o.disabled; }); }
    function setActive(i) {
      items.forEach(function (x, k) { x.el.classList.toggle('act', k === i); });
      active = i; var x = items[i]; if (x && x.el.scrollIntoView) x.el.scrollIntoView({ block: 'nearest' });
    }
    function filter() {
      var q = search.value.trim().toLowerCase().replace(/ё/g, 'е');
      items.forEach(function (x) { x.el.hidden = q && x.el.textContent.toLowerCase().replace(/ё/g, 'е').indexOf(q) === -1; });
      Array.prototype.forEach.call(pop.querySelectorAll('.fs-group'), function (h) { var n = h.nextElementSibling, any = false; while (n && !n.classList.contains('fs-group')) { if (n.classList.contains('fs-opt') && !n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; });
      pop.querySelector('.fs-nothing').hidden = visible().length > 0;
      var v = visible(); setActive(v.length ? items.indexOf(v[0]) : -1);
    }
    function place() {
      var r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
      var below = vh - r.bottom, above = r.top, up = below < 300 && above > below;
      var width = wrap.classList.contains('fs-inline') ? Math.max(r.width, 220) : Math.max(r.width, 220);
      width = Math.min(width, vw - 16);
      var left = Math.max(8, Math.min(r.left, vw - width - 8));
      pop.style.left = left + 'px'; pop.style.width = width + 'px';
      if (up) { pop.style.top = 'auto'; pop.style.bottom = (vh - r.top + 6) + 'px'; } else { pop.style.bottom = 'auto'; pop.style.top = (r.bottom + 6) + 'px'; }
      wrap.classList.toggle('up', up); pop.classList.toggle('up', up);
      var room = Math.max(140, (up ? above : below) - 24 - (search ? 54 : 0));
      var list = pop.querySelector('.fs-list'); if (list) list.style.maxHeight = Math.min(280, room) + 'px';
      // the field went under the top bar or off the screen while scrolling: the list goes with it
      if (r.bottom < 0 || r.top > vh) close();
    }
    var follow = function () { if (!pop.hidden) place(); };
    function open() {
      if (sel.disabled) return;
      if (openSelect && openSelect !== close) openSelect();
      build(); pop.hidden = false; place(); wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); openSelect = close;
      window.addEventListener('scroll', follow, true); window.addEventListener('resize', follow);
      var cur = items.findIndex(function (x) { return x.o.selected; }); setActive(cur);
      if (search) search.focus();
    }
    function close() { pop.hidden = true; wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); if (openSelect === close) openSelect = null; window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); }
    function choose(o) {
      var changed = sel.value !== o.value;
      setValue.call(sel, o.value); label(); close(); btn.focus();
      if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function step(d) { var v = visible(); if (!v.length) return; var pos = v.indexOf(items[active]); pos = pos === -1 ? 0 : Math.max(0, Math.min(v.length - 1, pos + d)); setActive(items.indexOf(v[pos])); }
    function keys(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (pop.hidden) open(); else step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (pop.hidden) open(); else step(-1); }
      else if (e.key === 'Enter' || (e.key === ' ' && e.target === btn)) { e.preventDefault(); if (pop.hidden) open(); else if (items[active]) choose(items[active].o); }
      else if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
      else if (e.key === 'Tab') close();
      else if (!search && e.key.length === 1 && !pop.hidden) { var ch = e.key.toLowerCase(); var v = visible(); var hit = v.filter(function (x) { return x.el.textContent.trim().toLowerCase().indexOf(ch) === 0; })[0]; if (hit) setActive(items.indexOf(hit)); }
    }
    btn.addEventListener('click', function () { pop.hidden ? open() : close(); });
    btn.addEventListener('keydown', keys);
    sel.addEventListener('focus', function () { btn.focus(); });
    sel.addEventListener('change', label);
    document.addEventListener('pointerdown', function (e) { if (!pop.hidden && !wrap.contains(e.target) && !pop.contains(e.target)) close(); });
    // scripts set .value / .selectedIndex / .disabled / .hidden directly: the button follows
    var proto = HTMLSelectElement.prototype;
    var setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
    ['value', 'selectedIndex'].forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(proto, k);
      Object.defineProperty(sel, k, { configurable: true, get: function () { return d.get.call(sel); }, set: function (v) { d.set.call(sel, v); label(); } });
    });
    ['disabled', 'hidden'].forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k) || Object.getOwnPropertyDescriptor(proto, k) || Object.getOwnPropertyDescriptor(Element.prototype, k);
      if (!d) return;
      Object.defineProperty(sel, k, { configurable: true, get: function () { return d.get.call(sel); }, set: function (v) { d.set.call(sel, v); label(); } });
    });
    if (sel.form) sel.form.addEventListener('reset', function () { setTimeout(label, 0); });
    label();
  }
  var fine = !window.matchMedia || window.matchMedia('(pointer: fine)').matches;
  if (fine) document.querySelectorAll('.content select, .topbar select').forEach(fancySelect);
  window.darkFancySelect = function (root) { if (fine) (root || document).querySelectorAll('.content select').forEach(fancySelect); };
  if (window.MutationObserver) {
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType !== 1) return; if (n.matches && n.matches('input[type=number]')) stepper(n); if (n.querySelectorAll) n.querySelectorAll('input[type=number]').forEach(stepper); if (fine && n.closest && n.closest('.content')) { if (n.matches('select')) fancySelect(n); if (n.querySelectorAll) n.querySelectorAll('select').forEach(fancySelect); } }); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  // 10) Confirmation in the panel's own window instead of the browser's grey box: it says what will happen, the
  //     dangerous button is red and "Отмена" has the focus, so Enter on a stray press cancels. Used by forms and
  //     buttons with data-confirm (the text) and by scripts through window.darkConfirm(text, options) → Promise<boolean>.
  var askOpen = null;
  function darkConfirm(text, opts) {
    opts = opts || {};
    if (askOpen) askOpen(false);
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      var box = document.createElement('div'); box.className = 'ask';
      box.innerHTML = '<div class="ask-panel" role="alertdialog" aria-modal="true" aria-labelledby="askText"><p class="ask-text" id="askText"></p><div class="ask-row"><button type="button" class="btn btn-secondary ask-no"></button><button type="button" class="btn ask-yes"></button></div></div>';
      box.querySelector('.ask-text').textContent = text;
      if (opts.extra) box.querySelector('.ask-panel').insertBefore(opts.extra, box.querySelector('.ask-row')); // more than a sentence: a list, choices
      var yes = box.querySelector('.ask-yes'), no = box.querySelector('.ask-no');
      yes.textContent = opts.ok || 'Да'; no.textContent = opts.cancel || 'Отмена';
      if (opts.danger !== false) yes.classList.add('btn-danger');
      document.body.appendChild(box);
      var hidden = [];
      Array.prototype.forEach.call(document.body.children, function (el) { if (el !== box && el.tagName !== 'SCRIPT' && !el.inert) { el.inert = true; hidden.push(el); } });
      requestAnimationFrame(function () { box.classList.add('in'); });
      no.focus();
      function done(v) {
        if (askOpen !== done) return; askOpen = null;
        hidden.forEach(function (el) { el.inert = false; });
        box.remove(); document.removeEventListener('keydown', key, true);
        if (opener && opener.focus && document.contains(opener)) opener.focus();
        resolve(v);
      }
      function key(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
      }
      askOpen = done;
      yes.addEventListener('click', function () { done(true); });
      no.addEventListener('click', function () { done(false); });
      box.addEventListener('mousedown', function (e) { if (e.target === box) done(false); });
      document.addEventListener('keydown', key, true);
    });
  }
  window.darkConfirm = darkConfirm;
  // a form with data-confirm: asked once, then sent as it would have been (with the same button)
  document.addEventListener('submit', function (e) {
    var f = e.target; var text = f && f.getAttribute && f.getAttribute('data-confirm');
    if (!text) return;
    if (f.__confirmed) { f.__confirmed = false; return; }
    e.preventDefault(); e.stopPropagation();
    var by = e.submitter || null;
    var askText = (by && by.getAttribute('data-confirm')) || text;
    darkConfirm(askText, { ok: f.getAttribute('data-confirm-ok') || (by && by.getAttribute('data-confirm-ok')) || 'Да', danger: !f.hasAttribute('data-confirm-soft') }).then(function (ok) {
      if (!ok) return; f.__confirmed = true;
      if (f.requestSubmit) f.requestSubmit(by && by.form === f ? by : undefined); else f.submit();
    });
  }, true);
  // a single button with its own question (in a form that otherwise needs none)
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-confirm]');
    if (!b || !b.form || b.form.hasAttribute('data-confirm')) return;
    if (b.__confirmed) { b.__confirmed = false; return; }
    e.preventDefault(); e.stopPropagation();
    darkConfirm(b.getAttribute('data-confirm'), { ok: b.getAttribute('data-confirm-ok') || 'Да' }).then(function (ok) {
      if (!ok) return; b.__confirmed = true; b.click();
    });
  }, true);
  // a read-only field with a link: one click selects it whole
  document.addEventListener('click', function (e) { var t = e.target; if (t && t.matches && t.matches('input[data-select-all]')) t.select(); });
})();

// A link to the page that is already open (the active tab, a menu item, the logo) does not reload it: the page stays as it
// is and scrolls back to the top. Links with a #part, new-tab links, downloads and Ctrl/⌘/Shift/middle clicks are left alone.
(function () {
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-reload')) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin || url.hash) return;
    var here = location.pathname.replace(/\/+$/, '') + location.search;
    var there = url.pathname.replace(/\/+$/, '') + url.search;
    if (here !== there) return;
    e.preventDefault();
    // a menu that was opened to get here is closed
    var open = document.querySelector('[data-mods-open][aria-expanded="true"]');
    if (open) open.click();
    if (document.documentElement.classList.contains('nd-open')) { var x = document.querySelector('#navDrawer [data-menu-close]'); if (x) x.click(); }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
})();

// Notices after an action (web/views/partials/flash.ejs): over the page; a success one goes away by itself, an error stays
// until closed. The query that brought it (?msg=…, ?error=…) is taken out of the address, so a reload does not repeat it.
// window.flashToast(text, error) shows one from a script (e.g. «Ссылка скопирована»).
(function () {
  function wire(t) {
    document.body.appendChild(t); // out of the page's flow, whatever block it was written in
    var n = document.querySelectorAll('.toast.flash:not(.leaving)').length - 1;
    if (n > 0) t.style.bottom = 'calc(' + (n * 64) + 'px + var(--toast-gap, 24px))';
    var gone = function () { t.classList.add('leaving'); setTimeout(function () { t.remove(); }, 200); };
    t.querySelector('[data-flash-x]').addEventListener('click', gone);
    if (t.getAttribute('data-flash') === 'ok') {
      var timer = setTimeout(gone, t.textContent.trim().length > 90 ? 8000 : 4500);
      t.addEventListener('mouseenter', function () { clearTimeout(timer); });
      t.addEventListener('mouseleave', function () { timer = setTimeout(gone, 2500); });
    }
  }
  window.flashToast = function (text, error) {
    var t = document.createElement('div');
    t.className = 'toast flash' + (error ? ' error' : ''); t.setAttribute('role', error ? 'alert' : 'status'); t.setAttribute('data-flash', error ? 'error' : 'ok');
    t.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (error ? 'M10 6V11M10 14H10.01' : 'M4.5 10.5L8.2 14L15.5 6') + '"/></svg><span></span><button type="button" class="toast-x" data-flash-x aria-label="Закрыть">×</button>';
    t.querySelector('span').textContent = text;
    wire(t);
  };
  var all = document.querySelectorAll('[data-flash]');
  if (!all.length) return;
  var params = new URLSearchParams(location.search); var changed = false;
  Array.prototype.forEach.call(all, function (t) {
    wire(t);
    (t.getAttribute('data-flash-param') || '').split(',').forEach(function (k) { k = k.trim(); if (k && params.has(k)) { params.delete(k); changed = true; } });
  });
  if (changed) { var q = params.toString(); history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); }
})();

// --- «Платформа DARK» → Настройки: the save bar sits at the end of the form and only follows the screen once something
// in the form was changed; leaving the page with unsaved changes asks first.
(function () {
  var f = document.querySelector('form.pf-config');
  if (!f) return;
  var saving = false;
  function mark() { f.classList.add('is-dirty'); }
  f.addEventListener('input', mark);
  f.addEventListener('change', mark);
  f.addEventListener('submit', function () { saving = true; });
  window.addEventListener('beforeunload', function (e) { if (f.classList.contains('is-dirty') && !saving) { e.preventDefault(); e.returnValue = ''; } });
})();

// --- Settings saved without reloading the page (forms marked data-api, see web/routes/dashboard/api.js) ---
// The form's own fields go as JSON; a mistake comes back as a text under that very field, the rest of what was typed stays.
(function () {
  var NEED = { view: 'Просмотр канала', send: 'Отправлять сообщения', embed: 'Встраивать ссылки', history: 'Читать историю сообщений', react: 'Добавлять реакции', connect: 'Подключаться', manage: 'Управлять каналами', move: 'Перемещать участников', webhooks: 'Управлять вебхуками', files: 'Прикреплять файлы' };
  function toast(text, bad) {
    var t = document.createElement('div');
    t.className = 'toast' + (bad ? ' error' : '');
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, text.length > 90 ? 8000 : 3600);
  }
  window.darkToast = toast;
  function guildId() { var tb = document.getElementById('topbar'); return tb ? tb.getAttribute('data-guild') : ''; }
  function values(f) {
    var out = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name || el.disabled || el.name.charAt(0) === '_' || /^(submit|button|file|reset)$/.test(el.type)) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.tagName === 'SELECT' && el.multiple) out[el.name] = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
      else out[el.name] = el.value;
    });
    return out;
  }
  function holder(el) { return el.closest('.set-ctl, .set-row, .checkbox-row, .rule, div') || el.parentNode; }
  function clearErrors(f) {
    f.querySelectorAll('.field-error').forEach(function (n) { n.remove(); });
    f.querySelectorAll('[aria-invalid="true"]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
  }
  function showError(f, name, text) {
    var el = f.elements[name];
    if (!el) return null;
    if (el.length && !el.tagName) el = el[0];
    var id = 'err-' + name;
    var box = holder(el);
    var e = document.createElement('div');
    e.className = 'field-error'; e.id = id; e.textContent = text;
    box.appendChild(e);
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', ((el.getAttribute('aria-describedby') || '').replace(id, '') + ' ' + id).trim());
    return el;
  }
  window.darkApiSave = function (f) {
    if (f.reportValidity && !f.reportValidity()) return Promise.resolve(false);
    clearErrors(f);
    var url = f.getAttribute('data-api-url') || '/dashboard/' + guildId() + '/api/settings/' + f.getAttribute('data-api');
    var btns = f.querySelectorAll('button[type=submit], button:not([type])');
    btns.forEach(function (b) { b.disabled = true; });
    f.classList.add('is-saving');
    return fetch(url, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ values: values(f) }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var j = res.body || {};
        if (res.status === 400 && j.fieldErrors) {
          var first = null;
          Object.keys(j.fieldErrors).forEach(function (k) { var el = showError(f, k, j.fieldErrors[k]); first = first || el; });
          if (first) first.focus();
          toast('Не сохранено: проверьте отмеченные поля', true);
          return false;
        }
        if (!j.ok) { toast(j.error || 'Не удалось сохранить. Обновите страницу и попробуйте снова', true); return false; }
        var warn = j.warnings || {};
        Object.keys(warn).forEach(function (k) {
          var miss = warn[k].indexOf('gone') >= 0 ? 'канал не найден' : 'не хватает прав ' + warn[k].map(function (x) { return '«' + (NEED[x] || x) + '»'; }).join(', ');
          showError(f, k, 'Бот не сможет работать в этом канале: ' + miss + '. Осталось прежнее значение');
        });
        toast(Object.keys(warn).length ? 'Сохранено, но канал не изменён — см. подсказку у поля' : 'Изменения сохранены', Object.keys(warn).length > 0);
        f.dispatchEvent(new CustomEvent('dark:saved', { detail: j }));
        return true;
      })
      .catch(function () { toast('Нет связи с панелью — изменения не сохранены', true); return false; })
      .then(function (ok) { btns.forEach(function (b) { b.disabled = false; }); f.classList.remove('is-saving'); return ok; });
  };
  // A form with data-api on a page without the save bar (or before panel.js has run) is saved the same way.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.hasAttribute || !f.hasAttribute('data-api') || document.getElementById('saveBar')) return;
    e.preventDefault();
    window.darkApiSave(f);
  });
  // «Сбросить к стандартным»: asks first, then the page is read again with the defaults
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-reset-section]');
    if (!b) return;
    e.preventDefault();
    var go = function () {
      fetch('/dashboard/' + guildId() + '/api/settings/' + b.getAttribute('data-reset-section') + '/reset', { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.ok) { window.onbeforeunload = null; location.search = (location.search ? location.search + '&' : '?') + 'reset=1'; } else toast('Не удалось сбросить', true); })
        .catch(function () { toast('Нет связи с панелью', true); });
    };
    var ask = b.getAttribute('data-confirm-text') || 'Вернуть стандартные значения этого раздела? Ваши значения будут заменены.';
    if (window.darkConfirm) window.darkConfirm(ask, { ok: 'Сбросить', danger: true }).then(function (yes) { if (yes) go(); });
    else if (window.confirm(ask)) go();
  });
})();

// --- Slide-over drawer: a form marked data-drawer="Title" is shown in a panel from the right instead of sitting above its
// table; buttons with data-drawer-open="<form id>" open it. Without scripts the form simply stays on the page.
(function () {
  var forms = document.querySelectorAll('form[data-drawer]');
  if (!forms.length) return;
  var back = document.createElement('div'); back.className = 'drawer-back'; back.hidden = true;
  document.body.appendChild(back);
  var opened = null, returnTo = null;
  function close() {
    if (!opened) return;
    var d = opened; opened = null;
    d.classList.remove('open'); back.classList.remove('open'); document.body.classList.remove('drawer-on');
    setTimeout(function () { d.hidden = true; back.hidden = true; }, 200);
    if (returnTo && returnTo.focus) returnTo.focus();
  }
  function open(d, from) {
    if (opened) close();
    returnTo = from || document.activeElement;
    d.hidden = false; back.hidden = false;
    requestAnimationFrame(function () { d.classList.add('open'); back.classList.add('open'); });
    document.body.classList.add('drawer-on');
    opened = d;
    var first = d.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    setTimeout(function () { (first || d.querySelector('.drawer-close')).focus(); }, 60);
  }
  var byId = {};
  forms.forEach(function (f) {
    var d = document.createElement('aside');
    d.className = 'drawer'; d.hidden = true;
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    var hid = 'dr-' + (f.id || Math.random().toString(36).slice(2));
    d.setAttribute('aria-labelledby', hid);
    d.innerHTML = '<div class="drawer-head"><h2></h2><button type="button" class="drawer-close"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5L15 15M15 5L5 15"/></svg></button></div><div class="drawer-body"></div>';
    d.querySelector('h2').id = hid;
    d.querySelector('h2').textContent = f.getAttribute('data-drawer');
    d.querySelector('.drawer-close').setAttribute('aria-label', 'Закрыть');
    d.querySelector('.drawer-close').addEventListener('click', close);
    var keep = f.querySelector('.hint[role=status], [data-keep-open]');
    f.parentNode.insertBefore(document.createComment('drawer: ' + (f.id || '')), f);
    d.querySelector('.drawer-body').appendChild(f);
    document.body.appendChild(d);
    if (f.id) byId[f.id] = d;
    // a result of the last action, or a link straight to the form (#id): open it right away
    if (keep || (f.id && location.hash === '#' + f.id)) setTimeout(function () { open(d); }, 50);
  });
  document.querySelectorAll('[data-drawer-open]').forEach(function (b) { b.hidden = false; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-drawer-open]');
    if (!b) return;
    var d = byId[b.getAttribute('data-drawer-open')];
    if (!d) return;
    e.preventDefault();
    // a row's button fills the form with its member
    var f = d.querySelector('form');
    if (b.hasAttribute('data-fill-user') && f && f.elements.userId) {
      f.elements.userId.value = b.getAttribute('data-fill-user');
      var out = f.querySelector('[data-fill-name-out]'); if (out) out.textContent = b.getAttribute('data-fill-name') || '';
    }
    open(d, b);
  });
  back.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (!opened) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var items = opened.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();

// --- Fields that only matter when something above is on: data-depends="name" (a switch is on), "name=value" or
// "name!=value" (a list has / has not that value). They are dimmed and taken out of the Tab order, not hidden: the
// layout does not jump, and what they are is still readable.
(function () {
  var deps = document.querySelectorAll('[data-depends]');
  if (!deps.length) return;
  function test(rule, scope) {
    var m = /^([\w-]+)\s*(!?=)?\s*(.*)$/.exec(rule); if (!m) return true;
    var form = scope.closest('form') || document;
    var el = form.querySelector('[name="' + m[1] + '"]:not([type=hidden])') || document.querySelector('[name="' + m[1] + '"]:not([type=hidden])');
    if (!el) return true;
    var val = el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value;
    if (!m[2]) return Boolean(val);
    return m[2] === '=' ? val === m[3] : val !== m[3];
  }
  function apply() {
    deps.forEach(function (box) {
      var on = box.getAttribute('data-depends').split('&').every(function (r) { return test(r.trim(), box); });
      box.classList.toggle('is-dependent-off', !on);
      box.setAttribute('aria-disabled', on ? 'false' : 'true');
      box.querySelectorAll('input, select, textarea, button').forEach(function (c) { if (on) { if (c.hasAttribute('data-dep-ti')) { c.removeAttribute('tabindex'); c.removeAttribute('data-dep-ti'); } } else if (!c.hasAttribute('tabindex')) { c.setAttribute('tabindex', '-1'); c.setAttribute('data-dep-ti', ''); } });
    });
  }
  document.addEventListener('change', apply);
  document.addEventListener('input', apply);
  apply();
})();

// --- A search box above a table: data-filter-table="<table id>" hides the rows whose data-filter-text does not match.
(function () {
  document.querySelectorAll('[data-filter-table]').forEach(function (inp) {
    var table = document.getElementById(inp.getAttribute('data-filter-table'));
    if (!table) return;
    inp.addEventListener('input', function () {
      var q = inp.value.trim().toLowerCase();
      table.querySelectorAll('tbody tr').forEach(function (tr) { tr.hidden = Boolean(q) && (tr.getAttribute('data-filter-text') || tr.textContent.toLowerCase()).indexOf(q) < 0; });
    });
  });
  document.querySelectorAll('input.switch').forEach(function (s) { s.setAttribute('role', 'switch'); });
})();

// --- Presets: a button with data-preset='{"field": value, …}' fills its form with recommended values. Nothing is saved:
// the person looks them over and presses «Сохранить». A list for a repeated field (rows of a table) fills it row by row.
(function () {
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-preset]');
    if (!b) return;
    e.preventDefault();
    var form = document.getElementById(b.getAttribute('data-preset-form')) || b.closest('form');
    var data; try { data = JSON.parse(b.getAttribute('data-preset')); } catch (err) { return; }
    if (!form) return;
    var touched = null;
    Object.keys(data).forEach(function (name) {
      var els = form.querySelectorAll('[name="' + name + '"]');
      var vals = Array.isArray(data[name]) ? data[name] : [data[name]];
      els.forEach(function (el, i) {
        var v = i < vals.length ? vals[i] : (Array.isArray(data[name]) ? '' : vals[0]);
        if (el.type === 'checkbox') el.checked = v === true || v === 'on';
        else el.value = v === null || v === undefined ? '' : String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        touched = touched || el;
      });
    });
    if (window.darkToast) window.darkToast('Пресет «' + (b.getAttribute('data-preset-name') || b.textContent.trim()) + '» подставлен — проверьте и сохраните', false);
  });
})();

// --- A saved channel or role that was deleted in Discord: the list shows it as «⚠️ Удалённый …» (option[data-gone]),
// and a note under the field asks to pick another, instead of an empty or silently changed field. The server names
// such settings in #guild-entities (gone: { field: { id, kind } }); a list without its own «⚠️» option gets it at the
// very start of this file, before the lists are dressed.
(function () {
  document.querySelectorAll('option[data-gone]').forEach(function (o) {
    var sel = o.parentNode; if (!sel || !o.selected) return;
    var role = o.getAttribute('data-gone') === 'role';
    var note = document.createElement('div');
    note.className = 'gone-note'; note.setAttribute('role', 'note');
    note.textContent = role ? 'Сохранённая роль удалена в Discord — эта настройка сейчас не работает. Выберите другую роль и сохраните.'
      : 'Сохранённый канал удалён в Discord — эта настройка сейчас не работает. Выберите другой канал и сохраните.';
    var box = sel.closest('.set-ctl, .fld, div') || sel.parentNode;
    box.appendChild(note);
    sel.addEventListener('change', function () { if (!o.selected) note.remove(); });
  });
})();

// --- The side menu: on wide screens the list of pages stays on the left (not a dialog); on narrow ones it is the
// drawer opened by «≡». The same markup serves both.
(function () {
  var drawer = document.getElementById('navDrawer');
  if (!drawer || !window.matchMedia) return;
  var panel = drawer.querySelector('.nd-panel');
  var mq = window.matchMedia('(min-width: 1024px)');
  function apply() {
    if (mq.matches) {
      drawer.hidden = false; drawer.classList.add('is-rail'); document.documentElement.classList.remove('nd-open');
      if (panel) { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.setAttribute('aria-label', 'Меню панели'); }
      var mini = document.documentElement.classList.contains('sb-mini');
      document.querySelectorAll('[data-sb-toggle]').forEach(function (x) { x.setAttribute('aria-pressed', mini ? 'true' : 'false'); });
    } else {
      drawer.classList.remove('is-rail');
      if (!document.documentElement.classList.contains('nd-open')) drawer.hidden = true;
      if (panel) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
    }
  }
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
})();


// --- A text with a limit (textarea or input with maxlength, of a message): how much is left, next to the field.
(function () {
  document.querySelectorAll('.content textarea[maxlength], .drawer textarea[maxlength]').forEach(function (t) {
    var max = Number(t.getAttribute('maxlength')); if (!max) return;
    var c = document.createElement('div'); c.className = 'char-count'; c.setAttribute('aria-live', 'polite');
    function upd() { var n = t.value.length; c.textContent = n + ' / ' + max; c.classList.toggle('near', n > max * 0.9); }
    t.insertAdjacentElement('afterend', c); t.addEventListener('input', upd); upd();
  });
})();

// --- A term typed as text (30m, 2h, 7d, 1мес, 10д…): under the field, what it means in words.
(function () {
  var UNITS = [[/^(м|m|мин|min)/, 'минута', 'минуты', 'минут', 60], [/^(ч|h|час)/, 'час', 'часа', 'часов', 3600], [/^(д|d|дн|day)/, 'день', 'дня', 'дней', 86400], [/^(н|w|нед|week)/, 'неделя', 'недели', 'недель', 604800], [/^(мес|mo|month)/, 'месяц', 'месяца', 'месяцев', 2592000]];
  function plural(n, a, b, c) { var m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; }
  function words(s) {
    var out = []; var re = /(\d+)\s*([a-zа-яё]+)/gi; var m; var any = false;
    while ((m = re.exec(String(s).toLowerCase()))) {
      var n = Number(m[1]); var u = m[2]; var hit = null;
      UNITS.slice().reverse().forEach(function (x) { if (!hit && x[0].test(u) && !(x[1] === 'минута' && /^мес/.test(u))) hit = x; });
      if (!hit) return null;
      any = true; out.push(n + ' ' + plural(n, hit[1], hit[2], hit[3]));
    }
    return any ? out.join(' ') : null;
  }
  document.querySelectorAll('input[data-duration]').forEach(function (inp) {
    var h = document.createElement('div'); h.className = 'hint duration-hint'; h.setAttribute('aria-live', 'polite');
    inp.insertAdjacentElement('afterend', h);
    function upd() { var w = inp.value.trim() ? words(inp.value) : ''; h.textContent = w === null ? 'Не понял срок: напишите, например, 30м, 2ч, 7д или 1мес' : (w ? '= ' + w : ''); h.classList.toggle('bad', w === null); }
    inp.addEventListener('input', upd); upd();
  });
})();

// --- The groups of modules: a strip at the top of the page (#grpBar) and its copy in the top bar (.tb-dock). Scrolled
// down past the strip, the copy slides into the left side of the top bar; scrolled up, it leaves again. Whether the strip
// is in view comes from an IntersectionObserver; the direction counts only after 12 px in one direction (no flicker
// at the edge), read once per frame. A tab opens the list of its group's modules (#grpPop).
(function () {
  var root = document.documentElement;
  var bar = document.getElementById('grpBar');
  var top = document.getElementById('topbar');
  var pop = document.getElementById('grpPop');
  if (!bar || !top) return;
  var dock = top.querySelector('.tb-dock');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var past = false, dir = 0, acc = 0, lastY = window.scrollY, docked = false, frame = 0, leaveTimer = 0;
  var STEP = 12;

  function setDocked(on) {
    if (on === docked) return;
    docked = on;
    clearTimeout(leaveTimer);
    if (on) {
      root.classList.remove('tb-leaving'); root.classList.add('tb-docked');
      if (dock) {
        dock.setAttribute('aria-hidden', 'false'); dock.querySelectorAll('.grp-tab').forEach(function (t) { t.removeAttribute('tabindex'); });
        // a narrow top bar scrolls its strip so that the current group is in view
        var cur = dock.querySelector('.grp-tab.is-cur'); if (cur && dock.scrollWidth > dock.clientWidth) dock.scrollLeft = Math.max(0, cur.getBoundingClientRect().left - dock.getBoundingClientRect().left + dock.scrollLeft - 8);
      }
    } else {
      if (dock) { dock.setAttribute('aria-hidden', 'true'); dock.querySelectorAll('.grp-tab').forEach(function (t) { t.setAttribute('tabindex', '-1'); }); }
      if (pop && !pop.hidden && dock && dock.contains(opener)) closePop(false);
      if (reduce && reduce.matches) { root.classList.remove('tb-docked'); return; }
      root.classList.add('tb-leaving');
      leaveTimer = setTimeout(function () { root.classList.remove('tb-docked', 'tb-leaving'); }, 170);
    }
  }
  function decide() { setDocked(past && dir > 0); }
  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      var y = window.scrollY, d = y - lastY; lastY = y;
      if (!d) return;
      // the distance counts in one direction; a turn starts the count again
      acc = (acc > 0) === (d > 0) ? acc + d : d;
      if (acc >= STEP) dir = 1; else if (acc <= -STEP) dir = -1;
      if (y <= 0) dir = -1;
      decide();
    });
  }
  if ('IntersectionObserver' in window) {
    var topH = Math.round(top.getBoundingClientRect().height);
    var io = new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      // out of view above (under the top bar), not below
      past = !e.isIntersecting && e.boundingClientRect.top < topH;
      if (!past) dir = 0;
      decide();
    }, { rootMargin: '-' + topH + 'px 0px 0px 0px', threshold: 0 });
    io.observe(bar);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---- the list of a group's modules ----
  var opener = null;
  function place(btn) {
    var r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    var w = pop.offsetWidth || 260;
    pop.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - w - 12))) + 'px';
  }
  function openPop(btn) {
    var id = btn.getAttribute('data-grp-open');
    pop.querySelectorAll('[data-grp-list]').forEach(function (l) { l.hidden = l.getAttribute('data-grp-list') !== id; });
    pop.hidden = false; place(btn);
    document.querySelectorAll('[data-grp-open]').forEach(function (b) { b.setAttribute('aria-expanded', b === btn ? 'true' : 'false'); });
    opener = btn;
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', keys, true);
    window.addEventListener('resize', closeOnMove); window.addEventListener('scroll', closeOnMove, { passive: true });
  }
  function closePop(back) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.querySelectorAll('[data-grp-open]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', keys, true);
    window.removeEventListener('resize', closeOnMove); window.removeEventListener('scroll', closeOnMove);
    if (back && opener) opener.focus();
    opener = null;
  }
  var moved = 0;
  function closeOnMove() { if (++moved > 3) { moved = 0; closePop(false); } }
  function outside(e) { if (!pop.contains(e.target) && !(opener && opener.contains(e.target))) closePop(false); }
  function keys(e) {
    var items = Array.prototype.slice.call(pop.querySelectorAll('[data-grp-list]:not([hidden]) .gp-item'));
    var i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closePop(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Tab' && i >= 0) closePop(false);
  }
  if (pop) document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-grp-open]');
    if (!btn) return;
    moved = 0;
    if (opener === btn && !pop.hidden) { closePop(false); return; }
    openPop(btn);
    if (e.detail === 0) { var first = pop.querySelector('[data-grp-list]:not([hidden]) .gp-item'); if (first) first.focus(); } // opened by the keyboard
  });
})();


// --- The preview of a message as a sub-group of its editor (partials/preview-group.ejs). Closed by default; the choice is
// kept in this browser. Open, the editor and the preview stand side by side (.pv-open on [data-pv-grid]); a card with
// an open preview takes the wide width, and the messages builder turns its page into the custom split grid.
(function () {
  var groups = document.querySelectorAll('[data-pv-group]');
  if (!groups.length) return;
  var main = document.querySelector('.app-layout > .content');
  var wrap = document.querySelector('.grp-wrap');
  var LAYOUTS = ['layout-form', 'layout-wide', 'layout-split-custom'];
  var base = main ? LAYOUTS.filter(function (c) { return main.classList.contains(c); })[0] : '';
  function read(k) { try { return localStorage.getItem('dark-pv-' + k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem('dark-pv-' + k, v); } catch (e) { /* not remembered */ } }
  function layout() {
    if (!main) return;
    var builderOpen = Array.prototype.some.call(document.querySelectorAll('[data-pv-grid="builder"].pv-open'), function (g) { return !g.closest('[hidden]'); });
    var want = builderOpen ? 'layout-split-custom' : base;
    [main, wrap].forEach(function (el) { if (!el) return; LAYOUTS.forEach(function (c) { el.classList.toggle(c, c === want); }); });
    var wide = false;
    document.querySelectorAll('[data-pv-grid="embed"]').forEach(function (g) {
      var on = g.classList.contains('pv-open'); var card = g.closest('.card');
      if (card) card.classList.toggle('wide-card', on);
      if (on) wide = true;
    });
    main.classList.toggle('has-wide-card', wide);
  }
  function set(g, open, save) {
    var btn = g.querySelector('[data-pv-toggle]'); var body = g.querySelector('.pv-body'); var act = g.querySelector('[data-pv-act]');
    var grid = g.closest('[data-pv-grid]');
    body.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (act) act.textContent = open ? 'Скрыть' : 'Показать';
    if (grid) grid.classList.toggle('pv-open', open);
    if (save) write(g.getAttribute('data-pv-group'), open ? '1' : '0');
    layout();
  }
  groups.forEach(function (g) {
    var key = g.getAttribute('data-pv-group');
    set(g, read(key) === '1', false);
    g.querySelector('[data-pv-toggle]').addEventListener('click', function () {
      var open = g.querySelector('.pv-body').hidden;
      // one choice for the same kind of editor: every embed editor of the page opens and closes together
      document.querySelectorAll('[data-pv-group="' + key + '"]').forEach(function (x) { set(x, open, x === g); });
      if (!open) g.querySelector('[data-pv-toggle]').focus();
    });
  });
  // the builder's tabs: the split grid only while the editor is shown
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-tab]')) setTimeout(layout, 0); });
  window.addEventListener('hashchange', function () { setTimeout(layout, 0); });
  setTimeout(layout, 0);
})();

// --- «Перенос настроек»: the chosen file is read here and sent as text (the form stays an ordinary one).
(function () {
  var input = document.querySelector('[data-import-file]');
  if (!input || !window.FileReader) return;
  var box = input.closest('form'); var ta = box.querySelector('[data-import-json]'); var go = box.querySelector('[data-import-go]');
  input.addEventListener('change', function () {
    var f = input.files && input.files[0]; go.disabled = true; ta.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { if (window.darkToast) window.darkToast('Файл больше 2 МБ — это не файл настроек', true); return; }
    var r = new FileReader();
    r.onload = function () {
      try { var j = JSON.parse(String(r.result)); if (j.format !== 'dark-settings/1') throw new Error('format'); ta.value = String(r.result); go.disabled = false; } catch (e) { if (window.darkToast) window.darkToast('Это не файл настроек Dark', true); }
    };
    r.readAsText(f);
  });
})();

// --- Templates in a text: a {name} the field does not know is pointed out under it (with the closest known name), and
// once more when the form is saved. Fields list their names in data-vars="user,name,server".
(function () {
  function dist(a, b) {
    var m = []; for (var i = 0; i <= a.length; i++) { m[i] = [i]; for (var j = 1; j <= b.length; j++) m[i][j] = i ? Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) : j; }
    return m[a.length][b.length];
  }
  function unknown(el) {
    var known = el.getAttribute('data-vars').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var out = []; var re = /\{([a-zA-Zа-яё_]+)\}/g; var m;
    while ((m = re.exec(el.value))) if (known.indexOf(m[1]) < 0 && out.indexOf(m[1]) < 0) out.push(m[1]);
    return out.map(function (u) { var best = known.slice().sort(function (x, y) { return dist(u, x) - dist(u, y); })[0]; return { name: u, hint: best && dist(u, best) <= 2 ? best : null }; });
  }
  document.querySelectorAll('[data-vars]').forEach(function (el) {
    var note = document.createElement('div'); note.className = 'hint var-warn'; note.setAttribute('aria-live', 'polite'); note.hidden = true;
    el.insertAdjacentElement('afterend', note);
    function check() {
      var bad = unknown(el);
      note.hidden = !bad.length;
      note.textContent = bad.length ? 'Бот не знает ' + bad.map(function (b) { return '{' + b.name + '}' + (b.hint ? ' — может, {' + b.hint + '}?' : ''); }).join(', ') + '. Такой тег останется в тексте как есть.' : '';
      return bad.length;
    }
    el.addEventListener('input', check); check();
    var form = el.closest('form');
    if (form) form.addEventListener('submit', function () { if (check() && window.darkToast) window.darkToast('В тексте есть неизвестные теги — проверьте подсказку под полем', true); });
  });
})();

// --- «Права доступа»: a role from the list or a member's ID; a ready set ticks its rights (they can still be changed).
(function () {
  var form = document.getElementById('accessAdd');
  if (!form) return;
  var type = form.querySelector('[name="targetType"]'), role = form.querySelector('[data-acc-role]'), user = form.querySelector('[data-acc-user]'), preset = form.querySelector('[data-acc-preset]');
  function sync() { var u = type.value === 'user'; user.hidden = !u; user.disabled = !u; role.disabled = u; var w = role.closest('.fs'); if (w) w.hidden = u; else role.hidden = u; }
  type.addEventListener('change', sync); sync();
  preset.addEventListener('change', function () {
    var o = preset.selectedOptions[0]; var list = o && o.getAttribute('data-scopes') ? o.getAttribute('data-scopes').split(',') : null;
    if (!list) return;
    form.querySelectorAll('[data-acc-boxes] input[name="scopes"]').forEach(function (b) { if (!b.disabled) b.checked = list.indexOf(b.value) >= 0; });
  });
})();

// --- «Права доступа»: a member with delegated rights sees forms he may not send as locked, with the right they need
// (the server refuses them anyway: web/utils/access.js). The table of addresses and scopes comes from the page.
(function () {
  var el = document.getElementById('panel-access');
  if (!el) return;
  var A; try { A = JSON.parse(el.textContent); } catch (e) { return; }
  var mine = A.scopes || [];
  var rules = (A.rules || []).map(function (r) { return [r[0].split('|'), new RegExp(r[1]), r[2]]; });
  var m = /^\/dashboard\/(\d{15,25})/.exec(location.pathname); if (!m) return;
  var base = '/dashboard/' + m[1];
  function need(method, path) {
    var sub = path.indexOf(base) === 0 ? path.slice(base.length) : null; if (sub === null) return [];
    sub = sub.split('?')[0].replace(/\/+$/, '');
    for (var i = 0; i < rules.length; i++) if (rules[i][0].indexOf(method) >= 0 && rules[i][1].test(sub)) return rules[i][2];
    return null;
  }
  function allowed(list) { return Boolean(list) && (!list.length || list.some(function (s) { return mine.indexOf(s) >= 0; })); }
  document.querySelectorAll('form').forEach(function (f) {
    var method = (f.getAttribute('method') || 'GET').toUpperCase(); if (method === 'GET') return;
    var action = f.getAttribute('action') || location.pathname;
    var a = document.createElement('a'); a.href = action; var list = need(method, a.pathname);
    if (allowed(list)) return;
    f.classList.add('is-locked-form');
    f.querySelectorAll('input, select, textarea, button').forEach(function (x) { x.disabled = true; });
    var note = document.createElement('p'); note.className = 'lock-note';
    note.textContent = 'Только просмотр: для изменений нужно право ' + (list && list.length ? list.map(function (s) { return '«' + (A.titles[s] || s) + '»'; }).join(' или ') : 'администратора') + '.';
    f.appendChild(note);
  });
  // the module switches: only with «Настройки сервера»
  if (mine.indexOf('settings.core') < 0) document.querySelectorAll('[data-mod-switch], [data-mod-enable]').forEach(function (x) { x.disabled = true; x.title = 'Включать и выключать модули может участник с правом «Настройки сервера»'; });
})();
