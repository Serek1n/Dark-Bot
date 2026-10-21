// Colour theme (dark / light) and the pinned state of the side menu. Both choices stay in this browser only.
// Loaded in <head> without defer so the right theme is on the page before it is first painted (no flash).
(function () {
  var root = document.documentElement;
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private window: the choice just is not remembered */ } }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f8' : '#0e1016');
  }
  var theme = read('dark-theme');
  applyTheme(theme === 'light' ? 'light' : 'dark');
  if (read('dark-rail') === '1') root.classList.add('rail-pinned');

  document.addEventListener('DOMContentLoaded', function () {
    function syncPin() {
      var on = root.classList.contains('rail-pinned');
      Array.prototype.forEach.call(document.querySelectorAll('[data-rail-pin]'), function (b) {
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = on ? 'Открепить меню' : 'Закрепить меню';
        b.setAttribute('aria-label', label); b.setAttribute('title', label);
      });
    }
    syncPin();
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-theme-toggle], [data-rail-pin]') : null;
      if (!t) return;
      if (t.hasAttribute('data-theme-toggle')) {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next); write('dark-theme', next);
      } else {
        var pinned = root.classList.toggle('rail-pinned');
        write('dark-rail', pinned ? '1' : '0'); syncPin();
      }
    });
  });
})();
