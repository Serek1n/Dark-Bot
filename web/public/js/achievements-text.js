// Достижения → Настройки: the Discord-style preview follows the own text (filled in by the server with a sample), the
// switches of the buttons and their labels.
(function () {
  var box = document.querySelector('[data-ach-preview]');
  if (!box) return;
  var field = document.getElementById('achievementsMessage');
  var out = box.querySelector('[data-ach-preview-text]');
  var url = box.getAttribute('data-url');
  var textOn = box.getAttribute('data-text-on') === '1';
  // **bold**, *italic* and the rest as plain text (never HTML from the field)
  function show(text) {
    out.textContent = '';
    if (!textOn) return;
    String(text || '').split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).forEach(function (part) {
      if (!part) return;
      var el;
      if (/^\*\*[^*]+\*\*$/.test(part)) { el = document.createElement('b'); el.textContent = part.slice(2, -2); }
      else if (/^\*[^*]+\*$/.test(part)) { el = document.createElement('i'); el.textContent = part.slice(1, -1); }
      else el = document.createTextNode(part);
      out.appendChild(el);
    });
  }
  var timer = null;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: field ? field.value : '' }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { show(j.text); })
        .catch(function () { /* the preview is a help, not a must */ });
    }, 300);
  }
  if (field) field.addEventListener('input', refresh);
  refresh();
  var form = box.closest('form');
  var sync = function () {
    var b = form.querySelector('[data-ach-buttons]');
    box.querySelector('[data-ach-preview-btns]').hidden = !(b && b.checked);
    var m = form.querySelector('[name="achMine"]'); var a = form.querySelector('[name="achAll"]');
    box.querySelector('[data-ach-preview-mine]').textContent = (m && m.value.trim()) || 'Мои достижения';
    box.querySelector('[data-ach-preview-all]').textContent = (a && a.value.trim()) || 'Все достижения';
  };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
})();
