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
    pageToc();
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

  // 3) "На этой странице": on wide screens the cards of the page are listed in a column on the left (built from their
  //    headings, so every page has it); the card on screen is lit while scrolling. Narrow screens keep the buttons on top.
  function pageToc() {
    var content = document.querySelector('.app-layout > .content');
    if (!content || !document.querySelector('.topbar') || content.querySelector('.msg-tabs')) return; // pages with their own tabs keep them
    var heads = Array.prototype.filter.call(content.querySelectorAll('.card > h2, section.card h2, .card > .card-head h2'), function (h) {
      return h.offsetParent !== null || h.closest('[data-pane]');
    }).filter(function (h) { return !h.closest('[hidden]'); });
    if (heads.length < 3) return;
    var title = (content.querySelector('.page-header h1, .hero h1, h1') || {}).textContent || '';
    var toc = document.createElement('nav'); toc.className = 'page-toc'; toc.setAttribute('aria-label', 'На этой странице');
    var cap = document.createElement('div'); cap.className = 'toc-cap'; cap.textContent = 'На этой странице'; toc.appendChild(cap);
    var links = [];
    heads.forEach(function (h, i) {
      var card = h.closest('.card') || h;
      if (!card.id) card.id = 'sec-' + (i + 1);
      var a = document.createElement('a'); a.href = '#' + card.id;
      var first = h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.textContent : h.textContent;
      a.textContent = (first || '').trim() || h.textContent.trim();
      a.addEventListener('click', function (e) { e.preventDefault(); card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); history.replaceState(null, '', '#' + card.id); });
      toc.appendChild(a); links.push({ a: a, card: card });
    });
    void title;
    document.body.appendChild(toc);
    document.body.classList.add('has-toc');
    // The lit item: the section whose top passed under the bar last; at the very bottom of the page — the last one
    // (a short last section never reaches the top). A click lights its item right away.
    var lockUntil = 0;
    function light(l) { links.forEach(function (x) { x.a.classList.toggle('on', x === l); }); }
    function update() {
      if (Date.now() < lockUntil) return;
      var line = 140, cur = links[0];
      var atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atEnd) cur = links[links.length - 1];
      else links.forEach(function (l) { if (l.card.getBoundingClientRect().top - line <= 0) cur = l; });
      light(cur);
    }
    links.forEach(function (l) {
      l.a.addEventListener('click', function () { light(l); lockUntil = Date.now() + 700; });
    });
    var ticking = false;
    window.addEventListener('scroll', function () { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; update(); }); }, { passive: true });
    window.addEventListener('resize', update);
    update();
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
      '<div class="qj-field"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.3"/><path d="M12.8 12.8L16.5 16.5"/></svg>' +
      '<input class="qj-input" type="search" placeholder="Раздел или настройка: магазин, пауза, мат…" autocomplete="off" aria-label="Поиск раздела или настройки" />' +
      '<button type="button" class="qj-close" aria-label="Закрыть поиск">Esc</button></div>' +
      '<div class="qj-list" role="listbox"></div><div class="qj-hint"><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span></div></div>';
    document.body.appendChild(box);
    var input = box.querySelector('.qj-input'), list = box.querySelector('.qj-list'), shown = [], sel = 0;
    function norm(s) { return s.toLowerCase().replace(/ё/g, 'е'); }
    function match(it, words) { var h = norm(it.name + ' ' + it.desc); return words.every(function (w) { return h.indexOf(w) !== -1; }); }
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
      if (!shown.length) { list.innerHTML = '<div class="qj-empty">Ничего не найдено</div>'; return; }
      shown.forEach(function (it, i) {
        if (i === 0 && foundPages.length && words.length) list.appendChild(head('Разделы'));
        if (i === foundPages.length) list.appendChild(head('Настройки'));
        var a = document.createElement('a');
        a.href = it.href; a.className = 'qj-item' + (i === sel ? ' sel' : '') + (it.setting ? ' qj-setting' : ''); a.setAttribute('role', 'option');
        a.innerHTML = '<span class="qj-ic">' + it.icon + '</span><span class="qj-txt"><b></b><small></small></span>' + (i === sel ? '<kbd class="qj-enter">↵</kbd>' : '');
        mark(a.querySelector('b'), it.name, words); a.querySelector('small').textContent = it.setting ? '↳ ' + it.desc : it.desc;
        list.appendChild(a);
      });
      var cur = list.querySelectorAll('.qj-item')[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function go(it) { var here = location.pathname === it.href.split('#')[0]; location.href = it.href; if (here) { close(); findOnPage(); } }
    function open() { box.hidden = false; input.value = ''; sel = 0; draw(); input.focus(); document.documentElement.classList.add('qj-open'); requestAnimationFrame(function () { box.classList.add('in'); }); loadSettings(); }
    function close() { box.classList.remove('in'); box.hidden = true; document.documentElement.classList.remove('qj-open'); }
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

  // 8) Dropdowns: every single-choice list becomes a button with a popover list (search in long ones, keyboard, groups).
  //    The real <select> stays underneath: forms, labels and scripts that read or set .value keep working.
  var openSelect = null;
  function fancySelect(sel) {
    if (sel.dataset.fs || sel.multiple || sel.size > 1 || sel.closest('[data-native], .ms')) return;
    sel.dataset.fs = '1';
    var w = sel.offsetWidth, pw = sel.parentElement ? sel.parentElement.clientWidth : 0;
    var wrap = document.createElement('div'); wrap.className = 'fs';
    if (w && pw && w < pw * 0.85) { wrap.classList.add('fs-inline'); wrap.style.minWidth = w + 'px'; }
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); sel.classList.add('fs-native'); sel.tabIndex = -1;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fs-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    if (sel.id) { var lab = document.querySelector('label[for="' + sel.id + '"]'); if (lab) { if (!lab.id) lab.id = sel.id + '-lbl'; btn.setAttribute('aria-labelledby', lab.id + ' ' + (sel.id + '-val')); } }
    else if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    btn.innerHTML = '<span class="fs-val"></span><svg class="fs-chev" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>';
    var val = btn.querySelector('.fs-val'); if (sel.id) val.id = sel.id + '-val';
    wrap.appendChild(btn);
    var pop = document.createElement('div'); pop.className = 'fs-pop'; pop.hidden = true;
    wrap.appendChild(pop);
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
      var r = btn.getBoundingClientRect(), below = window.innerHeight - r.bottom, above = r.top;
      wrap.classList.toggle('up', below < 280 && above > below);
    }
    function open() {
      if (sel.disabled) return;
      if (openSelect && openSelect !== close) openSelect();
      build(); place(); pop.hidden = false; wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); openSelect = close;
      var cur = items.findIndex(function (x) { return x.o.selected; }); setActive(cur);
      if (search) search.focus();
    }
    function close() { pop.hidden = true; wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); if (openSelect === close) openSelect = null; }
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
    document.addEventListener('pointerdown', function (e) { if (!pop.hidden && !wrap.contains(e.target)) close(); });
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
})();
