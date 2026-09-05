const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

// Builds a flat list of "/command sub" or "/command group sub" strings for a command's JSON definition.
function expandSubcommands(json) {
  const options = json.options || [];
  const hasNesting = options.some((o) => o.type === SUB_COMMAND || o.type === SUB_COMMAND_GROUP);
  if (!hasNesting) return [`\`/${json.name}\` — ${json.description}`];

  const lines = [];
  for (const opt of options) {
    if (opt.type === SUB_COMMAND) {
      lines.push(`\`/${json.name} ${opt.name}\` — ${opt.description}`);
    } else if (opt.type === SUB_COMMAND_GROUP) {
      for (const sub of opt.options || []) {
        lines.push(`\`/${json.name} ${opt.name} ${sub.name}\` — ${sub.description}`);
      }
    }
  }
  return lines;
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Список всех команд бота'),
  async execute(interaction) {
    const grouped = {};
    for (const command of interaction.client.commands.values()) {
      if (!command.data.toJSON) continue; // skip context menu commands
      grouped[command.category] = grouped[command.category] || [];
      grouped[command.category].push(...expandSubcommands(command.data.toJSON()));
    }

    const names = {
      utility: '🔧 Утилиты',
      leveling: '📈 Профиль и уровни',
      economy: '💰 Экономика',
      moderation: '🛡️ Модерация (для администрации)',
      config: '⚙️ Настройка сервера (для администрации)',
      music: '🎵 Музыка'
    };

    const order = ['leveling', 'economy', 'music', 'utility', 'moderation', 'config'];
    const embed = embeds.info('Команд немного, но у каждой есть подкоманды — жмите `/` и выбирайте нужную.').setTitle('📖 Помощь');
    for (const cat of order) {
      if (!grouped[cat]) continue;
      embed.addFields({ name: names[cat] || cat, value: grouped[cat].join('\n') });
    }
    embed.setFooter({ text: 'Веб-панель управления доступна по адресу вашего сервера / dashboard' });

    await interaction.reply({ embeds: [embed] });
  }
};
