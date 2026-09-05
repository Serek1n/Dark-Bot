const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Список всех команд бота'),
  async execute(interaction) {
    const grouped = {};
    for (const command of interaction.client.commands.values()) {
      grouped[command.category] = grouped[command.category] || [];
      grouped[command.category].push(`\`/${command.data.name}\` — ${command.data.description}`);
    }

    const names = {
      utility: '🔧 Утилиты',
      leveling: '📈 Уровни',
      economy: '💰 Экономика',
      moderation: '🛡️ Модерация',
      config: '⚙️ Настройка',
      music: '🎵 Музыка',
      alerts: '🔔 Оповещения'
    };

    const embed = embeds.info('Список команд').setTitle('📖 Помощь');
    for (const [cat, list] of Object.entries(grouped)) {
      embed.addFields({ name: names[cat] || cat, value: list.join('\n') });
    }
    embed.setFooter({ text: 'Веб-панель управления доступна по адресу вашего сервера / dashboard' });

    await interaction.reply({ embeds: [embed] });
  }
};
