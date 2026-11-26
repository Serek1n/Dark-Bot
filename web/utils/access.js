// Who may do what in the panel of one server (stage 4: access by roles).
//
// Full access, always: the owner of the server, members with «Administrator», the bot's own owners (BOT_OWNER_IDS), and
// — unless the server switched on the strict mode — members with «Manage Server». Anyone else gets the union of the
// scopes of his own entry and of the entries of his current roles (PanelRoleAccess). A member's roles are read from the
// bot (its cache, else Discord) and kept 45 seconds; a change of roles or leaving the server forgets them at once.
//
// Every address of the panel needs a scope: RULES below, read by ensureGuildAccess for every request (an address that
// no rule names is refused to anyone without full access). The same table goes to the page (js/ui.js), which locks the
// forms the viewer may not send.
const SNOW = /^\d{15,25}$/;

const SCOPES = [
  ['overview.view', 'Сводка сервера', 'Главная страница панели и обновления'],
  ['moderation.read', 'Модерация: просмотр', 'Наказания, предупреждения, журнал, автонаказания'],
  ['moderation.act', 'Модерация: действия', 'Снимать наказания и предупреждения, менять правила наказаний'],
  ['appeals.read', 'Апелляции: просмотр', 'Очередь апелляций и их история'],
  ['appeals.decide', 'Апелляции: решения', 'Одобрять, отклонять и комментировать апелляции, их настройки'],
  ['reports.decide', 'Жалобы', 'Разбирать жалобы участников'],
  ['tickets.manage', 'Тикеты', 'Обращения, их закрытие и настройки тикетов'],
  ['leveling.manage', 'Уровни и достижения', 'Опыт, роли за уровни, множители, достижения'],
  ['economy.manage', 'Экономика', 'Валюты, начисления, казна, сделки, журнал'],
  ['shop.manage', 'Магазин', 'Товары, покупки и настройки магазина'],
  ['messages.send', 'Сообщения', 'Конструктор сообщений, отправка от бота, расписание'],
  ['webhooks.manage', 'Вебхуки', 'Создавать и удалять вебхуки, отправлять через них'],
  ['giveaways.manage', 'Розыгрыши', 'Завершать и перевыбирать розыгрыши'],
  ['polls.manage', 'Голосования', 'Голосования и их правила'],
  ['tempvoice.manage', 'Голосовые комнаты', 'Временные голосовые и голосовые роли'],
  ['logs.view', 'Логи', 'Логи сервера и журнал панели'],
  ['settings.core', 'Настройки сервера', 'Модули, автомодерация, приветствие, оформление, базовые настройки'],
  ['access.manage', 'Права доступа', 'Выдавать права в панели другим (только из своих)']
];
const SCOPE_KEYS = SCOPES.map((s) => s[0]);
const SCOPE_TITLE = Object.fromEntries(SCOPES.map((s) => [s[0], s[1]]));

const PRESETS = [
  ['junior-mod', 'Младший модератор', ['overview.view', 'moderation.read', 'reports.decide']],
  ['senior-mod', 'Старший модератор', ['overview.view', 'moderation.read', 'moderation.act', 'reports.decide', 'appeals.read', 'appeals.decide', 'logs.view']],
  ['tickets', 'Саппорт тикетов', ['overview.view', 'tickets.manage', 'reports.decide']],
  ['events', 'Ивент-менеджер и контент', ['overview.view', 'giveaways.manage', 'polls.manage', 'messages.send', 'webhooks.manage']],
  ['economy', 'Менеджер экономики', ['overview.view', 'leveling.manage', 'economy.manage', 'shop.manage']],
  ['auditor', 'Аудитор (только чтение)', ['overview.view', 'moderation.read', 'appeals.read', 'logs.view']]
];

// [methods, path after /dashboard/:guildId, scopes — any one of them is enough]. The first rule that matches decides.
const R = (methods, re, scopes) => [methods, re, Array.isArray(scopes) ? scopes : [scopes]];
const ANY = 'GET|HEAD|POST|PATCH|PUT|DELETE'; const READ = 'GET|HEAD'; const WRITE = 'POST|PATCH|PUT|DELETE';
const RULES = [
  R(READ, /^\/?$/, 'overview.view'),
  R(READ, /^\/(changelog|preview-context|starboard)$/, 'overview.view'),
  R(WRITE, /^\/changelog\//, 'settings.core'),
  // access itself
  R(ANY, /^\/access(\/|$)/, 'access.manage'),
  // moderation
  R(READ, /^\/moderation-appeals(\/|$)/, ['appeals.read', 'appeals.decide']),
  R(WRITE, /^\/moderation-appeals\/\d+\/(decide|comment)$/, 'appeals.decide'),
  R(WRITE, /^\/moderation\/appeals$/, 'appeals.decide'),
  R(READ, /^\/moderation-reports$/, ['reports.decide', 'moderation.read']),
  R(WRITE, /^\/moderation-reports\/\d+\/ignore$/, 'reports.decide'),
  R(WRITE, /^\/moderation\/reports$/, 'reports.decide'),
  R(READ, /^\/moderation(-punishments|-warnings|-log|-auto|-settings)?$/, 'moderation.read'),
  R(WRITE, /^\/moderation(-punishments|-warnings|\/|$)/, 'moderation.act'),
  R(ANY, /^\/automod$/, 'settings.core'),
  R(READ, /^\/logs$/, 'logs.view'),
  R(WRITE, /^\/logs$/, 'settings.core'),
  // tickets
  R(ANY, /^\/tickets(-list)?(\/|$)/, 'tickets.manage'),
  // levels, achievements
  R(ANY, /^\/(leveling|leveling-rewards|leveling-notify|leaderboard|leveling-data|channel-boosts|level-roles)(\/|$)/, 'leveling.manage'),
  R(ANY, /^\/achievements(-catalog|-edit|-members|-settings)?(\/|$)/, 'leveling.manage'),
  // economy and the shop
  R(ANY, /^\/shop(\/|$)/, 'shop.manage'),
  R(ANY, /^\/economy(-bank|-treasury|-deals|-journal)?(\/|$)/, 'economy.manage'),
  // messages and webhooks
  R(READ, /^\/webhooks$/, ['messages.send', 'webhooks.manage']),
  R(WRITE, /^\/webhooks(\/|$)/, 'webhooks.manage'),
  R(ANY, /^\/messages(\/|$)/, 'messages.send'),
  // events of the community
  R(ANY, /^\/giveaways(\/|$)/, 'giveaways.manage'),
  R(ANY, /^\/polls(\/|$)/, 'polls.manage'),
  R(WRITE, /^\/config\/polls$/, 'polls.manage'),
  R(ANY, /^\/(temp-voice|temp-voice-rooms|temp-voice-panel|temp-voice-access|temp-voice-roles|temp-voice-auto|temp-voice-stats|temp-voice-settings|voice-roles)(\/|$)/, 'tempvoice.manage'),
  // «Где и для кого работает» of a module: the scope of that module
  R(WRITE, /^\/scope\/tickets$/, 'tickets.manage'),
  R(WRITE, /^\/scope\/polls$/, 'polls.manage'),
  R(WRITE, /^\/scope\/giveaways$/, 'giveaways.manage'),
  R(WRITE, /^\/scope\/(leveling)$/, 'leveling.manage'),
  R(WRITE, /^\/scope\/(economy)$/, 'economy.manage'),
  R(WRITE, /^\/scope\//, 'settings.core'),
  // the settings API: by the module of the section
  R(WRITE, /^\/api\/settings\/leveling\./, 'leveling.manage'),
  R(WRITE, /^\/api\/settings\/economy\./, 'economy.manage'),
  R(WRITE, /^\/api\/settings\/shop\./, 'shop.manage'),
  R(WRITE, /^\/api\/settings\/moderation\.reports/, 'reports.decide'),
  R(WRITE, /^\/api\/settings\/moderation\./, 'moderation.act'),
  R(WRITE, /^\/api\/settings\/tempVoice\./, 'tempvoice.manage'),
  R(WRITE, /^\/api\/settings\//, 'settings.core'),
  // everything else of the server's own setup
  R(ANY, /^\/(settings|features|modules|language|config|welcome|welcome-rejoin|reaction-roles|interactive|custom-commands|alerts|events|server-stats|server-stats-channels|community|appearance(-levels|-achievements|-fun|-voice)?|replacers|music|fun|reminders)(\/|$)/, 'settings.core')
];

/** The scopes that open this request (any one is enough), or null when no rule names it (refused unless full). */
function scopeFor(method, sub) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(sub || '').split('?')[0].replace(/\/+$/, '') || '';
  for (const [methods, re, scopes] of RULES) if (methods.split('|').includes(m) && re.test(p)) return scopes;
  return null;
}
/** The same table for the page (js/ui.js locks what the viewer may not send). */
const rulesForClient = () => RULES.map(([methods, re, scopes]) => [methods, re.source, scopes]);

const parseScopes = (v) => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a.filter((s) => SCOPE_KEYS.includes(s)) : []; } catch { return []; } };

// ---- a member's roles on a server, from the bot (cache, else Discord), kept 45 s ----
const TTL = 45_000;
const memberCache = new Map(); // `${guild}:${user}` → { at, member: { roles, owner, admin, manage, top } | null }
const ADMINISTRATOR = 1n << 3n; const MANAGE_GUILD = 1n << 5n;
async function memberInfo(guildId, userId) {
  const k = `${guildId}:${userId}`;
  const hit = memberCache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.member;
  let info = null;
  const g = require('../botBridge').getClient?.()?.guilds?.cache?.get(guildId);
  if (g) {
    const m = await g.members.fetch(userId).catch(() => null);
    if (m) info = { roles: [...m.roles.cache.keys()].filter((r) => r !== guildId), owner: g.ownerId === userId, admin: m.permissions.has('Administrator'), manage: m.permissions.has('ManageGuild'), top: m.roles.highest?.position ?? 0 };
  } else {
    try { // the panel without the bot's process: Discord over REST
      const api = require('../discordApi');
      const { data } = await api.botApi.get(`/guilds/${guildId}/members/${userId}`);
      const roles = await api.getGuildRoles(guildId).catch(() => []);
      const byId = new Map(roles.map((r) => [r.id, r]));
      let perms = 0n; for (const id of [guildId, ...data.roles]) { try { perms |= BigInt(byId.get(id)?.permissions || 0); } catch { /* none */ } }
      info = { roles: data.roles, owner: false, admin: Boolean(perms & ADMINISTRATOR), manage: Boolean(perms & MANAGE_GUILD), top: Math.max(0, ...data.roles.map((r) => byId.get(r)?.position || 0)) };
    } catch { info = null; }
  }
  memberCache.set(k, { at: Date.now(), member: info });
  if (memberCache.size > 5000) memberCache.delete(memberCache.keys().next().value);
  return info;
}
/** A change of roles or leaving the server: the next request reads the member afresh. */
function forget(guildId, userId) { memberCache.delete(`${guildId}:${userId}`); }
function forgetGuild(guildId) { for (const k of memberCache.keys()) if (k.startsWith(guildId + ':')) memberCache.delete(k); }

/** The scopes of the entries of this member and his roles. */
async function grantedScopes(guildId, userId, roles) {
  const { PanelRoleAccess } = require('../../db');
  const { Op } = require('sequelize');
  const rows = await PanelRoleAccess.findAll({ where: { guildId, [Op.or]: [{ targetType: 'user', targetId: userId }, { targetType: 'role', targetId: roles.length ? roles : ['-'] }] } });
  const set = new Set();
  for (const r of rows) parseScopes(r.scopes).forEach((s) => set.add(s));
  return set;
}

/**
 * What this person may do on this server: { full, scopes: Set, member, reason }.
 * guild: the entry of the user's own list of servers ({ owner, permissions }), when known.
 */
async function resolve(guildId, userId, { guild = null, settings = null } = {}) {
  const ownerIds = (process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ownerIds.includes(userId)) return { full: true, scopes: new Set(SCOPE_KEYS), reason: 'bot-owner' };
  let perms = 0n; try { perms = BigInt(guild?.permissions || 0); } catch { perms = 0n; }
  const strict = Boolean(settings?.panelStrict);
  if (guild?.owner || (perms & ADMINISTRATOR)) return { full: true, scopes: new Set(SCOPE_KEYS), reason: guild?.owner ? 'owner' : 'admin' };
  const member = await memberInfo(guildId, userId);
  if (member && (member.owner || member.admin)) return { full: true, scopes: new Set(SCOPE_KEYS), member, reason: member.owner ? 'owner' : 'admin' };
  if (!strict && ((perms & MANAGE_GUILD) || member?.manage)) return { full: true, scopes: new Set(SCOPE_KEYS), member, reason: 'manage' };
  if (!member) return { full: false, scopes: new Set(), member: null, reason: 'none' };
  const scopes = await grantedScopes(guildId, userId, member.roles);
  return { full: false, scopes, member, reason: scopes.size ? 'granted' : 'none' };
}

const allows = (access, scopes) => Boolean(access && (access.full || (scopes && scopes.some((s) => access.scopes.has(s)))));

/** Middleware for one route: the request needs one of these scopes (ensureGuildAccess must run first). */
const requireScope = (...scopes) => (req, res, next) => (allows(req.access, scopes.flat()) ? next() : forbidden(req, res, scopes.flat()));
function forbidden(req, res, scopes) {
  const names = (scopes || []).map((s) => `«${SCOPE_TITLE[s] || s}»`).join(' или ');
  const text = names ? `Нет права ${names} в панели этого сервера. Его выдают на странице «Права доступа».` : 'Этот раздел панели вам недоступен.';
  if (String(req.get?.('accept') || '').includes('application/json') || /\/api\//.test(req.originalUrl || '')) return res.status(403).json({ ok: false, error: text, missing: scopes || [] });
  return res.status(403).render('error', { message: text });
}

/**
 * May this person change an entry (escalation guard)? Full access may do anything. Someone with access.manage only:
 * gives no scope he lacks, never access.manage, and never to a role at or above his own highest role.
 * target: { type, id, position (a role's), scopes (new), old (the stored scopes) }.
 */
function mayEdit(access, target) {
  if (access.full) return { ok: true };
  if (!access.scopes.has('access.manage')) return { ok: false, why: 'Нет права «Права доступа».' };
  const all = [...(target.scopes || []), ...(target.old || [])];
  if (all.includes('access.manage')) return { ok: false, why: 'Право «Права доступа» выдают и снимают только владелец и администраторы сервера.' };
  const missing = (target.scopes || []).filter((s) => !access.scopes.has(s));
  if (missing.length) return { ok: false, why: `Нельзя выдать права, которых нет у вас: ${missing.map((s) => `«${SCOPE_TITLE[s]}»`).join(', ')}.` };
  const extra = (target.old || []).filter((s) => !access.scopes.has(s));
  if (extra.length) return { ok: false, why: 'В этой записи есть права, которых нет у вас: её меняют владелец и администраторы.' };
  if (target.type === 'role' && access.member && (target.position ?? 0) >= access.member.top) return { ok: false, why: 'Нельзя менять права роли, которая не ниже вашей самой высокой роли.' };
  if (target.type === 'user' && target.id === access.userId) return { ok: false, why: 'Свои права меняют владелец и администраторы.' };
  return { ok: true };
}

module.exports = { SCOPES, SCOPE_KEYS, SCOPE_TITLE, PRESETS, RULES, scopeFor, rulesForClient, parseScopes, resolve, allows, requireScope, forbidden, mayEdit, memberInfo, forget, forgetGuild, grantedScopes, SNOW };
