// The economy settings page: the mode decides which blocks are visible; a section's numbers open when it is switched on
// (detailed mode) or ticked "Настроить" (a preset). Without this script every block is simply shown.
(function () {
  var form = document.querySelector('[data-econ-form]');
  if (!form) return;
  function val(name) { var el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }
  function sync() {
    var mode = val('mode') || 'simple';
    var preset = val('preset') || 'calm';
    form.querySelectorAll('[data-econ-pane]').forEach(function (el) { el.hidden = el.getAttribute('data-econ-pane').split(' ').indexOf(mode) === -1; });
    form.querySelectorAll('[data-feat]').forEach(function (el) {
      var key = el.getAttribute('data-feat');
      var inPreset = (el.getAttribute('data-in') || '').split(' ').indexOf(preset) !== -1;
      el.hidden = mode === 'simple' || (mode === 'preset' && !inPreset);
      var on = form.querySelector('input[name="f_' + key + '"]');
      var tune = form.querySelector('input[name="tune_' + key + '"]');
      el.querySelectorAll('[data-ef-custom]').forEach(function (x) { x.hidden = mode !== 'custom'; });
      el.querySelectorAll('[data-ef-preset]').forEach(function (x) { x.hidden = mode !== 'preset'; });
      var open = mode === 'custom' ? on && on.checked : mode === 'preset' && (!tune || tune.checked);
      var active = mode === 'custom' ? on && on.checked : mode === 'preset' && inPreset;
      el.classList.toggle('is-on', !!active);
      var params = el.querySelector('.ef-params');
      if (params) params.hidden = !open;
    });
  }
  form.addEventListener('change', function (e) { if (e.target && /^(mode|preset|f_|tune_)/.test(e.target.name || '')) sync(); });
  sync();
})();
