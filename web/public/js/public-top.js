// Search on the public leaderboard (kept in a file: the page allows no inline scripts of its own).
(function () {
  // an avatar that fails to load becomes the first letter of the name
  document.addEventListener('error', function (e) {
    var img = e.target; var person = img && img.tagName === 'IMG' && img.closest('.person');
    if (!person) return;
    var span = document.createElement('span'); span.className = 'avatar-initial'; span.setAttribute('aria-hidden', 'true');
    span.textContent = ((person.textContent || '').trim().charAt(0) || '?').toUpperCase(); img.replaceWith(span);
  }, true);
  var input = document.getElementById('lbSearch');
  if (!input) return;
  var rows = document.querySelectorAll('.lb-row');
  var count = document.getElementById('lbCount');
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase(), shown = 0;
    rows.forEach(function (r) { var ok = !q || r.getAttribute('data-name').indexOf(q) !== -1; r.style.display = ok ? '' : 'none'; if (ok) shown++; });
    count.textContent = q ? 'Найдено: ' + shown : rows.length + ' в рейтинге';
  });
})();
