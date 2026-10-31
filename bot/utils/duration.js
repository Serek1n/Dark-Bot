// "30m", "1h30m", "2d", "1w", "10" (bare number = minutes), "2д", "3 часа", "15 мин" -> milliseconds.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// Units in English and Russian, short and long (as Lacuna's duration argument, plus months and Russian words).
function unitMs(unit) {
  const u = unit.toLowerCase();
  if (u === 'ms' || u.startsWith('msec') || u.startsWith('milli') || u === 'мс') return 1;
  if (u === 's' || u === 'с' || u.startsWith('sec') || u.startsWith('сек')) return 1000;
  if (u === 'mo' || u.startsWith('month') || u.startsWith('мес')) return MONTH;
  if (u === 'm' || u === 'м' || u.startsWith('min') || u.startsWith('мин')) return MINUTE;
  if (u === 'h' || u === 'ч' || u === 'hr' || u === 'hrs' || u.startsWith('hour') || u.startsWith('час')) return HOUR;
  if (u === 'd' || u === 'д' || u.startsWith('day') || u.startsWith('дн') || u.startsWith('ден')) return DAY;
  if (u === 'w' || u === 'н' || u.startsWith('week') || u.startsWith('нед')) return WEEK;
  if (u === 'y' || u === 'yr' || u === 'yrs' || u.startsWith('year') || u === 'г' || u.startsWith('год') || u === 'лет') return YEAR;
  return null;
}

/** Returns milliseconds, or null when the text is not a duration (or is zero). */
function parseDuration(input) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) > 0 ? Number(text) * MINUTE : null; // "30" means 30 minutes
  const re = /(\d+(?:[.,]\d+)?)\s*([a-zа-яё]+)/giu; // fractions too: 0.5h, 1,5д
  let total = 0;
  let rest = text;
  let m;
  while ((m = re.exec(text))) {
    const ms = unitMs(m[2]);
    if (!ms) return null;
    total += Number(m[1].replace(',', '.')) * ms;
    rest = rest.replace(m[0], '');
  }
  if (rest.replace(/[\s,]+/g, '') !== '') return null; // something that is not part of a duration
  total = Math.round(total);
  return total > 0 && Number.isSafeInteger(total) ? total : null;
}

/** 90_000_000 -> "1 д 1 ч". */
function formatDuration(ms) {
  let left = Math.max(0, Math.round(ms / 1000));
  if (!left) return '0 с';
  const parts = [];
  for (const [size, label] of [[604800, 'нед'], [86400, 'д'], [3600, 'ч'], [60, 'мин'], [1, 'с']]) {
    const n = Math.floor(left / size);
    if (n) { parts.push(`${n} ${label}`); left -= n * size; }
  }
  return parts.slice(0, 3).join(' ');
}

/** A term as one unit, for forms and shop lists: "10 д", "36 ч", "90 мин" (parseDuration reads it back). */
function formatTerm(ms) {
  const min = Math.max(1, Math.round(ms / MINUTE));
  if (min % 1440 === 0) return `${min / 1440} д`;
  if (min % 60 === 0) return `${min / 60} ч`;
  return `${min} мин`;
}

module.exports = { parseDuration, formatDuration, formatTerm, MINUTE, HOUR, DAY, WEEK, MAX_TIMEOUT: 28 * DAY };
