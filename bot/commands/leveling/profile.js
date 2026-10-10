const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { MemberProfile } = require('../../../db');
const { Op } = require('sequelize');
const { getOrCreateProfile, getOrCreateSettings, xpForLevel, getLeaderboard } = require('../../modules/leveling');
const { renderRankCard, renderLeaderboard } = require('../../modules/rankCard');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

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

      await interaction.deferReply();

      try {
        const rank = (await MemberProfile.count({ where: { guildId: interaction.guild.id, xp: { [Op.gt]: profile.xp } } })) + 1;
        const totalMembers = await MemberProfile.count({ where: { guildId: interaction.guild.id } });
        const png = await renderRankCard({
          rank,
          totalMembers,
          username: target.globalName || target.username,
          avatarURL: target.displayAvatarURL({ extension: 'png', size: 256 }),
          level: profile.level,
          xpIntoLevel,
          xpNeeded: needed,
          balance: Number(profile.balance),
          currencyName: settings.currencyName,
          messageCount: Number(profile.messageCount)
        });
        const attachment = new AttachmentBuilder(png, { name: 'rank.png' });
        return interaction.editReply({ files: [attachment] });
      } catch (err) {
        // Canvas/network hiccup — fall back to the plain-text embed instead of a dead command.
        logger.error('Failed to render rank card, falling back to embed:', err);
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
        return interaction.editReply({ embeds: [embed] });
      }
    }

    if (sub === 'top') {
      const top = await getLeaderboard(interaction.guild.id, 10);
      if (!top.length) return interaction.reply({ embeds: [embeds.info('Пока никто не заработал опыт.')] });

      await interaction.deferReply();
      try {
        const rows = await Promise.all(
          top.map(async (p, i) => {
            const user = await interaction.client.users.fetch(p.userId).catch(() => null);
            return {
              rank: i + 1,
              name: user ? user.globalName || user.username : `Участник ${String(p.userId).slice(-4)}`,
              avatarURL: user ? user.displayAvatarURL({ extension: 'png', size: 64 }) : null,
              level: p.level,
              xp: Number(p.xp)
            };
          })
        );
        const png = await renderLeaderboard({ title: interaction.guild.name, rows });
        return interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'top.png' })] });
      } catch (err) {
        logger.error('Failed to render leaderboard, falling back to embed:', err);
        const medals = ['🥇', '🥈', '🥉'];
        const lines = top.map((p, i) => `${medals[i] || `**${i + 1}.**`}  <@${p.userId}>  —  уровень ${p.level} · ${p.xp} XP`);
        return interaction.editReply({ embeds: [embeds.baseEmbed().setTitle('Таблица лидеров').setDescription(lines.join('\n'))] });
      }
    }
  }
};
