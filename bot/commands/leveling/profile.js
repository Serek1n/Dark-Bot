const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateProfile, getOrCreateSettings, xpForLevel, getLeaderboard } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Уровень, опыт и баланс участника')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('Показать профиль участника')
        .addUserOption((opt) => opt.setName('пользователь').setDescription('Чей профиль показать'))
    )
    .addSubcommand((sub) => sub.setName('top').setDescription('Таблица лидеров сервера по опыту')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const target = interaction.options.getUser('пользователь') || interaction.user;
      const [profile, settings] = await Promise.all([
        getOrCreateProfile(interaction.guild.id, target.id),
        getOrCreateSettings(interaction.guild.id)
      ]);

      const needed = xpForLevel(profile.level);
      let xpIntoLevel = Number(profile.xp);
      for (let l = 0; l < profile.level; l++) xpIntoLevel -= xpForLevel(l);

      const embed = embeds
        .info(
          `Уровень: **${profile.level}**\n` +
            `Опыт: **${xpIntoLevel} / ${needed}** (всего ${profile.xp})\n` +
            `Баланс: **${profile.balance} ${settings.currencyName}**\n` +
            `Сообщений: **${profile.messageCount}**`
        )
        .setTitle(`Профиль ${target.username}`)
        .setThumbnail(target.displayAvatarURL());

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'top') {
      const top = await getLeaderboard(interaction.guild.id, 10);
      if (!top.length) return interaction.reply({ embeds: [embeds.info('Пока никто не заработал опыт.')] });
      const lines = top.map((p, i) => `**${i + 1}.** <@${p.userId}> — уровень ${p.level} (${p.xp} XP)`);
      return interaction.reply({ embeds: [embeds.info(lines.join('\n')).setTitle('🏆 Таблица лидеров')] });
    }
  }
};
