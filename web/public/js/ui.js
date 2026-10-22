// Small touches for the panel: a letter instead of a broken server icon.
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
  });
})();
