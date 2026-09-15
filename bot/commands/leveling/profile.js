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
      // Sequential, not Promise.all: SQLite locks the whole file for writes, and
      // running two potential first-time inserts concurrently can race into a
      // SQLITE_BUSY error. These are both fast local queries, so there's no real
      // cost to awaiting them one at a time.
      const profile = await getOrCreateProfile(interaction.guild.id, target.id);
      const settings = await getOrCreateSettings(interaction.guild.id);

      const needed = xpForLevel(profile.level);
      let xpIntoLevel = Number(profile.xp);
      for (let l = 0; l < profile.level; l++) xpIntoLevel -= xpForLevel(l);

      // "# N" renders as a large heading in Discord's embed markdown — the closest
      // thing to a big hero stat that the platform actually supports.
      const embed = embeds
        .baseEmbed()
        .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
        .setDescription(
          `# ${profile.level}\nУровень\n\n` +
            `\`${embeds.progressBar(xpIntoLevel, needed)}\`  ${xpIntoLevel}/${needed} XP`
        )
        .addFields(
          { name: 'Баланс', value: `${profile.balance} ${settings.currencyName}`, inline: true },
          { name: 'Сообщений', value: `${profile.messageCount}`, inline: true }
        )
        .setThumbnail(target.displayAvatarURL());

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'top') {
      const top = await getLeaderboard(interaction.guild.id, 10);
      if (!top.length) return interaction.reply({ embeds: [embeds.info('Пока никто не заработал опыт.')] });

      const medals = ['🥇', '🥈', '🥉'];
      const lines = top.map((p, i) => `${medals[i] || `**${i + 1}.**`}  <@${p.userId}>  —  уровень ${p.level} · ${p.xp} XP`);

      const embed = embeds.baseEmbed().setTitle('Таблица лидеров').setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }
  }
};
