// Colour theme (dark / light), the seasonal look (on / off) and the pinned state of the side menu. The choices stay in
// this browser only.
// Loaded in <head> without defer so the right theme is on the page before it is first painted (no flash).
(function () {
  var root = document.documentElement;
  // a seasonal look of the site (web/utils/season.js), announced by the server in <meta name="dark-season">
  // and switched off by the visitor if they like ("dark-season-off" keeps the name of the season they turned off, so the
  // next season is shown again)
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private window: the choice just is not remembered */ } }
  var seasonMeta = document.querySelector('meta[name="dark-season"]');
  var season = seasonMeta ? seasonMeta.getAttribute('content') : '';
  if (season && read('dark-season-off') !== season) root.setAttribute('data-season', season);
  var SEASON_BAR = { vice: { dark: '#140a22', light: '#fff1e8' } };

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    var bar = root.getAttribute('data-season') && SEASON_BAR[season];
    if (meta) meta.setAttribute('content', bar ? bar[theme === 'light' ? 'light' : 'dark'] : (theme === 'light' ? '#f4f5f8' : '#0e1016'));
  }
  var theme = read('dark-theme');
  applyTheme(theme === 'light' ? 'light' : 'dark');
  if (read('dark-rail') === '1') root.classList.add('rail-pinned');
  // the side menu on wide screens: full or folded to icons — only by a click on its button, remembered here
  if (read('dark-sidebar-mini') === '1') root.classList.add('sb-mini');
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sb-toggle]');
    if (!b) return;
    var mini = root.classList.toggle('sb-mini');
    write('dark-sidebar-mini', mini ? '1' : '0');
    Array.prototype.forEach.call(document.querySelectorAll('[data-sb-toggle]'), function (x) { x.setAttribute('aria-pressed', mini ? 'true' : 'false'); x.setAttribute('aria-label', mini ? 'Развернуть меню' : 'Свернуть меню'); x.setAttribute('title', mini ? 'Развернуть меню' : 'Свернуть меню'); });
  });

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
    function syncSeason() {
      var on = root.hasAttribute('data-season');
      Array.prototype.forEach.call(document.querySelectorAll('[data-season-toggle]'), function (b) {
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        var label = on ? 'Выключить оформление Vice Nights' : 'Включить оформление Vice Nights';
        b.setAttribute('title', label); b.setAttribute('aria-label', label);
      });
    }
    syncSeason();
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-theme-toggle], [data-rail-pin], [data-season-toggle]') : null;
      if (!t) return;
      if (t.hasAttribute('data-season-toggle')) {
        if (!season) return;
        if (root.hasAttribute('data-season')) { root.removeAttribute('data-season'); write('dark-season-off', season); } else { root.setAttribute('data-season', season); write('dark-season-off', ''); }
        applyTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'); syncSeason();
      } else if (t.hasAttribute('data-theme-toggle')) {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next); write('dark-theme', next);
      } else {
        var pinned = root.classList.toggle('rail-pinned');
        write('dark-rail', pinned ? '1' : '0'); syncPin();
      }
    });
  });
})();
