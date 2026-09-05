const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getOrCreateSettings } = require('../../modules/leveling');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Настройка автомодерации')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Включить/выключить автомодерацию')
        .addBooleanOption((opt) => opt.setName('включено').setDescription('true/false').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('addword')
        .setDescription('Добавить запрещённое слово')
        .addStringOption((opt) => opt.setName('слово').setDescription('Слово или фраза').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('removeword')
        .setDescription('Убрать запрещённое слово')
        .addStringOption((opt) => opt.setName('слово').setDescription('Слово или фраза').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('listwords').setDescription('Показать список запрещённых слов'))
    .addSubcommand((sub) =>
      sub
        .setName('invites')
        .setDescription('Блокировать ссылки-приглашения на другие серверы')
        .addBooleanOption((opt) => opt.setName('включено').setDescription('true/false').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('antispam')
        .setDescription('Настроить анти-спам')
        .addBooleanOption((opt) => opt.setName('включено').setDescription('true/false').setRequired(true))
        .addIntegerOption((opt) => opt.setName('сообщений').setDescription('Макс. сообщений подряд').setMinValue(2).setMaxValue(30))
        .addIntegerOption((opt) => opt.setName('секунд').setDescription('За сколько секунд').setMinValue(2).setMaxValue(60))
    ),
  async execute(interaction) {
    const settings = await getOrCreateSettings(interaction.guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'toggle') {
      settings.automodEnabled = interaction.options.getBoolean('включено');
      await settings.save();
      return interaction.reply({ embeds: [embeds.success(`Автомодерация ${settings.automodEnabled ? 'включена' : 'выключена'}.`)] });
    }

    if (sub === 'addword' || sub === 'removeword') {
      const word = interaction.options.getString('слово').toLowerCase();
      let words = JSON.parse(settings.automodBannedWords || '[]');
      if (sub === 'addword') {
        if (!words.includes(word)) words.push(word);
      } else {
        words = words.filter((w) => w !== word);
      }
      settings.automodBannedWords = JSON.stringify(words);
      await settings.save();
      return interaction.reply({ embeds: [embeds.success(`Список обновлён (${words.length} слов).`)], ephemeral: true });
    }

    if (sub === 'listwords') {
      const words = JSON.parse(settings.automodBannedWords || '[]');
      return interaction.reply({
        embeds: [embeds.info(words.length ? words.map((w) => `\`${w}\``).join(', ') : 'Список пуст.')],
        ephemeral: true
      });
    }

    if (sub === 'invites') {
      settings.automodBlockInvites = interaction.options.getBoolean('включено');
      await settings.save();
      return interaction.reply({ embeds: [embeds.success(`Блокировка инвайтов ${settings.automodBlockInvites ? 'включена' : 'выключена'}.`)] });
    }

    if (sub === 'antispam') {
      settings.automodAntiSpam = interaction.options.getBoolean('включено');
      const msgs = interaction.options.getInteger('сообщений');
      const secs = interaction.options.getInteger('секунд');
      if (msgs) settings.automodSpamMessages = msgs;
      if (secs) settings.automodSpamSeconds = secs;
      await settings.save();
      return interaction.reply({
        embeds: [embeds.success(`Анти-спам ${settings.automodAntiSpam ? 'включен' : 'выключен'} (${settings.automodSpamMessages} сообщ. / ${settings.automodSpamSeconds} сек).`)]
      });
    }
  }
};
