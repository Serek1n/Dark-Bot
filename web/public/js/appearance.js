// «Оформление»: live previews while the form is edited (the pictures are drawn by the server with the chosen theme, the
// room panel is a mock in the page), and a message is never left without both a picture and a text.
(function () {
  var form = document.querySelector('[data-look-form]');
  if (!form) return;
  var base = form.getAttribute('data-base');

  function themeQuery() {
    var picked = form.querySelector('input[name="theme"]:checked');
    if (!picked) return '';
    var on = form.querySelector('[data-accent-on]');
    var color = form.querySelector('[data-accent]');
    return 'theme=' + encodeURIComponent(picked.value) + '&accent=' + encodeURIComponent(on && on.checked && color ? color.value.replace('#', '') : '');
  }

  var timer = null;
  function refresh(only) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var q = themeQuery();
      Array.prototype.forEach.call(form.querySelectorAll('[data-look-preview]'), function (img) {
        var kind = img.getAttribute('data-look-preview');
        if (only && only !== kind) return;
        var head = form.querySelector('[data-look-headline="' + kind + '"]');
        var parts = [];
        if (q) parts.push(q);
        if (head && head.value.trim()) parts.push('headline=' + encodeURIComponent(head.value.trim()));
        var fmt = form.querySelector('[data-look-format="' + kind + '"]:checked');
        if (fmt) parts.push('format=' + encodeURIComponent(fmt.value));
        img.classList.add('is-loading');
        img.onload = img.onerror = function () { img.classList.remove('is-loading'); };
        img.src = base + '/appearance/preview/' + kind + '.png' + (parts.length ? '?' + parts.join('&') : '');
      });
    }, 250);
  }

  // the theme and the own colour
  var accentOn = form.querySelector('[data-accent-on]');
  var accentBox = form.querySelector('[data-accent-box]');
  var accent = form.querySelector('[data-accent]');
  var hex = form.querySelector('[data-accent-hex]');
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-look-format')) { refresh(t.getAttribute('data-look-format')); return; }
    if (t.name === 'theme' || t === accentOn) {
      if (t === accentOn && accentBox) accentBox.hidden = !accentOn.checked;
      refresh();
    }
  });
  if (accent) accent.addEventListener('input', function () { if (hex) hex.textContent = accent.value; refresh(); });

  // headlines of the cards
  Array.prototype.forEach.call(form.querySelectorAll('[data-look-headline]'), function (input) {
    var kind = input.getAttribute('data-look-headline');
    if (kind) input.addEventListener('input', function () { refresh(kind); });
  });

  // a picture, a text or both — never neither: unticking the last one ticks the other
  Array.prototype.forEach.call(form.querySelectorAll('[data-look-parts]'), function (box) {
    var boxes = box.querySelectorAll('input[type="checkbox"]');
    var hint = box.parentNode.querySelector('[data-look-hint]');
    Array.prototype.forEach.call(boxes, function (cb) {
      cb.addEventListener('change', function () {
        var any = Array.prototype.some.call(boxes, function (x) { return x.checked; });
        if (!any) {
          var other = Array.prototype.find.call(boxes, function (x) { return x !== cb; });
          if (other) other.checked = true;
          if (hint) { hint.classList.remove('is-flash'); void hint.offsetWidth; hint.classList.add('is-flash'); }
        }
      });
    });
  });

  // the room panel mock follows the switches and the texts
  var mock = form.querySelector('[data-vp-mock]');
  if (mock) {
    var get = function (n) { return form.querySelector('[name="' + n + '"]'); };
    var sync = function () {
      mock.classList.toggle('own', get('voicePanel_card').checked);
      Array.prototype.forEach.call(mock.querySelectorAll('[data-vp-line]'), function (l) { l.hidden = !get('voicePanel_text').checked; });
      Array.prototype.forEach.call(mock.querySelectorAll('[data-vp-btns]'), function (b) { b.classList.toggle('labels', get('voicePanel_labels').checked); });
      var title = get('voicePanel_headline'); var intro = get('voicePanel_intro');
      mock.querySelector('[data-vp-title]').textContent = title.value.trim() || title.placeholder;
      mock.querySelector('[data-vp-intro]').textContent = intro.value.trim() || intro.placeholder;
    };
    form.addEventListener('change', sync);
    form.addEventListener('input', sync);
  }
})();
