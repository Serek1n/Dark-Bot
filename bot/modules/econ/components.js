// Buttons and windows of the economy: goal cards, deals, the /balance history.
const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ledger = require('./ledger');
const { GuildSettings } = require('../../../db');

const isEconomyComponent = (i) => typeof i.customId === 'string' && /^(egoal|edeal|ebal):/.test(i.customId);

async function history(interaction) {
  const userId = interaction.customId.split(':')[2];
  if (userId !== interaction.user.id) return interaction.reply({ embeds: [embeds.error('Это чужая история.')], flags: MessageFlags.Ephemeral });
  const settings = await GuildSettings.findOne({ where: { guildId: interaction.guildId } });
  const rows = await ledger.history(interaction.guildId, userId, { limit: 20 });
  const cur = (c) => (c === 'crystals' ? settings?.crystalName || 'кристаллы' : settings?.currencyName || 'монеты');
  const lines = rows.map((r) => {
    const when = r.daily ? `${r.day.slice(8, 10)}.${r.day.slice(5, 7)}` : `<t:${Math.floor(r.at.getTime() / 1000)}:d>`;
    const who = r.otherId ? ` · <@${r.otherId}>` : '';
    return `${when} · ${ledger.kindLabel(r.kind)}${who} · **${r.amount > 0 ? '+' : '−'}${Math.abs(r.amount)}** ${cur(r.currency)}`;
  });
  const embed = embeds.baseEmbed().setTitle('История операций').setDescription(lines.length ? lines.join('\n') : 'Пока пусто: здесь появятся награды, переводы и покупки.')
    .setFooter({ text: 'Доход за чат, голос и уровни показан одной строкой за день' });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function handleEconomyComponent(interaction) {
  const kind = interaction.customId.split(':')[0];
  if (kind === 'egoal') return require('./goals').handleGoalComponent(interaction);
  if (kind === 'edeal') return require('./deals').handleDealComponent(interaction);
  return history(interaction);
}

module.exports = { isEconomyComponent, handleEconomyComponent };
