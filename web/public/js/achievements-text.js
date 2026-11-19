// Достижения → Настройки: the preview of the «achievement unlocked» message (web/public/js/dcp.js) as the bot will send it —
// the own text (filled in by the server with a sample), the own embed or the standard frame, the card, the ping and the
// buttons with their labels — following every change on the page.
(function () {
  var box = document.querySelector('[data-ach-preview]');
  if (!box || !window.DCP) return;
  var form = box.closest('form');
  var field = document.getElementById('achievementsMessage');
  var url = box.getAttribute('data-url');
  var textOn = box.getAttribute('data-text-on') === '1';
  var frame = box.getAttribute('data-frame') === '1';
  var card = box.getAttribute('data-card');
  var filled = '';
  var q = function (s) { return form.querySelector(s); };
  function payload() {
    var S = window.DCP.sample; var C = window.DCP.ctx;
    var ping = q('[name="achPing"]') && q('[name="achPing"]').checked;
    var mention = C.user && C.user.id ? '<@' + C.user.id + '>' : '';
    var color = (q('[name="achColor"]') && q('[name="achColor"]').value === 'theme') ? box.getAttribute('data-color-theme') : box.getAttribute('data-color-rarity');
    var msg = { content: '', embeds: [], components: [] };
    var text = textOn ? filled : '';
    var own = q('[name="achievementsEmbedData_on"]') && q('[name="achievementsEmbedData_on"]').checked;
    var ef = function (k) { var el = form.querySelector('[data-embed-editor="achievementsEmbedData"] [data-ef="' + k + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
    if (textOn && own) {
      msg.content = text;
      msg.embeds.push({ title: S(ef('title')), description: S(ef('description')), color: ef('color') || color, image: card ? { url: 'attachment://achievement.png' } : (ef('image') ? { url: ef('image') } : undefined),
        thumbnail: ef('thumbnail') === 'avatar' ? { url: C.user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png' } : ef('thumbnail') === 'icon' ? { url: C.bot.avatar || 'https://cdn.discordapp.com/embed/avatars/1.png' } : undefined,
        footer: ef('footer') ? { text: S(ef('footer')) } : undefined, timestamp: ef('timestamp') ? new Date().toISOString() : undefined });
      if (ping && mention && msg.content.indexOf(mention) < 0) msg.content = (mention + ' ' + msg.content).trim();
    } else if (textOn && frame) {
      msg.content = ping ? mention : '';
      msg.embeds.push({ description: text || '\u200b', color: color, image: card ? { url: 'attachment://achievement.png' } : undefined });
    } else {
      msg.content = textOn ? (ping && mention && text.indexOf(mention) < 0 ? mention + ' ' + text : text) : (ping ? mention : '');
      if (card) msg.attachments = [{ url: card, filename: 'achievement.png' }];
    }
    var btns = q('[data-ach-buttons]');
    if (btns && btns.checked) {
      msg.components.push({ type: 1, components: [
        { type: 2, style: 1, label: (q('[name="achMine"]').value || '').trim() || 'Мои достижения', emoji: { name: '🏆' } },
        { type: 2, style: 2, label: (q('[name="achAll"]').value || '').trim() || 'Все достижения', emoji: { name: '📜' } }
      ] });
    }
    return msg;
  }
  var pv = window.DCP.mount(box, function () { return { payload: payload(), opts: { tokens: true, files: card ? { 'achievement.png': card } : {} } }; });
  var timer = null;
  function refill() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: field ? field.value : '' }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { filled = j.text || ''; pv.update(); })
        .catch(function () { /* the preview is a help, not a must */ });
    }, 300);
  }
  if (field) field.addEventListener('input', refill);
  form.addEventListener('input', function (e) { if (e.target !== field) pv.update(); });
  form.addEventListener('change', function () { pv.update(); });
  refill();
})();
