// «Сообщества»: «Поделиться» — the phone's own share sheet where there is one, otherwise the link is copied.
(function () {
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-share]');
    if (!b) return;
    var url = b.getAttribute('data-share');
    if (!/^https?:/.test(url)) url = location.origin + url;
    var title = b.getAttribute('data-share-title') || document.title;
    var label = b.querySelector('span');
    var done = function () { if (!label) return; var was = label.textContent; label.textContent = 'Ссылка скопирована'; setTimeout(function () { label.textContent = was; }, 2000); };
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () { /* closed */ }); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Ссылка на сообщество', url); });
    else window.prompt('Ссылка на сообщество', url);
  });
})();
