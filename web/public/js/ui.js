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
      return { name: t[0], desc: t[1] || '', href: a.getAttribute('href'), icon: a.querySelector('svg') ? a.querySelector('svg').outerHTML : '' };
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
      '<input class="qj-input" type="search" placeholder="Раздел или настройка: магазин, пауза, мат…" autocomplete="off" aria-label="Поиск раздела или настройки" />' +
      '<div class="qj-list" role="listbox"></div><div class="qj-hint"><kbd>↑</kbd><kbd>↓</kbd> выбрать · <kbd>Enter</kbd> открыть · <kbd>Esc</kbd> закрыть</div></div>';
    document.body.appendChild(box);
    var input = box.querySelector('.qj-input'), list = box.querySelector('.qj-list'), shown = [], sel = 0;
    function norm(s) { return s.toLowerCase().replace(/ё/g, 'е'); }
    function match(it, words) { var h = norm(it.name + ' ' + it.desc); return words.every(function (w) { return h.indexOf(w) !== -1; }); }
    function head(text) { var d = document.createElement('div'); d.className = 'qj-head'; d.textContent = text; return d; }
    function draw() {
      var q = norm(input.value.trim()); var words = q ? q.split(/\s+/) : [];
      var foundPages = pages.filter(function (it) { return !words.length || match(it, words); });
      var foundSettings = words.length && settings ? settings.filter(function (it) { return norm(it.name).indexOf(words[0]) !== -1 && match(it, words); }).slice(0, 30) : [];
      shown = foundPages.concat(foundSettings);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      if (!shown.length) { list.innerHTML = '<div class="qj-empty">Ничего не найдено</div>'; return; }
      shown.forEach(function (it, i) {
        if (i === 0 && foundPages.length && words.length) list.appendChild(head('Разделы'));
        if (i === foundPages.length) list.appendChild(head('Настройки'));
        var a = document.createElement('a');
        a.href = it.href; a.className = 'qj-item' + (i === sel ? ' sel' : '') + (it.setting ? ' qj-setting' : ''); a.setAttribute('role', 'option');
        a.innerHTML = it.icon + '<span><b></b><small></small></span>';
        a.querySelector('b').textContent = it.name; a.querySelector('small').textContent = it.setting ? '↳ ' + it.desc : it.desc;
        list.appendChild(a);
      });
      var cur = list.querySelectorAll('.qj-item')[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function go(it) { var here = location.pathname === it.href.split('#')[0]; location.href = it.href; if (here) { close(); findOnPage(); } }
    function open() { box.hidden = false; input.value = ''; sel = 0; draw(); input.focus(); document.documentElement.classList.add('qj-open'); loadSettings(); }
    function close() { box.hidden = true; document.documentElement.classList.remove('qj-open'); }
    input.addEventListener('input', function () { sel = 0; draw(); });
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
          .then(function (j) { out.textContent = j.text || '(пусто)'; })
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

  // 7) Message editor: the embed fields show up with the switch, and the preview follows what is typed.
  function embedEditors() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-embed-editor]'), function (box) {
      var toggle = box.querySelector('[data-embed-toggle]'), fields = box.querySelector('.embed-fields');
      var get = function (k) { return box.querySelector('[data-ef="' + k + '"]'); };
      var pv = { bar: box.querySelector('.ep-bar'), title: box.querySelector('.ep-title'), desc: box.querySelector('.ep-desc'), image: box.querySelector('.ep-image'), footer: box.querySelector('.ep-footer'), thumb: box.querySelector('.ep-thumb') };
      var draw = function () {
        fields.hidden = !toggle.checked;
        pv.bar.style.background = get('color').value || '#8b7cf6';
        pv.title.textContent = get('title').value;
        var d = get('description').value;
        pv.desc.textContent = d || (get('title').value ? '' : 'Пустой эмбед не отправится — напишите заголовок или текст');
        pv.desc.classList.toggle('ep-empty', !d && !get('title').value);
        var foot = get('footer').value + (get('timestamp').checked ? (get('footer').value ? ' • ' : '') + 'сегодня в 12:00' : '');
        pv.footer.textContent = foot; pv.footer.hidden = !foot;
        var img = get('image').value.trim();
        pv.image.hidden = !img;
        if (/^https:\/\//i.test(img)) { pv.image.style.backgroundImage = 'url("' + img.replace(/["\\]/g, '') + '")'; pv.image.textContent = ''; } else { pv.image.style.backgroundImage = ''; pv.image.textContent = img ? 'картинка: ' + img : ''; }
        var th = get('thumbnail').value;
        pv.thumb.hidden = !th; pv.thumb.textContent = th === 'avatar' ? 'аватар' : th === 'icon' ? 'иконка' : '';
      };
      box.addEventListener('input', draw); box.addEventListener('change', draw); draw();
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
  document.querySelectorAll('.pick').forEach(multiPick);
  if (window.MutationObserver) {
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType !== 1) return; if (n.matches && n.matches('input[type=number]')) stepper(n); if (n.querySelectorAll) n.querySelectorAll('input[type=number]').forEach(stepper); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
