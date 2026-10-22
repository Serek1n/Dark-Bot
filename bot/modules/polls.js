// Timed polls: when the time is up the bot counts the reactions and posts the result.
const { Op } = require('sequelize');
const { Poll } = require('../../db');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { createScheduler } = require('../utils/scheduler');
const { withLock } = require('../utils/lock');

const parseOptions = (p) => { try { const v = JSON.parse(p.options || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

/** Results embed: votes per option (the bot's own reaction is not counted). */
function resultEmbed(poll, counts) {
  const options = parseOptions(poll);
  const total = counts.reduce((a, b) => a + b, 0);
  const best = Math.max(0, ...counts);
  const lines = options.map((o, i) => {
    const share = total ? Math.round((counts[i] / total) * 100) : 0;
    const bar = '█'.repeat(Math.round(share / 10)) + '░'.repeat(10 - Math.round(share / 10));
    return `${best > 0 && counts[i] === best ? '🏆 ' : ''}${o.emoji} ${o.label}\n\`${bar}\` ${counts[i]} (${share}%)`;
  });
  return embeds.baseEmbed(embeds.COLORS.neutral).setTitle(`📊 ${poll.question} — итоги`).setDescription(`${lines.join('\n\n')}\n\nВсего голосов: **${total}**`);
}

async function finish(client, poll) {
  const options = parseOptions(poll);
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(poll.messageId).catch(() => null) : null;
  const counts = options.map(() => 0);
  if (message) {
    for (const [i, o] of options.entries()) {
      const reaction = message.reactions?.cache?.get(o.emoji);
      if (!reaction) continue;
      const users = await reaction.users.fetch().catch(() => null);
      counts[i] = users ? [...users.values()].filter((u) => !u.bot).length : Math.max(0, (reaction.count || 1) - 1);
    }
  }
  const embed = resultEmbed(poll, counts);
  if (message) {
    await message.edit({ embeds: [embeds.baseEmbed(embeds.COLORS.neutral).setTitle(`📊 ${poll.question}`).setDescription('Голосование завершено.')], allowedMentions: { parse: [] } }).catch(() => {});
    await message.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => channel.send({ embeds: [embed] }).catch(() => {}));
  } else if (channel) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
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

let scheduler = null;
function startPollScheduler(client) {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'polls', nextDue: () => Poll.min('endsAt', { where: { ended: false } }), run: () => tick(client) }).start();
}

module.exports = { startPollScheduler, tick, resultEmbed, unix };
