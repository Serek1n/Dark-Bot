// Small charts for the panel, drawn on the server (no chart library, nothing for the CSP to allow). The marks are an SVG
// that stretches to the card's width; the axis labels are HTML on top, so they keep their size on a phone. Every column
// has a hover area with a tooltip (the SVG <title>), and each chart has a table with the same numbers under «Таблица».
// Colours come from the panel's tokens, so the light and the dark theme both work.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// the words of the charts (each a string of its own, so the English panel translates them)
const L = { table: 'Таблица', day: 'День', came: 'пришли', left: 'ушли', cameKey: 'Пришли', leftKey: 'Ушли', empty: 'Данные появятся через минуту после включения модуля.' };
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU');

/** A round top for the axis: 0, 1, 2, 5, 10, 20, 50… times a power of ten, at least `v`. */
function niceMax(v) {
  if (!(v > 0)) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
const dayLabel = (day) => { const [, m, d] = day.split('-'); return `${Number(d)}.${m}`; };

const W = 600; const H = 180; // the marks' own space (stretched to the card)

function frame({ id, title, sub, legend = [], svg, yTop, yBottom = '0', labels, table }) {
  return `<figure class="sc" aria-labelledby="${id}-t">
  <figcaption class="sc-head"><span id="${id}-t" class="sc-title">${esc(title)}</span>${sub ? `<span class="sc-sub">${esc(sub)}</span>` : ''}
    ${legend.length ? `<span class="sc-legend">${legend.map(([cls, text]) => `<span class="sc-key"><i class="${cls}"></i>${esc(text)}</span>`).join('')}</span>` : ''}</figcaption>
  <div class="sc-plot">
    <span class="sc-y sc-y-top">${esc(yTop)}</span><span class="sc-y sc-y-mid" aria-hidden="true"></span><span class="sc-y sc-y-bottom">${esc(yBottom)}</span>
    ${svg}
  </div>
  <div class="sc-x" aria-hidden="true">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
  <details class="sc-table"><summary>${L.table}</summary>${table}</details>
</figure>`;
}

const xLabels = (days) => (days.length <= 1 ? days.map((d) => dayLabel(d.day)) : [days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]].map((d) => dayLabel(d.day)));
const tableOf = (days, cols) => `<table class="data-table"><thead><tr><th>${L.day}</th>${cols.map(([h]) => `<th class="num">${esc(h)}</th>`).join('')}</tr></thead><tbody>${
  days.slice().reverse().map((d) => `<tr><td>${dayLabel(d.day)}</td>${cols.map(([, f]) => `<td class="num">${esc(f(d))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** Columns of one value per day. */
function bars({ id, title, sub, days, value, unit = '', cls = 'sc-bar' }) {
  const vals = days.map(value);
  const top = niceMax(Math.max(...vals, 0));
  const slot = W / days.length; const bw = Math.max(2, Math.min(28, slot - 2));
  const marks = days.map((d, i) => {
    const v = vals[i]; const h = (v / top) * H; const x = i * slot + (slot - bw) / 2;
    const bar = v > 0 ? `<path class="${cls}" d="${roundTop(x, H - h, bw, h)}"/>` : '';
    return `<g>${bar}<rect class="sc-hit" x="${i * slot}" y="0" width="${slot}" height="${H}"><title>${dayLabel(d.day)}: ${fmt(v)}${unit}</title></rect></g>`;
  }).join('');
  const svg = `<svg class="sc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><line class="sc-grid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><line class="sc-base" x1="0" x2="${W}" y1="${H}" y2="${H}"/>${marks}</svg>`;
  return frame({ id, title, sub, svg, yTop: fmt(top), labels: xLabels(days), table: tableOf(days, [[title, (d) => fmt(value(d)) + unit]]) });
}

/** A bar whose top corners are rounded (4 px or less) and whose bottom stands on the axis. */
function roundTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function roundBottom(x, y, w, h) { // the same, hanging down from the axis
  const r = Math.min(4, w / 2, h);
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}

/** Who came (up from the middle line) and who left (down from it), per day. */
function inOut({ id, title, sub, days }) {
  const top = niceMax(Math.max(...days.map((d) => Math.max(d.joins, d.leaves)), 0));
  const mid = H / 2; const slot = W / days.length; const bw = Math.max(2, Math.min(28, slot - 2));
  const marks = days.map((d, i) => {
    const x = i * slot + (slot - bw) / 2;
    const up = (d.joins / top) * mid; const down = (d.leaves / top) * mid;
    return `<g>${d.joins ? `<path class="sc-bar" d="${roundTop(x, mid - up - 1, bw, up)}"/>` : ''}${d.leaves ? `<path class="sc-bar-muted" d="${roundBottom(x, mid + 1, bw, down)}"/>` : ''}<rect class="sc-hit" x="${i * slot}" y="0" width="${slot}" height="${H}"><title>${dayLabel(d.day)}: ${L.came} ${fmt(d.joins)}, ${L.left} ${fmt(d.leaves)}</title></rect></g>`;
  }).join('');
  const svg = `<svg class="sc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><line class="sc-base" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${marks}</svg>`;
  return frame({ id, title, sub, svg, yTop: `+${fmt(top)}`, yBottom: `−${fmt(top)}`, legend: [['sc-k-accent', L.cameKey], ['sc-k-muted', L.leftKey]], labels: xLabels(days),
    table: tableOf(days, [[L.cameKey, (d) => fmt(d.joins)], [L.leftKey, (d) => fmt(d.leaves)]]) });
}

/** One line of a value that is not a count per day (members): days without a count carry the last known one. */
function line({ id, title, sub, days, value }) {
  let last = null;
  const vals = days.map((d) => { const v = value(d); if (v) last = v; return v || last; });
  const known = vals.filter((v) => v !== null);
  if (!known.length) return frame({ id, title, sub, svg: `<div class="sc-empty">${L.empty}</div>`, yTop: '', yBottom: '', labels: xLabels(days), table: tableOf(days, [[title, () => '—']]) });
  let lo = Math.min(...known); let hi = Math.max(...known);
  if (hi === lo) { lo = Math.max(0, lo - 2); hi += 2; }
  const pad = (hi - lo) * 0.15; lo = Math.max(0, Math.floor(lo - pad)); hi = Math.ceil(hi + pad);
  const step = days.length > 1 ? W / (days.length - 1) : W;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const pts = vals.map((v, i) => (v === null ? null : [i * step, y(v)])).filter(Boolean);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${path}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z`;
  const slot = W / days.length;
  const hits = days.map((d, i) => `<rect class="sc-hit" x="${Math.max(0, i * step - slot / 2)}" y="0" width="${slot}" height="${H}"><title>${dayLabel(d.day)}: ${vals[i] === null ? '—' : fmt(vals[i])}</title></rect>`).join('');
  const svg = `<svg class="sc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><line class="sc-grid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><path class="sc-area" d="${area}"/><path class="sc-line" d="${path}"/>${hits}</svg>`;
  return frame({ id, title, sub, svg, yTop: fmt(hi), yBottom: fmt(lo), labels: xLabels(days), table: tableOf(days, [[title, (d) => (value(d) ? fmt(value(d)) : '—')]]) });
}

module.exports = { bars, inOut, line, niceMax };
