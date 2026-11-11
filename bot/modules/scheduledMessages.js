// Messages on a schedule (panel → «Сообщения» → «Расписание»): once at chosen dates, or again and again (every N hours, every day,
// on chosen weekdays, on a day of the month) at a local time of the chosen time zone. The bot's scheduler sleeps until the next one.
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { createScheduler } = require('../utils/scheduler');
const kit = require('./messageKit');

const MAX_PER_GUILD = 25;
const MAX_DATES = 20;
const DEFAULT_TZ = 'Europe/Moscow';
const KINDS = ['once', 'hours', 'daily', 'weekly', 'monthly'];

function validZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The wall clock of a time zone at a moment: { y, m, d, h, mi, wd } (m 1–12, wd 0 = Sunday). */
function wallClock(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}

/** The moment when the clock of `tz` shows that date and time (a time skipped by a clock change moves forward). */
function zonedToUtc(y, m, d, h, mi, tz) {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(guess, tz);
    const diff = want - Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
    if (!diff) break;
    guess += diff;
  }
  return guess;
}

/** "2026-12-31T18:00" → its parts, or null. */
function parseLocal(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { y, m: mo, d, h, mi };
}
const parseTime = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? { h: +m[1], mi: +m[2] } : null; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Checks a schedule from the form. Returns { rule, timezone } in a stable shape or throws KitError.
 * rule: { kind:'once', dates:[...] } | { kind:'hours', every, start } | { kind:'daily'|'weekly'|'monthly', time, days?, day? }
 */
function cleanRule(raw, timezone) {
  const tz = String(timezone || DEFAULT_TZ);
  if (!validZone(tz)) throw new kit.KitError('Неизвестный часовой пояс.');
  const r = raw && typeof raw === 'object' ? raw : {};
  if (!KINDS.includes(r.kind)) throw new kit.KitError('Выберите, как повторять сообщение.');
  if (r.kind === 'once') {
    const dates = [...new Set((Array.isArray(r.dates) ? r.dates : [r.dates]).map((d) => String(d || '').trim()).filter(Boolean))];
    if (!dates.length) throw new kit.KitError('Добавьте хотя бы одну дату.');
    if (dates.length > MAX_DATES) throw new kit.KitError(`Дат больше ${MAX_DATES}.`);
    if (dates.some((d) => !parseLocal(d))) throw new kit.KitError('Не понял одну из дат.');
    return { rule: { kind: 'once', dates: dates.sort() }, timezone: tz };
  }
  if (r.kind === 'hours') {
    const every = Math.trunc(Number(r.every));
    if (!(every >= 1 && every <= 720)) throw new kit.KitError('Интервал — от 1 до 720 часов.');
    if (!parseLocal(r.start)) throw new kit.KitError('Укажите, с какого момента считать интервал.');
    return { rule: { kind: 'hours', every, start: String(r.start).trim() }, timezone: tz };
  }
  if (!parseTime(r.time)) throw new kit.KitError('Укажите время в виде ЧЧ:ММ.');
  const time = String(r.time).trim().padStart(5, '0');
  if (r.kind === 'weekly') {
    const days = [...new Set((Array.isArray(r.days) ? r.days : [r.days]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (!days.length) throw new kit.KitError('Отметьте хотя бы один день недели.');
    return { rule: { kind: 'weekly', time, days }, timezone: tz };
  }
  if (r.kind === 'monthly') {
    const day = Math.trunc(Number(r.day));
    if (!(day >= 1 && day <= 31)) throw new kit.KitError('День месяца — от 1 до 31.');
    return { rule: { kind: 'monthly', time, day }, timezone: tz };
  }
  return { rule: { kind: 'daily', time }, timezone: tz };
}

/** The first moment strictly after `after` (ms) when the rule fires, or null when nothing is left (all dates are past). */
function nextRun(rule, tz, after = Date.now()) {
  if (!rule) return null;
  if (rule.kind === 'once') {
    const times = rule.dates.map(parseLocal).filter(Boolean).map((p) => zonedToUtc(p.y, p.m, p.d, p.h, p.mi, tz)).filter((t) => t > after).sort((a, b) => a - b);
    return times.length ? times[0] : null;
  }
  if (rule.kind === 'hours') {
    const p = parseLocal(rule.start); const start = zonedToUtc(p.y, p.m, p.d, p.h, p.mi, tz); const step = rule.every * 3600e3;
    if (start > after) return start;
    return start + (Math.floor((after - start) / step) + 1) * step;
  }
  const { h, mi } = parseTime(rule.time);
  const today = wallClock(after, tz);
  for (let i = 0; i < 400; i++) { // walk the local calendar day by day (a year and a bit covers every rule)
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const y = day.getUTCFullYear(); const m = day.getUTCMonth() + 1; const d = day.getUTCDate(); const wd = day.getUTCDay();
    if (rule.kind === 'weekly' && !rule.days.includes(wd)) continue;
    if (rule.kind === 'monthly' && d !== Math.min(rule.day, daysIn(y, m))) continue; // the 31st in a short month → its last day
    const t = zonedToUtc(y, m, d, h, mi, tz);
    if (t > after) return t;
  }
  return null;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** "каждый день в 18:00", "по пн, ср в 09:30" … for the list in the panel. */
function describeRule(rule) {
  if (!rule) return '';
  if (rule.kind === 'once') return rule.dates.length === 1 ? `один раз: ${rule.dates[0].replace('T', ' ')}` : `один раз в каждую из ${rule.dates.length} дат`;
  if (rule.kind === 'hours') return `каждые ${rule.every} ч`;
  if (rule.kind === 'weekly') return `по ${[1, 2, 3, 4, 5, 6, 0].filter((d) => rule.days.includes(d)).map((d) => WEEKDAYS[d]).join(', ')} в ${rule.time}`;
  if (rule.kind === 'monthly') return `каждый месяц ${rule.day}-го в ${rule.time}`;
  return `каждый день в ${rule.time}`;
}

const parse = (v, fallback) => { try { const x = JSON.parse(v); return x && typeof x === 'object' ? x : fallback; } catch { return fallback; } };

/** Sends one schedule entry now (also the "Отправить тест" button). Throws on failure. */
async function sendEntry(entry, { everyoneOk = true } = {}) {
  const { decrypt } = require('../../db/crypto');
  const target = parse(entry.target, {});
  const to = await kit.resolveTarget(entry.guildId, target, { webhookUrl: entry.webhookUrl ? decrypt(entry.webhookUrl) : null });
  const msg = kit.cleanMessage(parse(entry.data, {}));
  return kit.deliver(to, msg, { canEveryone: Boolean(entry.canEveryone) && everyoneOk, guildId: entry.guildId });
}

async function tick() {
  const { ScheduledMessage } = require('../../db');
  const now = Date.now();
  const due = await ScheduledMessage.findAll({ where: { enabled: true, nextRunAt: { [Op.lte]: new Date(now) } }, order: [['nextRunAt', 'ASC']], limit: 25 });
  for (const entry of due) {
    // the next time is saved BEFORE sending: a slow or failing send never posts the same message twice
    const next = nextRun(parse(entry.rule, null), entry.timezone || DEFAULT_TZ, Math.max(now, new Date(entry.nextRunAt).getTime()));
    await entry.update({ nextRunAt: next ? new Date(next) : null, enabled: Boolean(next), lastRunAt: new Date(now) });
    try {
      await sendEntry(entry);
      await entry.update({ runs: (entry.runs || 0) + 1, lastError: null });
    } catch (err) {
      const text = kit.errorText(err);
      logger.warn(`Scheduled message ${entry.id} (${entry.guildId}) failed: ${err?.response?.data?.message || err.message}`);
      await entry.update({ lastError: text.slice(0, 250), ...(kit.isGone(err) ? { enabled: false } : {}) }).catch(() => {});
    }
  }
}

let scheduler = null;
function startScheduledMessages() {
  const { ScheduledMessage } = require('../../db');
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'messages', nextDue: () => ScheduledMessage.min('nextRunAt', { where: { enabled: true } }), run: tick }).start();
}

module.exports = { startScheduledMessages, tick, sendEntry, cleanRule, nextRun, describeRule, zonedToUtc, wallClock, validZone, MAX_PER_GUILD, DEFAULT_TZ };
