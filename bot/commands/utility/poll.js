const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { parseDuration } = require('../../utils/duration');
const { Poll } = require('../../../db');

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/** "Пицца | Суши ; Бургер" -> ['Пицца', 'Суши', 'Бургер'] (2-10 options). */
function parseOptions(text) {
  return String(text || '').split(/[|;\n]/).map((x) => x.trim()).filter(Boolean);
}

module.exports = {
  parseOptions,
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Создать голосование: участники отвечают эмодзи под сообщением')
    .addStringOption((o) => o.setName('question').setDescription('Вопрос').setRequired(true).setMaxLength(250))
    .addStringOption((o) => o.setName('options').setDescription('Варианты через « | » (от 2 до 10). Без вариантов будет «да / нет»').setMaxLength(1500))
    .addStringOption((o) => o.setName('duration').setDescription('Через сколько закончить и показать итоги: 30m, 2h, 1d (до 30 дней). Без срока — бессрочно')),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [embeds.error('Голосования работают только на сервере.')], flags: MessageFlags.Ephemeral });
    const question = interaction.options.getString('question', true).trim();
    const options = parseOptions(interaction.options.getString('options'));
    if (options.length === 1 || options.length > NUMBERS.length) {
      return interaction.reply({ embeds: [embeds.error('Укажите от 2 до 10 вариантов через « | », например: Пицца | Суши | Бургер. Или не указывайте их вовсе.')], flags: MessageFlags.Ephemeral });
    }
    if (options.some((x) => x.length > 200)) {
      return interaction.reply({ embeds: [embeds.error('Каждый вариант должен быть короче 200 символов.')], flags: MessageFlags.Ephemeral });
    }

    const durationText = interaction.options.getString('duration');
    const durationMs = durationText ? parseDuration(durationText) : null;
    if (durationText && (!durationMs || durationMs < 10_000 || durationMs > 30 * 24 * 3600 * 1000)) {
      return interaction.reply({ embeds: [embeds.error('Срок голосования — от 10 секунд до 30 дней, например: 30m, 2h или 1d.')], flags: MessageFlags.Ephemeral });
    }

    const reactions = options.length ? NUMBERS.slice(0, options.length) : ['👍', '👎'];
    const body = options.length ? options.map((o, i) => `${NUMBERS[i]} ${o}`).join('\n') : '👍 Да\n👎 Нет';
    const embed = embeds.baseEmbed().setTitle(`📊 ${question}`).setDescription(`${body}\n\nГолосуйте реакциями под сообщением.${durationMs ? `\n⏳ Итоги будут <t:${Math.floor((Date.now() + durationMs) / 1000)}:R>` : ''}`).setFooter({ text: `Голосование от ${interaction.member?.displayName || interaction.user.username}` });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    const message = await interaction.fetchReply();
    for (const emoji of reactions) await message.react(emoji).catch(() => {}); // one by one, so the order is kept
    if (durationMs) {
      const labels = options.length ? options : ['Да', 'Нет'];
      await Poll.create({ guildId: interaction.guildId, channelId: message.channelId || interaction.channelId, messageId: message.id, question, options: JSON.stringify(reactions.map((emoji, i) => ({ emoji, label: labels[i] }))), endsAt: new Date(Date.now() + durationMs) });
      require('../../utils/scheduler').poke('polls');
    }
  }
};
