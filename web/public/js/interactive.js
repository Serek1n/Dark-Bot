// The "Интерактивные сообщения" form: show more item rows, and the fields that fit buttons or a list.
(function () {
  var more = document.getElementById('imMore');
  var kind = document.getElementById('imKind');
  if (!more || !kind) return;
  more.addEventListener('click', function () {
    var next = document.querySelector('.im-item[hidden]');
    if (next) next.hidden = false;
    if (!document.querySelector('.im-item[hidden]')) more.hidden = true;
  });
  function sync() {
    var list = kind.value === 'select';
    Array.prototype.forEach.call(document.querySelectorAll('.im-select-only'), function (el) { el.hidden = !list; });
    Array.prototype.forEach.call(document.querySelectorAll('.im-buttons-only'), function (el) { el.hidden = list; });
  }
  kind.addEventListener('change', sync);
  sync();
})();
