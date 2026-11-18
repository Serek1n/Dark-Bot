// /stats — the server's numbers for a week or a month: members and how that changed, who came and left, messages, time
// in voice, who is online and in voice right now. The same numbers as «Статистика сервера» in the panel.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ss = require('../../modules/serverStats');

const f = (n) => (n === null || n === undefined ? '—' : Math.round(Number(n)).toLocaleString('ru-RU'));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Статистика сервера: участники, сообщения, голос')
    .addIntegerOption((o) => o.setName('days').setDescription('За сколько дней (по умолчанию 7)').addChoices({ name: '7 дней', value: 7 }, { name: '30 дней', value: 30 }, { name: '90 дней', value: 90 })),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ embeds: [embeds.error('Эта команда работает только на сервере.')], flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const days = interaction.options.getInteger('days') || 7;
    const hist = await ss.history(guild.id, days);
    const sum = (k) => hist.reduce((s, d) => s + (d[k] || 0), 0);
    const first = hist.find((d) => d.members)?.members || null;
    const delta = first ? guild.memberCount - first : null;
    const online = await ss.onlineNow(guild).catch(() => null);
    const busiest = hist.reduce((b, d) => (d.messages > (b?.messages || 0) ? d : b), null);
    const dayName = (k) => { const [y, m, d] = k.split('-'); return new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
    const embed = embeds.baseEmbed().setTitle(`📊 ${guild.name}: статистика за ${days} дней`);
    if (guild.iconURL) embed.setThumbnail(guild.iconURL({ size: 128 }));
    embed.addFields(
      { name: 'Участники', value: `${f(guild.memberCount)}${delta !== null ? ` (${delta >= 0 ? '+' : '−'}${f(Math.abs(delta))})` : ''}`, inline: true },
      { name: 'В сети', value: f(online), inline: true },
      { name: 'В голосе сейчас', value: f(ss.inVoice(guild)), inline: true },
      { name: 'Пришли / ушли', value: `${f(sum('joins'))} / ${f(sum('leaves'))}`, inline: true },
      { name: 'Сообщений', value: f(sum('messages')), inline: true },
      { name: 'Часов в голосе', value: f(sum('voiceMinutes') / 60), inline: true }
    );
    if (busiest) embed.addFields({ name: 'Самый активный день', value: `${dayName(busiest.day)} — ${f(busiest.messages)} сообщений` });
    embed.setFooter({ text: 'Бот считает с момента включения модуля «Статистика сервера»' });
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
};
