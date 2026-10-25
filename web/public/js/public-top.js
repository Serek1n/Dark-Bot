// Search on the public leaderboard (kept in a file: the page allows no inline scripts of its own).
(function () {
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
