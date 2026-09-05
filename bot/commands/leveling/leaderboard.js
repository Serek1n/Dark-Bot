const { SlashCommandBuilder } = require('discord.js');
const { getLeaderboard } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Топ участников сервера по опыту'),
  async execute(interaction) {
    const top = await getLeaderboard(interaction.guild.id, 10);
    if (!top.length) {
      return interaction.reply({ embeds: [embeds.info('Пока никто не заработал опыт.')] });
    }

    const lines = top.map((p, i) => `**${i + 1}.** <@${p.userId}> — уровень ${p.level} (${p.xp} XP)`);
    const embed = embeds.info(lines.join('\n')).setTitle('🏆 Таблица лидеров');
    await interaction.reply({ embeds: [embed] });
  }
};
