// «Мои данные»: what the bot keeps about a person, as a file he can download, and deleting it on his own — the Discord
// Developer Terms ask for an easy way to see and delete one's data. Plus his choice to get no optional private messages.
//
// What is deleted is his own activity: levels and coins on servers, achievements, reminders, playlists, votes, reviews and
// favourites in the catalog, his DARK Coins wallet. What stays is what other people rely on: moderation records about him
// (warnings, punishments, reports, appeals — the server's safety; its admins can remove them), deals and gifts with other
// members, purchases paid for with real money (Telegram orders), and things he set up for a server (they are the server's).
const { Op } = require('sequelize');

const db = () => require('../../db');

// Every table and the fields that may hold a person's id (an export shows every row where any of them is his id).
const FIELDS = {
  MemberProfile: ['userId'], MemberAchievement: ['userId'], MemberSnapshot: ['userId'], EconomyTx: ['userId'], EconomyEarn: ['userId'],
  EconomyBadge: ['userId'], EconomyGoalContrib: ['userId'], EconomyDeal: ['buyerId', 'sellerId'], EconomyHold: ['fromId', 'toId'],
  EconomyGift: ['creatorId', 'redeemedBy'], Purchase: ['userId'], TempRole: ['userId'], GiveawayEntry: ['userId'], Giveaway: ['hostId'],
  Reminder: ['userId'], Playlist: ['ownerId'], VoiceRoomPref: ['userId'], TempVoiceChannel: ['ownerId'], VoiceRoomLog: ['actorId', 'targetId'],
  StarboardEntry: ['authorId'], Ticket: ['userId', 'closedBy'], Warning: ['userId', 'moderatorId'], ModLog: ['userId', 'moderatorId'],
  Report: ['reporterId', 'targetId', 'handledBy'], Appeal: ['userId', 'moderatorId'], AppealNote: ['authorId'],
  Community: ['ownerId'], CommunityReview: ['userId'], CommunityReviewReport: ['userId'], CommunityVote: ['userId'],
  CommunityFavorite: ['userId'], CommunityReport: ['userId'], CommunityJoin: ['userId'], CommunityPromotion: ['buyerId'],
  DarkWallet: ['userId'], DarkCoinTx: ['userId', 'actorId'], DarkCoinPending: ['wallet', 'userId'], DarkDaily: ['userId'], DarkCoinOrder: ['userId'],
  CustomCommand: ['createdBy'], Achievement: ['createdBy'], SavedMessage: ['createdBy'], ScheduledMessage: ['createdBy'], InteractiveMessage: ['createdBy'],
  UserPref: ['userId']
};
// Deleted on request: rows where the field is his id.
const ERASE = {
  MemberProfile: 'userId', MemberAchievement: 'userId', MemberSnapshot: 'userId', EconomyTx: 'userId', EconomyEarn: 'userId', EconomyBadge: 'userId',
  EconomyGoalContrib: 'userId', Purchase: 'userId', GiveawayEntry: 'userId', Reminder: 'userId', VoiceRoomPref: 'userId',
  CommunityVote: 'userId', CommunityFavorite: 'userId', CommunityJoin: 'userId', CommunityReviewReport: 'userId', CommunityReport: 'userId',
  DarkDaily: 'userId', DarkCoinPending: 'userId'
};
// Kept, and why — shown on the page before deleting.
const KEPT = [
  'записи модерации о вас: предупреждения, наказания, жалобы и апелляции — они нужны серверу для безопасности, удалить их могут администраторы сервера',
  'сделки, подарки и удержания с другими участниками — от них зависят чужие балансы',
  'заказы DARK Coins, оплаченные в Telegram, и журнал операций кошелька — это учёт платежей и возвратов',
  'то, что вы настроили для сервера (свои команды, достижения, сообщения) — это данные сервера',
  'кошелёк DARK Coins, если его заморозила модерация платформы'
];
const LIMIT = 5000; // rows per table in one export

const where = (fields, id) => ({ [Op.or]: fields.map((f) => ({ [f]: id })) });

/** How many rows each table keeps about the person (only the tables that have any). */
async function summary(userId) {
  const id = String(userId); const out = {};
  for (const [name, fields] of Object.entries(FIELDS)) {
    const M = db()[name]; if (!M) continue;
    const n = await M.count({ where: where(fields.filter((f) => M.rawAttributes[f]), id) });
    if (n) out[name] = n;
  }
  return out;
}

/** Everything about the person, as plain rows by table (for the file «my-data.json»). */
async function exportData(userId) {
  const id = String(userId); const tables = {};
  for (const [name, fields] of Object.entries(FIELDS)) {
    const M = db()[name]; if (!M) continue;
    const rows = await M.findAll({ where: where(fields.filter((f) => M.rawAttributes[f]), id), limit: LIMIT, raw: true });
    if (!rows.length) continue;
    if (name === 'Playlist') {
      const T = db().PlaylistTrack;
      if (T) for (const p of rows) p.tracks = await T.findAll({ where: { playlistId: p.id }, limit: 500, raw: true });
    }
    tables[name] = rows;
  }
  return { about: 'Данные, которые бот Dark хранит о пользователе Discord', userId: id, generatedAt: new Date().toISOString(), tables };
}

/** Deletes the person's own data (see ERASE). Returns the number of deleted rows by table. */
async function erase(userId) {
  const id = String(userId); const done = {};
  const { inTransaction } = db();
  // reviews go through the catalog, so the community's rating stays right
  const reviews = await db().CommunityReview.findAll({ where: { userId: id }, attributes: ['communityId'], raw: true });
  for (const r of reviews) if (await require('./communities').deleteReview(r.communityId, id)) done.CommunityReview = (done.CommunityReview || 0) + 1;
  for (const [name, field] of Object.entries(ERASE)) {
    const M = db()[name]; if (!M || !M.rawAttributes[field]) continue;
    const n = await inTransaction((t) => M.destroy({ where: { [field]: id }, transaction: t }));
    if (n) done[name] = n;
  }
  const lists = await db().Playlist.findAll({ where: { ownerId: id }, attributes: ['id'], raw: true });
  if (lists.length) {
    await inTransaction(async (t) => {
      await db().PlaylistTrack.destroy({ where: { playlistId: lists.map((p) => p.id) }, transaction: t });
      done.Playlist = await db().Playlist.destroy({ where: { ownerId: id }, transaction: t });
    });
  }
  const coins = require('./darkCoins');
  if (!(await coins.isFrozen(id))) {
    const n = await inTransaction((t) => db().DarkWallet.destroy({ where: { userId: id }, transaction: t }));
    if (n) done.DarkWallet = n;
  }
  return done;
}

// ---- no optional private messages ----
const cache = new Map(); // userId → dmOff, for the hot paths (level-ups)
async function dmAllowed(userId) {
  const id = String(userId);
  if (cache.has(id)) return !cache.get(id);
  const row = await db().UserPref.findByPk(id).catch(() => null);
  cache.set(id, Boolean(row?.dmOff));
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return !row?.dmOff;
}
async function setDmOff(userId, off) {
  const id = String(userId);
  await db().UserPref.upsert({ userId: id, dmOff: Boolean(off) });
  cache.set(id, Boolean(off));
  return Boolean(off);
}

/** The button under an optional private message: «don't send me such messages». */
function dmOffRow() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dmpref:off').setStyle(ButtonStyle.Secondary).setEmoji('🔕').setLabel('Не присылать такие сообщения'));
}
/** Sends an optional private message, if the person has not turned them off; adds the button to turn them off. */
async function sendOptionalDm(user, payload) { // a User or a GuildMember: both can be written to
  if (!user?.send || !(await dmAllowed(user.user?.id || user.id))) return null;
  const p = typeof payload === 'string' ? { content: payload } : { ...payload };
  p.components = [...(p.components || []), dmOffRow()].slice(0, 5);
  return user.send(p).catch(() => null);
}

const isDmPrefButton = (i) => i.isButton?.() && /^dmpref:(off|on)$/.test(i.customId);
async function handleDmPrefButton(i) {
  const off = i.customId === 'dmpref:off';
  await setDmOff(i.user.id, off);
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
  const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(off ? 'dmpref:on' : 'dmpref:off').setStyle(ButtonStyle.Secondary).setLabel(off ? 'Снова присылать' : 'Не присылать'));
  if (base) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Мои данные').setURL(`${base}/me`));
  return i.reply({
    content: off ? 'Хорошо: больше не пришлю необязательных сообщений — повышения уровня, достижения, напоминания. Сообщения о ваших наказаниях и апелляциях продолжат приходить.' : 'Снова буду присылать такие сообщения.',
    components: [row], flags: i.guildId ? MessageFlags.Ephemeral : undefined
  });
}

module.exports = { FIELDS, ERASE, KEPT, summary, exportData, erase, dmAllowed, setDmOff, dmOffRow, sendOptionalDm, isDmPrefButton, handleDmPrefButton };
