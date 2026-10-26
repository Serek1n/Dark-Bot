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
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && img.hasAttribute('data-initial')) tile(img);
  }, true);
  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-initial]'), function (img) {
      if (img.complete && img.naturalWidth === 0) tile(img);
    });
    railScroll();
    revealActive();
    quickJump();
  });

  // 2) The side menu scrolls without the browser's wide scrollbar: a thin thumb appears while scrolling, and the edges fade
  //    where there is more to see.
  function railScroll() {
    var nav = document.querySelector('.sidebar nav');
    var rail = document.querySelector('.sidebar');
    if (!nav || !rail) return;
    var thumb = document.createElement('div');
    thumb.className = 'rail-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    rail.appendChild(thumb);
    var hideTimer = null;
    function update(show) {
      var max = nav.scrollHeight - nav.clientHeight;
      nav.classList.toggle('can-up', nav.scrollTop > 2);
      nav.classList.toggle('can-down', nav.scrollTop < max - 2);
      if (max <= 2) { thumb.style.opacity = '0'; return; }
      var ratio = nav.clientHeight / nav.scrollHeight;
      var h = Math.max(28, nav.clientHeight * ratio);
      var top = nav.offsetTop + (nav.scrollTop / max) * (nav.clientHeight - h);
      thumb.style.height = h + 'px';
      thumb.style.transform = 'translateY(' + top + 'px)';
      if (show) {
        thumb.style.opacity = '1';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { thumb.style.opacity = '0'; }, 900);
      }
    }
    nav.addEventListener('scroll', function () { update(true); }, { passive: true });
    window.addEventListener('resize', function () { update(false); });
    rail.addEventListener('transitionend', function () { update(false); });
    update(false);
  }

  // 3) The current page's menu item is scrolled into view (on phones the menu is a horizontal strip: without this the
  //    strip always starts at "Обзор", whatever page is open).
  function revealActive() {
    var nav = document.querySelector('.sidebar nav');
    var link = nav && nav.querySelector('a.active');
    if (!link) return;
    // phones: the whole side menu is the horizontal strip; desktop: the list of links scrolls vertically
    var strip = document.querySelector('.sidebar');
    if (strip.scrollWidth > strip.clientWidth + 2) {
      var s = strip.getBoundingClientRect(), l = link.getBoundingClientRect();
      strip.scrollLeft += l.left - s.left - (s.width - l.width) / 2;
    } else if (nav.scrollHeight > nav.clientHeight + 2) {
      var n = nav.getBoundingClientRect(), k = link.getBoundingClientRect();
      if (k.top < n.top || k.bottom > n.bottom) nav.scrollTop += k.top - n.top - (n.height - k.height) / 2;
    }
  }

  // 4) Quick jump between sections: Ctrl+K (⌘K) or "/" opens a search over the menu, Enter goes to the found page.
  function quickJump() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.sidebar nav a[title]'));
    if (!links.length) return;
    var items = links.map(function (a) {
      var t = a.getAttribute('title').split(' — ');
      return { name: t[0], desc: t[1] || '', href: a.getAttribute('href'), icon: a.querySelector('svg') ? a.querySelector('svg').outerHTML : '' };
    });
    var box = document.createElement('div');
    box.className = 'qj';
    box.hidden = true;
    box.innerHTML = '<div class="qj-panel" role="dialog" aria-modal="true" aria-label="Переход к разделу">' +
      '<input class="qj-input" type="search" placeholder="Найти раздел: уровни, магазин, логи…" autocomplete="off" aria-label="Поиск раздела" />' +
      '<div class="qj-list" role="listbox"></div><div class="qj-hint"><kbd>↑</kbd><kbd>↓</kbd> выбрать · <kbd>Enter</kbd> открыть · <kbd>Esc</kbd> закрыть</div></div>';
    document.body.appendChild(box);
    var input = box.querySelector('.qj-input'), list = box.querySelector('.qj-list'), shown = [], sel = 0;
    function norm(s) { return s.toLowerCase().replace(/ё/g, 'е'); }
    function draw() {
      var q = norm(input.value.trim());
      shown = items.filter(function (it) { return !q || norm(it.name + ' ' + it.desc).indexOf(q) !== -1; });
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      if (!shown.length) { list.innerHTML = '<div class="qj-empty">Ничего не найдено</div>'; return; }
      shown.forEach(function (it, i) {
        var a = document.createElement('a');
        a.href = it.href; a.className = 'qj-item' + (i === sel ? ' sel' : ''); a.setAttribute('role', 'option');
        a.innerHTML = it.icon + '<span><b></b><small></small></span>';
        a.querySelector('b').textContent = it.name; a.querySelector('small').textContent = it.desc;
        list.appendChild(a);
      });
      var cur = list.children[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function open() { box.hidden = false; input.value = ''; sel = 0; draw(); input.focus(); document.documentElement.classList.add('qj-open'); }
    function close() { box.hidden = true; document.documentElement.classList.remove('qj-open'); }
    input.addEventListener('input', function () { sel = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) { location.href = shown[sel].href; e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if ((e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); box.hidden ? open() : close(); }
      else if (e.key === '/' && !typing && box.hidden) { e.preventDefault(); open(); }
      else if (e.key === 'Escape' && !box.hidden) close();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-quick-jump]'), function (b) { b.addEventListener('click', open); });
  }
})();
