// The panel's modules: one description of every part of the bot, read by the top menu ("Модули ▾"), the home page,
// the module switches and each module page's header. The on/off flags themselves live in bot/utils/features.js (the bot
// reads the same flags); this file adds what only the panel needs: the group, the icon, the pages, what depends on what,
// and the numbers shown on the home page.
//
// Adding a module = one entry here (+ its flag in features.js if it can be switched off) — the menu, the home page and the
// switch appear by themselves.
const { Op } = require('sequelize');
const { FEATURES } = require('../bot/utils/features');

const GROUPS = [
  ['community', 'Сообщество'],
  ['moderation', 'Модерация'],
  ['server', 'Сервер'],
  ['tools', 'Оповещения и инструменты'],
  ['look', 'Оформление']
];

// 20×20 line icons (stroke = currentColor)
const ICONS = {
  leveling: '<path d="M3 17V11M9.5 17V7M16 17V3"/>',
  economy: '<circle cx="10" cy="10" r="7"/><path d="M12.4 7.6C12 6.9 11.1 6.5 10 6.5C8.6 6.5 7.6 7.2 7.6 8.2C7.6 10.3 12.4 9.2 12.4 11.8C12.4 12.8 11.4 13.5 10 13.5C8.8 13.5 7.9 13.1 7.5 12.3M10 5V6.5M10 13.5V15"/>',
  shop: '<path d="M4 7H16L15.2 16H4.8L4 7Z"/><path d="M7.5 7V6C7.5 4.6 8.6 3.5 10 3.5C11.4 3.5 12.5 4.6 12.5 6V7"/>',
  giveaways: '<path d="M3.5 8H16.5V11H3.5Z"/><path d="M4.5 11V16.5H15.5V11M10 8V16.5"/><path d="M10 8C8.4 8 6.5 7.4 6.5 5.6C6.5 4.2 8.5 3.9 10 8ZM10 8C11.6 8 13.5 7.4 13.5 5.6C13.5 4.2 11.5 3.9 10 8Z"/>',
  polls: '<path d="M4 5H14M4 10H16M4 15H10"/>',
  fun: '<rect x="3.5" y="3.5" width="13" height="13" rx="3"/><path d="M7.5 7.5H7.51M12.5 12.5H12.51M10 10H10.01" stroke-width="2.4"/>',
  moderation: '<path d="M10 2.5L16.5 5V9.5C16.5 13.5 13.7 16.8 10 17.5C6.3 16.8 3.5 13.5 3.5 9.5V5L10 2.5Z"/>',
  automod: '<path d="M3 6L10 3L17 6V9C17 13 14 16.5 10 17.5C6 16.5 3 13 3 9V6Z"/><path d="M7.5 9.5L9 11L12.5 7.5"/>',
  report: '<path d="M5 17V3.5M5 4H15L13 7.5L15 11H5"/>',
  tickets: '<path d="M3 6.5V5H17V6.5C16 6.5 15.2 7.3 15.2 8.3S16 10 17 10V15H3V10C4 10 4.8 9.3 4.8 8.3S4 6.5 3 6.5Z"/>',
  logs: '<path d="M5 3H12L15.5 6.5V17H5V3Z"/><path d="M12 3V6.5H15.5M7.5 10H13M7.5 13H11"/>',
  welcome: '<path d="M5 17V4.5C5 3.7 5.7 3 6.5 3H12L15 6V17"/><path d="M5 17H15M12 17V3M12 10.2H12.3"/>',
  reactionRoles: '<circle cx="10" cy="10" r="7.2"/><path d="M7.3 12C7.9 13 8.9 13.6 10 13.6C11.1 13.6 12.1 13 12.7 12"/><path d="M7.5 8H7.51M12.5 8H12.51" stroke-width="2.2"/>',
  interactive: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><rect x="5" y="10" width="4.5" height="3" rx="1"/><rect x="10.5" y="10" width="4.5" height="3" rx="1"/><path d="M5 7H12"/>',
  tempVoice: '<rect x="7.5" y="2.5" width="5" height="8.5" rx="2.5"/><path d="M4.5 9.5C4.5 12.5 7 14.5 10 14.5C13 14.5 15.5 12.5 15.5 9.5M10 14.5V17.5M7 17.5H13"/>',
  voiceRoles: '<path d="M3 8V12M6.5 5.5V14.5M10 3V17M13.5 5.5V14.5M17 8V12"/>',
  customCommands: '<rect x="2.5" y="4" width="15" height="12" rx="1.5"/><path d="M5.5 8L8 10L5.5 12M10.5 12.5H14.5"/>',
  alerts: '<path d="M5 8C5 5.2 7.2 3 10 3C12.8 3 15 5.2 15 8C15 11.5 16.5 12.5 16.5 13.5H3.5C3.5 12.5 5 11.5 5 8Z"/><path d="M8.3 16C8.6 16.6 9.2 17 10 17C10.8 17 11.4 16.6 11.7 16"/>',
  webhooks: '<circle cx="6" cy="14" r="2.3"/><circle cx="14" cy="14" r="2.3"/><circle cx="10" cy="5.5" r="2.3"/><path d="M10 7.8L7.2 12M8.3 14H11.7M10 7.8L12.8 12"/>',
  reminders: '<circle cx="10" cy="10.5" r="6.5"/><path d="M10 7V10.5L12.5 12"/>',
  music: '<path d="M8 15V4.5L16 3V13.5"/><circle cx="6" cy="15" r="2"/><circle cx="14" cy="13.5" r="2"/>',
  home: '<rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/>',
  modules: '<path d="M3 6H11M15 6H17M3 14H5M9 14H17"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="14" r="2"/>',
  changelog: '<path d="M4 9.5H16V16.5H4Z"/><path d="M3 6.5H17V9.5H3Z"/><path d="M10 6.5V16.5"/>',
  events: '<path d="M3.5 8V12H6L12.5 15.5V4.5L6 8H3.5Z"/><path d="M15 7.5C15.8 8.2 16.3 9.1 16.3 10C16.3 10.9 15.8 11.8 15 12.5M6.5 12L7.5 16.5"/>',
  achievements: '<path d="M6.5 3.5H13.5V8C13.5 10 12 11.5 10 11.5C8 11.5 6.5 10 6.5 8V3.5Z"/><path d="M6.5 5H4V6.5C4 7.9 5 9 6.5 9.2M13.5 5H16V6.5C16 7.9 15 9 13.5 9.2M10 11.5V14.5M7 16.5H13M8 14.5H12V16.5H8Z"/>',
  listing: '<circle cx="7" cy="7.5" r="2.5"/><circle cx="13.5" cy="7.5" r="2.5"/><path d="M2.5 16C2.8 13.3 4.7 11.5 7 11.5C9.3 11.5 11.2 13.3 11.5 16M10.5 12.3C11.2 11.8 12.3 11.5 13.5 11.5C15.8 11.5 17.2 13.3 17.5 16"/>',
  appearance: '<path d="M10 2.8C5.9 2.8 2.8 5.8 2.8 9.6C2.8 13.6 6 17.2 9.6 17.2C10.7 17.2 11.2 16.5 11.2 15.7C11.2 14.6 10.3 14.3 10.3 13.4C10.3 12.6 10.9 12.1 11.8 12.1H13.6C15.6 12.1 17.2 10.6 17.2 8.6C17.2 5.4 14 2.8 10 2.8Z"/><circle cx="6.6" cy="9.4" r="1.1"/><circle cx="8.6" cy="6.1" r="1.1"/><circle cx="12.4" cy="6.1" r="1.1"/>',
  serverStats: '<path d="M3 17H17"/><path d="M5.5 14V9M10 14V5M14.5 14V11"/>',
  boosts: '<path d="M10.8 2.5L4.5 11H9.7L9.2 17.5L15.5 9H10.3L10.8 2.5Z"/>'
};

const icon = (key, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] || ICONS.modules}</svg>`;

const where = (guildId, extra) => ({ where: { guildId, ...(extra || {}) } });
const db = () => require('../db');
const n = (v) => Number(v || 0);

// pages: the panel pages that belong to the module (the first is where its name leads); [] = commands only.
// core: always on, no switch. depends: switching this one off is offered for these too (they lose their sense without it).
// stats: the numbers on the home page — [{ value, label }], the first one also goes into the module list.
// The tabs of the merged modules (old addresses keep working: see web/routes/dashboard/moderation.js and tempVoice.js).
const MOD_PAGES = ['moderation', 'moderation-punishments', 'moderation-warnings', 'moderation-auto', 'moderation-reports', 'moderation-appeals', 'moderation-log', 'moderation-settings'];
const LOOK_PAGES = ['appearance', 'appearance-levels', 'appearance-achievements', 'appearance-fun', 'appearance-voice'];
const VOICE_PAGES = ['temp-voice', 'temp-voice-rooms', 'temp-voice-panel', 'temp-voice-access', 'temp-voice-roles', 'temp-voice-auto', 'temp-voice-stats', 'temp-voice-settings'];
const LAYOUT = [
  { key: 'leveling', group: 'community', pages: ['leveling', 'channel-boosts'],
    stats: async (g) => {
      const { MemberProfile, LevelRole } = db();
      const [members, roles] = await Promise.all([MemberProfile.count(where(g)), LevelRole.count(where(g))]);
      return [{ value: members, label: 'участников в системе' }, { value: roles, label: 'ролей за уровни' }];
    } },
  { key: 'achievements', group: 'community', pages: ['achievements', 'achievements-catalog', 'achievements-edit', 'achievements-members', 'achievements-settings'],
    stats: async (g) => {
      const { MemberAchievement } = db();
      const [total, members] = await Promise.all([MemberAchievement.count(where(g)), MemberAchievement.count({ ...where(g), distinct: true, col: 'userId' })]);
      return [{ value: total, label: 'достижений открыто' }, { value: members, label: 'участников с достижениями' }];
    } },
  { key: 'economy', group: 'community', pages: ['economy', 'economy-bank', 'economy-treasury', 'economy-deals', 'economy-journal'],
    stats: async (g) => {
      const { MemberProfile } = db();
      const [coins, crystals, holders] = await Promise.all([MemberProfile.sum('balance', where(g)), MemberProfile.sum('crystals', where(g)),
        MemberProfile.count(where(g, { balance: { [Op.gt]: 0 } }))]);
      return [{ value: n(coins), label: 'монет в обороте' }, { value: n(crystals), label: 'кристаллов' }, { value: holders, label: 'участников с деньгами' }];
    } },
  { key: 'shop', group: 'community', pages: ['shop'], depends: ['economy'],
    stats: async (g) => {
      const { ShopItem, Purchase } = db();
      const [items, bought] = await Promise.all([ShopItem.count(where(g)), Purchase.count(where(g))]);
      return [{ value: items, label: 'товаров' }, { value: bought, label: 'покупок' }];
    } },
  { key: 'giveaways', group: 'community', pages: ['giveaways'],
    stats: async (g) => {
      const { Giveaway } = db();
      const [live, all] = await Promise.all([Giveaway.count(where(g, { ended: false })), Giveaway.count(where(g))]);
      return [{ value: live, label: 'идёт сейчас' }, { value: all, label: 'всего' }];
    } },
  { key: 'polls', group: 'community', pages: [],
    stats: async (g) => { const { Poll } = db(); return [{ value: await Poll.count(where(g, { ended: false })), label: 'идёт сейчас' }]; } },
  { key: 'fun', group: 'community', pages: [] },
  { key: 'moderation', group: 'moderation', pages: MOD_PAGES,
    stats: async (g) => {
      const { Warning, ModLog, Report } = db();
      const [warns, actions, reports] = await Promise.all([Warning.count({ where: { guildId: g, revokedAt: null } }), ModLog.count(where(g)), Report.count(where(g, { status: 'open' }))]);
      return [{ value: warns, label: 'предупреждений' }, { value: actions, label: 'действий модераторов' }, { value: reports, label: 'новых жалоб' }];
    } },
  { key: 'automod', group: 'moderation', pages: ['automod'] },
  // part of «Наказания»: its own switch lives on the «Жалобы» tab, no card of its own in the list of modules
  { key: 'report', group: 'moderation', parent: 'moderation', pages: ['moderation-reports'] },
  { key: 'tickets', group: 'moderation', pages: [],
    stats: async (g) => { const { Ticket } = db(); return [{ value: await Ticket.count(where(g, { status: 'open' })), label: 'открытых обращений' }]; } },
  { key: 'logs', group: 'moderation', pages: ['logs'] },
  { key: 'welcome', group: 'server', pages: ['welcome', 'welcome-rejoin'] },
  { key: 'serverStats', group: 'server', pages: ['server-stats', 'server-stats-channels'],
    stats: async (g) => {
      const ss = require('../bot/modules/serverStats');
      const week = await ss.history(g, 7);
      const { GuildSettings } = db();
      const counters = ss.read(await GuildSettings.findOne(where(g))).counters.length;
      return [{ value: week.reduce((s, d) => s + d.messages, 0), label: 'сообщений за неделю' }, { value: counters, label: 'счётчиков в каналах' }];
    } },
  { key: 'reactionRoles', group: 'server', pages: ['reaction-roles'],
    stats: async (g) => { const { ReactionRole } = db(); return [{ value: await ReactionRole.count(where(g)), label: 'ролей по реакциям' }]; } },
  { key: 'interactive', group: 'server', pages: ['interactive'],
    stats: async (g) => { const { InteractiveMessage } = db(); return [{ value: await InteractiveMessage.count(where(g)), label: 'сообщений с кнопками' }]; } },
  { key: 'tempVoice', group: 'server', pages: VOICE_PAGES,
    stats: async (g) => { const { TempVoiceChannel } = db(); return [{ value: await TempVoiceChannel.count(where(g)), label: 'комнат сейчас' }]; } },
  // part of «Временные голосовые»: works in any voice channel, temporary or not; its switch is on the «Голосовые роли» tab
  { key: 'voiceRoles', group: 'server', parent: 'tempVoice', pages: ['temp-voice-roles'] },
  { key: 'customCommands', group: 'server', pages: ['custom-commands'],
    stats: async (g) => { const { CustomCommand } = db(); return [{ value: await CustomCommand.count(where(g)), label: 'команд' }]; } },
  { key: 'alerts', group: 'tools', pages: ['alerts'],
    stats: async (g) => { const { Alert } = db(); return [{ value: await Alert.count(where(g)), label: 'подписок' }]; } },
  { key: 'events', group: 'tools', pages: ['events'],
    stats: async (g) => {
      const { GuildSettings } = db();
      const s = await GuildSettings.findOne(where(g));
      const be = require('../bot/modules/botEvents');
      const r = be.read(s);
      return [{ value: be.TYPES.filter((t) => r.types[t.key].on).length, label: 'событий включено' }];
    } },
  { key: 'webhooks', group: 'tools', pages: ['webhooks'] },
  // the server's card in the public catalog «Сообщества DARK» (no switch: not listing it is the off state)
  { key: 'listing', group: 'tools', title: 'Сообщество в каталоге', desc: 'Карточка сервера в публичном каталоге «Сообщества DARK»: описание, категории, голоса, статистика, продвижение', pages: ['community'],
    stats: async (g) => { const { Community } = db(); const c = await Community.findOne(where(g)); return [{ value: c ? c.votes : 0, label: c ? 'голосов в каталоге' : 'не в каталоге' }]; } },
  { key: 'reminders', group: 'tools', pages: [],
    stats: async (g) => { const { Reminder } = db(); return [{ value: await Reminder.count(where(g)), label: 'напоминаний ждут' }]; } },
  // «Оформление»: the theme and the look of the bot's messages (bot/modules/appearance.js); no switch: the defaults are the look
  { key: 'appearance', group: 'look', title: 'Оформление', desc: 'Тема бота, картинки-карточки и тексты: новый уровень, профиль, топ, достижения, мини-игры, панель комнаты', pages: LOOK_PAGES,
    stats: async (g) => {
      const { GuildSettings } = db();
      const ap = require('../bot/modules/appearance');
      const look = ap.read(await GuildSettings.findOne(where(g)));
      return [{ value: (ap.THEMES[look.theme] || ap.THEMES.dark).title, label: 'тема' }, { value: ap.TARGETS.filter((t) => look.targets[t.key].card).length, label: 'с картинкой' }];
    } },
  { key: 'music', group: 'tools', pages: ['music'],
    stats: async () => { const { Playlist } = db(); return [{ value: await Playlist.count(), label: 'плейлистов у участников' }]; } }
];

const MODULES = LAYOUT.map((m) => {
  const f = FEATURES.find((x) => x.key === m.key);
  return {
    key: m.key,
    group: m.group,
    title: m.title || f?.title || m.key,
    desc: m.desc || f?.desc || '',
    field: f?.field || null, // null: always on
    commands: f?.commands || [],
    pages: m.pages,
    page: m.pages[0] || null,
    depends: m.depends || [],
    core: Boolean(m.core),
    parent: m.parent || null, // a section of another module (kept as its own switch, not listed on its own)
    stats: m.stats || null
  };
});
const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

// Pages that are not a module's: what to show in their header instead.
const PAGE_TITLES = { overview: 'Главная', features: 'Модули', settings: 'Общие настройки', changelog: 'Обновления' };
// The tabs of a module with several pages (its header shows them; the search finds each).
const PAGE_LABELS = { leveling: 'Настройки', 'channel-boosts': 'Множители', welcome: 'Сообщения', 'welcome-rejoin': 'Автороль и возврат',
  moderation: 'Обзор', 'moderation-punishments': 'Наказания', 'moderation-warnings': 'Предупреждения', 'moderation-auto': 'Автонаказания',
  'moderation-reports': 'Жалобы', 'moderation-appeals': 'Апелляции', 'moderation-log': 'Журнал', 'moderation-settings': 'Настройки',
  'temp-voice': 'Обзор', 'temp-voice-rooms': 'Создание комнат', 'temp-voice-panel': 'Панель управления', 'temp-voice-access': 'Права доступа',
  'temp-voice-roles': 'Голосовые роли', 'temp-voice-auto': 'Автоматизация', 'temp-voice-stats': 'Статистика', 'temp-voice-settings': 'Настройки',
  achievements: 'Обзор', 'achievements-catalog': 'Каталог', 'achievements-edit': 'Создать', 'achievements-members': 'Участники', 'achievements-settings': 'Настройки',
  appearance: 'Тема', 'appearance-levels': 'Уровни', 'appearance-achievements': 'Достижения', 'appearance-fun': 'Мини-игры', 'appearance-voice': 'Голосовые комнаты',
  'server-stats': 'Обзор', 'server-stats-channels': 'Каналы-счётчики',
  economy: 'Настройки', 'economy-bank': 'Центробанк', 'economy-treasury': 'Казна и цели', 'economy-deals': 'Сделки и коды', 'economy-journal': 'Журнал' };
// A page shown only while one of these economy sections is on (bot/modules/econ/config.js).
const PAGE_NEEDS = { 'economy-bank': ['bank', 'seasons'], 'economy-treasury': ['treasury', 'goals'], 'economy-deals': ['deals', 'gifts'] };
// Tabs whose pages are not built yet in this version (they appear as soon as their stage ships).
const PAGE_LATER = new Set([]);
const pageVisible = (page, settings) => !PAGE_LATER.has(page) && (!PAGE_NEEDS[page] || PAGE_NEEDS[page].some((k) => require('../bot/modules/econ/config').isOn(settings, k)));

/** The module a page belongs to (the main one, not a section), or null. */
const moduleOfPage = (page) => MODULES.find((m) => !m.parent && m.pages.includes(page)) || MODULES.find((m) => m.pages.includes(page)) || null;
/** Every module that has this page, the main one first (moderation-reports: «Наказания» and its section «Жалобы»). */
const modulesOfPage = (page) => {
  const own = MODULES.filter((m) => m.pages.includes(page));
  const main = own.find((m) => !m.parent) || (own[0]?.parent ? BY_KEY.get(own[0].parent) : null);
  return main ? [main, ...own.filter((m) => m !== main)] : own;
};

const isOn = (settings, m) => (m.field ? Boolean(settings && settings[m.field]) : true);

/** The menu's view of the modules for one server: groups with their modules and on/off. */
function moduleState(settings) {
  const list = MODULES.map((m) => ({ key: m.key, title: m.title, desc: m.desc, group: m.group, page: m.page, pages: m.pages, core: m.core,
    switchable: Boolean(m.field), on: isOn(settings, m), depends: m.depends, commands: m.commands, parent: m.parent }));
  // sections of a merged module are found in `list` but not shown or counted on their own
  const top = list.filter((m) => !m.parent);
  for (const m of top) m.sections = list.filter((x) => x.parent === m.key);
  const groups = GROUPS.map(([id, title]) => ({ id, title, modules: top.filter((m) => m.group === id) }));
  const on = top.filter((m) => m.on).length;
  return { list, groups, on, total: top.length };
}

/** Modules that depend on this one (the ones offered to switch off with it). */
const dependentsOf = (key) => MODULES.filter((m) => m.depends.includes(key)).map((m) => m.key);

/**
 * The home page's numbers of every module that has them; a failing count shows as nothing, never breaks the page.
 * About twenty counts and sums over the server's tables: kept for 10 seconds, so admins opening the home page again and
 * again (or several at once) on a big server don't repeat them.
 */
const STATS_TTL = 10_000;
const statsCache = new Map(); // guildId -> { at, promise }
async function countModuleStats(guildId) {
  const out = {};
  await Promise.all(MODULES.filter((m) => m.stats).map(async (m) => {
    try { out[m.key] = await m.stats(guildId); } catch (_) { out[m.key] = null; }
  }));
  return out;
}
function moduleStats(guildId) {
  const hit = statsCache.get(guildId);
  if (hit && Date.now() - hit.at < STATS_TTL) return hit.promise;
  const promise = countModuleStats(guildId);
  statsCache.set(guildId, { at: Date.now(), promise });
  if (statsCache.size > 200) statsCache.delete(statsCache.keys().next().value);
  return promise;
}
/** Forget the numbers of a server (after a change the admin made, so the home page shows it at once). */
const forgetStats = (guildId) => statsCache.delete(guildId);

module.exports = { GROUPS, MODULES, BY_KEY, ICONS, icon, PAGE_TITLES, PAGE_LABELS, PAGE_NEEDS, pageVisible, moduleOfPage, modulesOfPage, moduleState, dependentsOf, moduleStats, forgetStats, isOn };

// Templates read the modules as `M` (app.locals.M); a template rendered on its own (tests, error pages) finds them here.
global.__darkModules = module.exports;
