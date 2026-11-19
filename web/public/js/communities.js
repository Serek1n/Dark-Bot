// «Сообщества»: «Поделиться» — the phone's own share sheet where there is one, otherwise the link is copied.
(function () {
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-share]');
    if (!b) return;
    var url = b.getAttribute('data-share');
    if (!/^https?:/.test(url)) url = location.origin + url;
    var title = b.getAttribute('data-share-title') || document.title;
    var label = b.querySelector('span');
    var done = function () { if (window.flashToast) return window.flashToast('Ссылка на сообщество скопирована'); if (!label) return; var was = label.textContent; label.textContent = 'Ссылка скопирована'; setTimeout(function () { label.textContent = was; }, 2000); };
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () { /* closed */ }); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Ссылка на сообщество', url); });
    else window.prompt('Ссылка на сообщество', url);
  });
})();

// Screenshots open over the page (not in a new tab): arrows and swipes go through them, Esc, × or a click beside closes.
// The links stay real links, so without scripts — or with Ctrl/middle click — the picture still opens on its own.
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox] a'));
  if (!links.length) return;
  var box = null; var img; var count; var at = 0; var back = null;
  var arrow = function (d) { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>'; };
  function build() {
    box = document.createElement('div');
    box.className = 'lb'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Скриншоты');
    box.innerHTML = '<div class="lb-top"><span class="lb-count" aria-live="polite"></span><a class="lb-open" target="_blank" rel="noopener noreferrer nofollow">Открыть оригинал</a><button type="button" class="lb-x" aria-label="Закрыть">×</button></div>' +
      '<button type="button" class="lb-nav prev" aria-label="Предыдущий">' + arrow('M15 5L8 12L15 19') + '</button>' +
      '<figure class="lb-stage"><img alt="" /></figure>' +
      '<button type="button" class="lb-nav next" aria-label="Следующий">' + arrow('M9 5L16 12L9 19') + '</button>';
    document.body.appendChild(box);
    img = box.querySelector('img'); count = box.querySelector('.lb-count');
    box.addEventListener('click', function (e) {
      if (e.target.closest('.lb-x') || e.target === box || e.target.classList.contains('lb-stage')) return close();
      if (e.target.closest('.prev')) return show(at - 1);
      if (e.target.closest('.next')) return show(at + 1);
    });
    var x0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    box.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1)); }, { passive: true });
  }
  function show(i) {
    at = (i + links.length) % links.length;
    var a = links[at]; var src = a.getAttribute('href');
    img.src = src; img.alt = (a.querySelector('img') || {}).alt || '';
    box.querySelector('.lb-open').href = src;
    count.textContent = links.length > 1 ? (at + 1) + ' из ' + links.length : '';
    box.querySelectorAll('.lb-nav').forEach(function (b) { b.hidden = links.length < 2; });
  }
  function open(i) {
    if (!box) build();
    back = document.activeElement;
    show(i); box.hidden = false; document.documentElement.classList.add('lb-lock');
    box.querySelector('.lb-x').focus();
  }
  function close() {
    box.hidden = true; document.documentElement.classList.remove('lb-lock'); img.removeAttribute('src');
    if (back && back.focus) back.focus();
  }
  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; // a new tab, if that is what was asked for
      e.preventDefault(); open(i);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (!box || box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'Tab') { // keep the focus in the viewer
      var f = Array.prototype.filter.call(box.querySelectorAll('button, a[href]'), function (x) { return !x.hidden; });
      var first = f[0]; var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
})();
