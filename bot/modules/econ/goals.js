// Общие цели: the admin sets a goal ("50 000 монет — неделя двойного опыта"), members chip in with the buttons under its card, the
// card shows the progress and the most generous. Reached → the bot does the action (an XP boost for everyone, a role for every
// contributor, or just the announcement). Time ran out first → everyone gets back what they put in.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { Op } = require('sequelize');
const { sequelize, inTransaction, EconomyGoal, EconomyGoalContrib, GuildSettings } = require('../../../db');
const embeds = require('../../utils/embeds');
const config = require('./config');
const ledger = require('./ledger');
const wallet = require('../wallet');
const events = require('./events');
const logger = require('../../utils/logger');

const PREFIX = 'egoal';
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const bar = (part, whole) => { const k = whole ? Math.min(10, Math.floor((part / whole) * 10)) : 0; return '█'.repeat(k) + '░'.repeat(10 - k); };
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

function actionText(goal, settings) {
  if (goal.action === 'boost') return `опыт ×${goal.boostMult} для всех на ${goal.boostHours} ч`;
  if (goal.action === 'role') return goal.roleId ? `роль <@&${goal.roleId}> каждому, кто вложился` : 'роль каждому, кто вложился';
  return goal.reward || 'объявление';
}

async function topOf(goalId, n = 3) {
  return EconomyGoalContrib.findAll({ where: { goalId, amount: { [Op.gt]: 0 } }, order: [['amount', 'DESC']], limit: n, raw: true });
}

/** The goal's card: progress, reward, deadline and the most generous; the buttons while it is open. */
async function card(goal, settings) {
  const top = await topOf(goal.id);
  const cur = settings.currencyName || 'монеты';
  const state = goal.status === 'open' ? `Собрать до <t:${unix(goal.endsAt)}:f> (<t:${unix(goal.endsAt)}:R>)`
    : goal.status === 'done' ? 'Цель собрана!' : goal.status === 'failed' ? 'Не успели — все вложения вернулись.' : 'Цель отменена — все вложения вернулись.';
  const lines = [
    `\`${bar(goal.raised, goal.target)}\` **${fmt(goal.raised)} / ${fmt(goal.target)}** ${cur}`,
    `Награда: ${actionText(goal, settings)}`,
    state
  ];
  if (top.length) lines.push('', 'Самые щедрые:', ...top.map((t, i) => `${i + 1}. ${t.userId ? `<@${t.userId}>` : 'Казна сервера'} — ${fmt(t.amount)}`));
  const color = goal.status === 'done' ? embeds.COLORS.success : goal.status === 'open' ? embeds.COLORS.neutral : embeds.COLORS.danger;
  const embed = embeds.baseEmbed(color).setTitle(`Общая цель: ${goal.title}`).setDescription(lines.join('\n'));
  const components = goal.status === 'open' ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:give:${goal.id}:100`).setLabel(`Вложить 100`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:give:${goal.id}:1000`).setLabel(`Вложить 1000`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:custom:${goal.id}`).setLabel('Своя сумма').setStyle(ButtonStyle.Secondary)
  )] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function refreshCard(goal, settings) {
  const c = require('../../../web/botBridge').getClient?.();
  if (!c || !goal.channelId || !goal.messageId) return;
  const ch = c.channels.cache.get(goal.channelId) || (await c.channels.fetch(goal.channelId).catch(() => null));
  const msg = ch ? await ch.messages.fetch(goal.messageId).catch(() => null) : null;
  if (msg) await msg.edit(await card(goal, settings)).catch(() => {});
}

/** Opens a goal and posts its card. Returns { goal } or { error }. */
async function create(settings, { title, target, days, action, boostMult, boostHours, roleId, reward }) {
  const guildId = settings.guildId;
  const max = config.params(settings, 'goals').maxOpen;
  if ((await EconomyGoal.count({ where: { guildId, status: 'open' } })) >= max) return { error: 'max' };
  if (!settings.economyEventsChannelId) return { error: 'channel' };
  const goal = await EconomyGoal.create({
    guildId, title: String(title).slice(0, 100), target, endsAt: new Date(Date.now() + days * 86400000),
    action: ['boost', 'role', 'announce'].includes(action) ? action : 'announce',
    boostMult: action === 'boost' ? boostMult : null, boostHours: action === 'boost' ? boostHours : null,
    roleId: action === 'role' ? roleId : null, reward: reward ? String(reward).slice(0, 200) : null,
    channelId: settings.economyEventsChannelId
  });
  const msg = await events.post(settings, await card(goal, settings));
  if (msg) await goal.update({ messageId: msg.id });
  require('../../utils/scheduler').poke('economy');
  return { goal, posted: !!msg };
}

/**
 * Puts money into an open goal. userId '' = from the treasury. Takes at most what is still missing.
 * Returns { ok, put, goal } or { ok: false, reason: 'closed' | 'funds' | 'treasury' }.
 */
async function contribute(guildId, goalId, userId, amount) {
  const res = await inTransaction(async (t) => {
    const goal = await EconomyGoal.findOne({ where: { id: goalId, guildId }, transaction: t });
    if (!goal || goal.status !== 'open' || new Date(goal.endsAt) <= new Date()) return { ok: false, reason: 'closed' };
    const put = Math.min(Math.trunc(amount), goal.target - goal.raised);
    if (put <= 0) return { ok: false, reason: 'closed' };
    if (userId) {
      if ((await wallet.spend(guildId, userId, 'balance', put, t)) === null) return { ok: false, reason: 'funds' };
      await ledger.record({ guildId, userId, amount: -put, kind: 'goal', note: `#${goal.id}` }, t);
    } else if (!(await ledger.treasuryTake(guildId, put, t))) return { ok: false, reason: 'treasury' };
    await sequelize.query(`INSERT INTO economy_goal_contribs (goalId, userId, amount) VALUES (?, ?, ?)
      ON CONFLICT (goalId, userId) DO UPDATE SET amount = economy_goal_contribs.amount + excluded.amount`, { replacements: [goal.id, userId || '', put], transaction: t });
    await sequelize.query('UPDATE economy_goals SET raised = raised + ?, updatedAt = ? WHERE id = ?', { replacements: [put, new Date(), goal.id], transaction: t });
    await goal.reload({ transaction: t });
    return { ok: true, put, goal };
  });
  if (res.ok) {
    const settings = await GuildSettings.findOne({ where: { guildId } });
    if (res.goal.raised >= res.goal.target) await complete(res.goal, settings);
    else await refreshCard(res.goal, settings);
  }
  return res;
}

/** The goal is reached: do its action and tell everyone. */
async function complete(goal, settings) {
  const [changed] = await EconomyGoal.update({ status: 'done' }, { where: { id: goal.id, status: 'open' } });
  if (!changed) return;
  goal.status = 'done';
  if (goal.action === 'boost' && goal.boostMult > 1 && goal.boostHours > 0) {
    const from = settings.xpBoostUntil && new Date(settings.xpBoostUntil) > new Date() ? new Date(settings.xpBoostUntil) : new Date();
    const until = new Date(from.getTime() + goal.boostHours * 3600000);
    await GuildSettings.update({ xpBoostUntil: until, xpBoostMult: Math.max(goal.boostMult, Number(settings.xpBoostMult) || 1) }, { where: { guildId: goal.guildId } });
    require('../../../web/botBridge').settingsChanged?.(goal.guildId);
  }
  let given = 0;
  if (goal.action === 'role' && goal.roleId) {
    const c = require('../../../web/botBridge').getClient?.();
    const guild = c?.guilds?.cache?.get(goal.guildId);
    const ids = (await EconomyGoalContrib.findAll({ where: { goalId: goal.id, amount: { [Op.gt]: 0 } }, raw: true })).map((r) => r.userId).filter(Boolean);
    for (const id of ids) {
      const m = guild ? await guild.members.fetch(id).catch(() => null) : null;
      if (m && (await m.roles.add(goal.roleId, `Общая цель «${goal.title}»`).then(() => true).catch(() => false))) given++;
    }
  }
  await refreshCard(goal, settings);
  const extra = goal.action === 'boost' ? `Опыт ×${goal.boostMult} для всех на ${goal.boostHours} ч — уже действует.` : goal.action === 'role' ? `Роль выдана вкладчикам: ${given}.` : (goal.reward || '');
  await events.post(settings, embeds.baseEmbed(embeds.COLORS.success).setTitle(`Цель собрана: ${goal.title}`).setDescription(`Сервер собрал ${fmt(goal.target)} ${settings.currencyName || 'монет'}. ${extra}`.trim()));
}

/** Gives everyone their money back (time ran out, or the admin cancelled). */
async function refundAll(goal, status) {
  const settings = await GuildSettings.findOne({ where: { guildId: goal.guildId } });
  const done = await inTransaction(async (t) => {
    const [changed] = await EconomyGoal.update({ status }, { where: { id: goal.id, status: 'open' }, transaction: t });
    if (!changed) return false;
    const rows = await EconomyGoalContrib.findAll({ where: { goalId: goal.id, amount: { [Op.gt]: 0 } }, transaction: t, raw: true });
    for (const r of rows) {
      if (r.userId) {
        await wallet.credit(goal.guildId, r.userId, 'balance', r.amount, t);
        await ledger.record({ guildId: goal.guildId, userId: r.userId, amount: r.amount, kind: 'goal_refund', note: `#${goal.id}` }, t);
      } else await ledger.treasuryAdd(goal.guildId, r.amount, t);
    }
    return true;
  });
  if (!done) return false;
  goal.status = status;
  await refreshCard(goal, settings);
  await events.post(settings, embeds.baseEmbed(embeds.COLORS.danger).setTitle(`${status === 'failed' ? 'Не успели' : 'Цель отменена'}: ${goal.title}`).setDescription(`Собрано ${fmt(goal.raised)} из ${fmt(goal.target)}. Все вложения вернулись.`));
  return true;
}

const cancel = (guildId, id) => EconomyGoal.findOne({ where: { id, guildId, status: 'open' } }).then((g) => (g ? refundAll(g, 'cancelled') : false));

/** Goals whose time is up and that were not reached. */
async function expireDue(now = new Date()) {
  const due = await EconomyGoal.findAll({ where: { status: 'open', endsAt: { [Op.lte]: now } }, limit: 50 });
  for (const g of due) await refundAll(g, 'failed').catch((err) => logger.error(`Goal ${g.id} expiry failed:`, err.message));
  return due.length;
}

// ---- buttons under the card ----
const isGoalComponent = (i) => typeof i.customId === 'string' && i.customId.startsWith(`${PREFIX}:`);
async function handleGoalComponent(interaction) {
  const [, action, id, amount] = interaction.customId.split(':');
  const settings = await GuildSettings.findOne({ where: { guildId: interaction.guildId } });
  const say = (text, ok = false) => interaction.reply({ embeds: [ok ? embeds.success(text) : embeds.error(text)], flags: MessageFlags.Ephemeral });
  if (!config.isOn(settings, 'goals')) return say('Общие цели на этом сервере выключены.');
  if (action === 'custom') {
    const modal = new ModalBuilder().setCustomId(`${PREFIX}:modal:${id}`).setTitle('Вложить в цель')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Сколько вложить').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)));
    return interaction.showModal(modal);
  }
  const sum = action === 'modal' ? Math.trunc(Number(String(interaction.fields.getTextInputValue('amount')).replace(/\s/g, ''))) : Math.trunc(Number(amount));
  if (!(sum > 0)) return say('Введите сумму больше нуля.');
  const r = await contribute(interaction.guildId, Number(id), interaction.user.id, sum);
  if (!r.ok) return say(r.reason === 'funds' ? 'Недостаточно средств.' : 'Эта цель уже закрыта.');
  const left = Math.max(0, r.goal.target - r.goal.raised);
  return say(`Вы вложили ${fmt(r.put)} ${settings.currencyName}. ${left ? `До цели осталось ${fmt(left)}.` : 'Цель собрана!'}`, true);
}

module.exports = { create, contribute, complete, cancel, expireDue, card, refreshCard, isGoalComponent, handleGoalComponent, actionText };
