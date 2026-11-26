const { Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
// Polls. By reactions (the default) or, when anonymous, by buttons: then the bot keeps the votes itself and nobody sees
// who chose what. A poll may allow one answer only (another reaction takes the first one back). When the time is up the
// bot counts the votes and posts the result in the server's look (GuildSettings.pollConfig, bot/utils/moduleConfig.js).
const { Op } = require('sequelize');
const { Poll } = require('../../db');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { createScheduler } = require('../utils/scheduler');
const { withLock } = require('../utils/lock');
const mc = require('../utils/moduleConfig');

const VOTE = 'poll:v:'; // + poll id + ':' + option index
const isPollButton = (i) => i.isButton?.() && typeof i.customId === 'string' && i.customId.startsWith(VOTE);
const NEVER = new Date('9999-01-01T00:00:00Z'); // a poll without a time limit, kept for its one-answer rule

const parseOptions = (p) => { try { const v = JSON.parse(p.options || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const parseVotes = (p) => { try { const v = JSON.parse(p.votes || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const colorNum = (hex, fallback) => (hex ? parseInt(hex.slice(1), 16) : fallback);

async function lookOf(guildId) {
  const { GuildSettings } = require('../../db');
  return mc.read(await GuildSettings.findByPk(guildId).catch(() => null), 'polls');
}

/** Results embed: votes per option with a bar (the bot's own reaction is not counted). */
function resultEmbed(poll, counts, look = mc.defaults('polls')) {
  const options = parseOptions(poll);
  const total = counts.reduce((a, b) => a + b, 0);
  const best = Math.max(0, ...counts);
  const lines = options.map((o, i) => {
    const share = total ? Math.round((counts[i] / total) * 100) : 0;
    const bar = look.barFull.repeat(Math.round(share / 10)) + look.barEmpty.repeat(10 - Math.round(share / 10));
    return `${best > 0 && counts[i] === best ? '🏆 ' : ''}${o.emoji} ${o.label}\n\`${bar}\` ${counts[i]} (${share}%)`;
  });
  const e = embeds.baseEmbed(colorNum(look.resultColor, embeds.COLORS.neutral)).setTitle(`📊 ${poll.question} — итоги`).setDescription(`${lines.join('\n\n')}\n\nВсего голосов: **${total}**`);
  if (look.footer) e.setFooter({ text: look.footer });
  return e;
}

/** The buttons of an anonymous poll. */
function voteButtons(poll) {
  const options = parseOptions(poll);
  const rows = [];
  for (let i = 0; i < options.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(options.slice(i, i + 5).map((o, k) => new ButtonBuilder().setCustomId(`${VOTE}${poll.id}:${i + k}`).setStyle(ButtonStyle.Secondary).setEmoji(o.emoji).setLabel(String(o.label).slice(0, 80)))));
  }
  return rows;
}

/** A press on an anonymous poll: the vote is kept (one answer replaces the other; a second press takes it back). */
async function handlePollButton(interaction) {
  const [, , id, idx] = interaction.customId.split(':');
  const n = Number(idx);
  return withLock(`poll:${id}`, async () => {
    const poll = await Poll.findByPk(Number(id));
    if (!poll || poll.ended) return interaction.reply({ embeds: [embeds.info('Голосование уже закончилось.')], flags: MessageFlags.Ephemeral });
    const options = parseOptions(poll);
    if (!(n >= 0 && n < options.length)) return interaction.reply({ embeds: [embeds.error('Такого варианта нет.')], flags: MessageFlags.Ephemeral });
    const votes = parseVotes(poll);
    const mine = new Set(votes[interaction.user.id] || []);
    let text;
    if (mine.has(n)) { mine.delete(n); text = `Голос за «${options[n].label}» отменён.`; } else {
      if (poll.multi === false) mine.clear();
      mine.add(n); text = `Голос за «${options[n].label}» учтён. Никто не увидит, кто как голосовал.`;
    }
    if (mine.size) votes[interaction.user.id] = [...mine]; else delete votes[interaction.user.id];
    poll.votes = JSON.stringify(votes); await poll.save();
    return interaction.reply({ embeds: [embeds.success(text)], flags: MessageFlags.Ephemeral });
  });
}

/** Another reaction of the same member on a one-answer poll takes the first one back. */
async function oneAnswer(reaction, user) {
  const poll = await Poll.findOne({ where: { messageId: reaction.message.id, ended: false, multi: false, anonymous: false } }).catch(() => null);
  if (!poll) return;
  const emojis = parseOptions(poll).map((o) => o.emoji);
  const mine = reaction.emoji?.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji?.name;
  if (!emojis.includes(mine)) return;
  // the reaction cache is off (bot/index.js): the other answers are taken back over REST, without reading the message
  const rest = reaction.client?.rest;
  if (!rest) return;
  for (const e of emojis) {
    if (e === mine) continue;
    const m = /^<a?:(\w+):(\d+)>$/.exec(e);
    const enc = encodeURIComponent(m ? `${m[1]}:${m[2]}` : e);
    await rest.delete(Routes.channelMessageUserReaction(reaction.message.channelId, reaction.message.id, enc, user.id)).catch(() => {});
  }
}

async function finish(client, poll) {
  const options = parseOptions(poll);
  const look = await lookOf(poll.guildId);
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(poll.messageId).catch(() => null) : null;
  let counts;
  if (poll.anonymous) {
    const votes = parseVotes(poll);
    counts = options.map((o, i) => Object.values(votes).filter((v) => Array.isArray(v) && v.includes(i)).length);
  } else {
    // The reaction cache is switched off (bot/index.js), so the counts come from the message itself over REST.
    // `count` includes the bot's own reaction (`me`), which is taken off.
    const raw = message && client.rest?.get ? await client.rest.get(Routes.channelMessage(poll.channelId, poll.messageId)).catch(() => null) : null;
    counts = options.map((o) => {
      const r = (raw?.reactions || []).find((x) => (x.emoji?.id ? String(o.emoji).includes(x.emoji.id) : x.emoji?.name === o.emoji));
      return r ? Math.max(0, Number(r.count || 0) - (r.me ? 1 : 0)) : 0;
    });
    if (message && !raw) {
      for (const [i, o] of options.entries()) {
        const reaction = message.reactions?.cache?.get(o.emoji);
        if (!reaction) continue;
        const users = await reaction.users.fetch().catch(() => null);
        counts[i] = users ? [...users.values()].filter((u) => !u.bot).length : Math.max(0, (reaction.count || 1) - 1);
      }
    }
  }
  const embed = resultEmbed(poll, counts, look);
  if (message) {
    await message.edit({ embeds: [embeds.baseEmbed(colorNum(look.color, embeds.COLORS.neutral)).setTitle(`📊 ${poll.question}`).setDescription('Голосование завершено.')], components: [], allowedMentions: { parse: [] } }).catch(() => {});
    await message.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => channel.send({ embeds: [embed] }).catch(() => {}));
  } else if (channel) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
  // a treasury vote: the bot carries out the winning option (bot/modules/econ/treasury.js)
  if (poll.action) await require('./econ/treasury').runVote(poll, counts).catch((err) => logger.error(`Treasury vote ${poll.id} failed:`, err.message));
  return counts;
}

async function tick(client) {
  const due = await Poll.findAll({ where: { ended: false, endsAt: { [Op.lte]: new Date() } }, limit: 20 });
  for (const poll of due) {
    await withLock(`poll:${poll.id}`, async () => {
      await poll.reload();
      if (poll.ended) return;
      poll.ended = true; // first, so a slow send can never post the results twice
      await poll.save();
      await finish(client, poll);
    }).catch((err) => logger.error(`Poll ${poll.id} failed:`, err.message));
  }
}

/** From the panel: the poll ends now (the scheduler posts the result within a moment). */
async function endNow(guildId, id) {
  const [n] = await Poll.update({ endsAt: new Date() }, { where: { id, guildId, ended: false } });
  if (n) require('../utils/scheduler').poke('polls');
  return n > 0;
}

let scheduler = null;
function startPollScheduler(client) {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'polls', nextDue: () => Poll.min('endsAt', { where: { ended: false } }), run: () => tick(client) }).start();
}

module.exports = { startPollScheduler, tick, finish, resultEmbed, voteButtons, handlePollButton, isPollButton, oneAnswer, endNow, unix, lookOf, NEVER, VOTE, parseVotes };
