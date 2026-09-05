const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateProfile, xpForLevel } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Показать свой уровень и опыт')
    .addUserOption((opt) => opt.setName('пользователь').setDescription('Чей ранг показать')),
  async execute(interaction) {
    const target = interaction.options.getUser('пользователь') || interaction.user;
    const profile = await getOrCreateProfile(interaction.guild.id, target.id);

    const needed = xpForLevel(profile.level);
    let xpIntoLevel = Number(profile.xp);
    for (let l = 0; l < profile.level; l++) xpIntoLevel -= xpForLevel(l);

    const embed = embeds
      .info(`Уровень: **${profile.level}**\nОпыт: **${xpIntoLevel} / ${needed}**\nВсего опыта: **${profile.xp}**\nБаланс: **${profile.balance}**\nСообщений: **${profile.messageCount}**`)
      .setTitle(`Профиль ${target.username}`)
      .setThumbnail(target.displayAvatarURL());

    await interaction.reply({ embeds: [embed] });
  }
};
