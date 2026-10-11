const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { MemberProfile } = require('../../../db');
const { Op } = require('sequelize');
const { getOrCreateProfile, getOrCreateSettings, xpForLevel, getLeaderboard } = require('../../modules/leveling');
const { renderRankCard } = require('../../modules/rankCard');
const { buildTopPage } = require('../../modules/leaderboardPage');
const embeds = require('../../utils/embeds');
const { pendingSeconds, formatDuration } = require('../../modules/voiceTime');
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
          messageCount: Number(profile.messageCount),
          voiceSeconds: Number(profile.voiceSeconds || 0) + pendingSeconds(interaction.guild.id, target.id)
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
            { name: 'Сообщений', value: `${profile.messageCount}`, inline: true },
            { name: 'В голосовых', value: formatDuration(Number(profile.voiceSeconds || 0) + pendingSeconds(interaction.guild.id, target.id)), inline: true }
          )
          .setThumbnail(target.displayAvatarURL());
        return interaction.editReply({ embeds: [embed] });
      }
    }

    if (sub === 'top') {
      await interaction.deferReply();
      const payload = await buildTopPage(interaction.client, interaction.guild, 0, interaction.user.id);
      if (!payload) return interaction.editReply({ embeds: [embeds.info('Пока никто не заработал опыт.')] });
      return interaction.editReply(payload);
    }
  }
};
