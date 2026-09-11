const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

// Builds a flat list of "subcommand" or "group subcommand" strings for a command's JSON definition.
function expandSubcommands(json) {
  const options = json.options || [];
  const hasNesting = options.some((o) => o.type === SUB_COMMAND || o.type === SUB_COMMAND_GROUP);
  if (!hasNesting) return [json.description];

  const lines = [];
  for (const opt of options) {
    if (opt.type === SUB_COMMAND) {
      lines.push(`\`${opt.name}\` — ${opt.description}`);
    } else if (opt.type === SUB_COMMAND_GROUP) {
      for (const sub of opt.options || []) {
        lines.push(`\`${opt.name} ${sub.name}\` — ${sub.description}`);
      }
    }
  }
  return lines;
}

const CATEGORY_LABELS = {
  utility: '🔧 Утилиты',
  leveling: '📈 Профиль и уровни',
  economy: '💰 Экономика',
  moderation: '🛡️ Модерация (для администрации)',
  config: '⚙️ Настройка сервера (для администрации)',
  music: '🎵 Музыка'
};
const CATEGORY_ORDER = ['leveling', 'economy', 'music', 'utility', 'moderation', 'config'];

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Список всех команд бота'),
  async execute(interaction) {
    const byCategory = {};
    for (const command of interaction.client.commands.values()) {
      if (!command.data.toJSON) continue;
      const json = command.data.toJSON();
      if (json.type === 2 || json.type === 3) continue; // skip context menu commands (USER=2, MESSAGE=3)
      byCategory[command.category] = byCategory[command.category] || [];
      byCategory[command.category].push(command);
    }

    const embed = embeds
      .info('Команд немного, но у каждой есть подкоманды — жмите `/` и выбирайте нужную.')
      .setTitle('📖 Помощь');

    // One embed field per top-level command (not per category) so we never risk
    // hitting Discord's 1024-character-per-field limit as more subcommands get added.
    for (const cat of CATEGORY_ORDER) {
      if (!byCategory[cat]) continue;
      for (const command of byCategory[cat]) {
        const json = command.data.toJSON();
        embed.addFields({
          name: `${CATEGORY_LABELS[cat] || cat} — /${json.name}`,
          value: expandSubcommands(json).join('\n')
        });
      }
    }

    embed.setFooter({ text: 'Веб-панель управления доступна по адресу вашего сервера / dashboard' });

    await interaction.reply({ embeds: [embed] });
  }
};
