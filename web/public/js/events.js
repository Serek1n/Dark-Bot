// "События бота": the order choice appears only when both the summary and the separate messages are on; the line under it
// says in words what the bot will send.
(function () {
  var form = document.querySelector('[data-events-form]');
  if (!form) return;
  var sum = form.querySelector('input[name="summary"]');
  var each = form.querySelector('input[name="each"]');
  var order = form.querySelector('[data-ev-order]');
  var plan = form.querySelector('[data-ev-plan]');
  function sync() {
    var both = sum.checked && each.checked;
    if (order) order.hidden = !both;
    var first = form.querySelector('input[name="order"]:checked');
    var text = both ? (first && first.value === 'each-first' ? 'отдельное сообщение на каждый раздел, затем сводка' : 'сводка простыми словами, затем отдельное сообщение на каждый раздел')
      : sum.checked ? 'одно сообщение — сводка простыми словами' : each.checked ? 'отдельное сообщение на каждый раздел' : 'не объявляется';
    if (plan) plan.textContent = text;
  }
  form.addEventListener('change', sync);
  sync();
})();
