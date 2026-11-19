// «Сообщество в каталоге»: pictures of the card. Files go to the bot (/community/upload), which keeps them; big ones are
// made smaller here first. The screenshots are drawn as tiles that can be removed; their addresses live in the «gallery»
// field of the form (one per line), the banner's in «bannerUrl».
(function () {
  var shots = document.querySelector('[data-cm-shots]');
  if (!shots) return;
  var base = location.pathname.replace(/\/community.*$/, '/community');
  var gallery = document.querySelector('[data-cm-gallery]');
  var banner = document.getElementById('cmBan');
  var bannerPv = document.querySelector('[data-cm-banner-pv]');
  var shotsMsg = document.querySelector('[data-cm-shots-msg]');
  var bannerMsg = document.querySelector('[data-cm-banner-msg]');
  var addTile = shots.querySelector('.cm-shot-add');
  var MAX = 6;
  var okSrc = function (u) { return /^\/communities\/media\/\d+\/[a-f0-9]{20}\.webp$/.test(u) || /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net|i\.imgur\.com)\/\S+$/.test(u); };
  var list = function () { return gallery.value.split(/\s+/).map(function (x) { return x.trim(); }).filter(Boolean); };
  function changed(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  function say(el, text, bad) { el.textContent = text; el.classList.toggle('cm-bad', Boolean(bad)); }

  function drawShots() {
    Array.prototype.slice.call(shots.querySelectorAll('.cm-shot')).forEach(function (n) { n.remove(); });
    var items = list();
    items.forEach(function (u, i) {
      var tile = document.createElement('div'); tile.className = 'cm-shot';
      if (okSrc(u)) { var img = document.createElement('img'); img.src = u; img.alt = 'Скриншот ' + (i + 1); img.loading = 'lazy'; img.addEventListener('error', function () { tile.classList.add('broken'); }); tile.appendChild(img); } else tile.classList.add('broken');
      var x = document.createElement('button'); x.type = 'button'; x.className = 'cm-shot-x'; x.setAttribute('aria-label', 'Убрать скриншот ' + (i + 1)); x.textContent = '×';
      x.addEventListener('click', function () { var l = list(); l.splice(i, 1); gallery.value = l.join('\n'); changed(gallery); drawShots(); });
      tile.appendChild(x);
      shots.insertBefore(tile, addTile);
    });
    addTile.hidden = items.length >= MAX;
    var cnt = document.querySelector('[data-cm-shots-count]'); if (cnt) cnt.textContent = items.length + ' из ' + MAX;
  }
  function drawBanner() {
    var u = banner.value.trim();
    bannerPv.style.backgroundImage = okSrc(u) ? 'url("' + u.replace(/["\\]/g, '') + '")' : '';
    bannerPv.classList.toggle('empty', !okSrc(u));
  }

  // a big picture is drawn smaller (at most 1920 px, WebP) before it is sent
  function shrink(file) {
    return new Promise(function (resolve) {
      if (file.size < 3 * 1024 * 1024 || !window.createImageBitmap || /gif/.test(file.type)) return resolve(file);
      createImageBitmap(file).then(function (bmp) {
        var k = Math.min(1, 1920 / bmp.width, 1920 / bmp.height);
        var c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        c.toBlob(function (b) { resolve(b || file); }, 'image/webp', 0.9);
      }).catch(function () { resolve(file); });
    });
  }
  function upload(file) {
    return shrink(file).then(function (body) {
      return fetch(base + '/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: body });
    }).then(function (r) {
      return r.json().catch(function () { return { error: r.status === 413 ? 'Картинка больше 8 МБ — уменьшите её.' : 'Не удалось загрузить картинку.' }; });
    }).then(function (j) { if (!j.url) throw new Error(j.error || 'Не удалось загрузить картинку.'); return j.url; });
  }

  document.addEventListener('change', function (e) {
    var input = e.target.closest && e.target.closest('[data-cm-upload]');
    if (!input || !input.files || !input.files.length) return;
    var kind = input.getAttribute('data-cm-upload');
    var files = Array.prototype.slice.call(input.files);
    input.value = '';
    if (kind === 'banner') {
      say(bannerMsg, 'Загружаю…');
      upload(files[0]).then(function (url) { banner.value = url; changed(banner); drawBanner(); say(bannerMsg, 'Баннер загружен — сохраните карточку.'); })
        .catch(function (err) { say(bannerMsg, err.message, true); });
      return;
    }
    var room = MAX - list().length;
    if (files.length > room) say(shotsMsg, 'Места хватит только на ' + room + ' — лишние не загружены.', true);
    files = files.slice(0, room);
    if (!files.length) return;
    say(shotsMsg, 'Загружаю ' + files.length + '…');
    var errors = [];
    files.reduce(function (p, f) {
      return p.then(function () { return upload(f).then(function (url) { var l = list(); l.push(url); gallery.value = l.join('\n'); changed(gallery); drawShots(); }).catch(function (err) { errors.push(f.name + ': ' + err.message); }); });
    }, Promise.resolve()).then(function () {
      say(shotsMsg, errors.length ? errors.join(' ') : 'Загружено — сохраните карточку.', errors.length > 0);
    });
  });
  gallery.addEventListener('input', drawShots);
  banner.addEventListener('input', drawBanner);
  drawShots(); drawBanner();
})();
