// Small touches for the panel: a letter instead of a broken server icon, and a quiet scroll indicator for the side menu.
(function () {
  // 1) A server icon that fails to load (Discord CDN hiccup) becomes a tile with the first letter of the name.
  function tile(img) {
    var span = document.createElement('span');
    span.className = (img.className || '') + ' guild-initial';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = img.getAttribute('data-initial') || '?';
    img.replaceWith(span);
  }
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && img.hasAttribute('data-initial')) tile(img);
  }, true);
  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-initial]'), function (img) {
      if (img.complete && img.naturalWidth === 0) tile(img);
    });
    railScroll();
  });

  // 2) The side menu scrolls without the browser's wide scrollbar: a thin thumb appears while scrolling, and the edges fade
  //    where there is more to see.
  function railScroll() {
    var nav = document.querySelector('.sidebar nav');
    var rail = document.querySelector('.sidebar');
    if (!nav || !rail) return;
    var thumb = document.createElement('div');
    thumb.className = 'rail-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    rail.appendChild(thumb);
    var hideTimer = null;
    function update(show) {
      var max = nav.scrollHeight - nav.clientHeight;
      nav.classList.toggle('can-up', nav.scrollTop > 2);
      nav.classList.toggle('can-down', nav.scrollTop < max - 2);
      if (max <= 2) { thumb.style.opacity = '0'; return; }
      var ratio = nav.clientHeight / nav.scrollHeight;
      var h = Math.max(28, nav.clientHeight * ratio);
      var top = nav.offsetTop + (nav.scrollTop / max) * (nav.clientHeight - h);
      thumb.style.height = h + 'px';
      thumb.style.transform = 'translateY(' + top + 'px)';
      if (show) {
        thumb.style.opacity = '1';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { thumb.style.opacity = '0'; }, 900);
      }
    }
    nav.addEventListener('scroll', function () { update(true); }, { passive: true });
    window.addEventListener('resize', function () { update(false); });
    rail.addEventListener('transitionend', function () { update(false); });
    update(false);
  }
})();
