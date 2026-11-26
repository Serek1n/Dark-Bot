const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { parseDuration } = require('../../utils/duration');
const { Poll } = require('../../../db');
const mc = require('../../utils/moduleConfig');

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/** "Пицца | Суши ; Бургер" -> ['Пицца', 'Суши', 'Бургер'] (2-10 options). */
function parseOptions(text) {
  return String(text || '').split(/[|;\n]/).map((x) => x.trim()).filter(Boolean);
}

/** May this member start a poll here? The roles of the panel («Голосования»), or the right to manage the server. */
function mayCreate(member, cfg) {
  if (!cfg.creatorRoles.length) return true;
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return cfg.creatorRoles.some((r) => member?.roles?.cache?.has?.(r));
}

module.exports = {
  parseOptions, mayCreate,
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Создать голосование: участники отвечают эмодзи или кнопками под сообщением')
    .addStringOption((o) => o.setName('question').setDescription('Вопрос').setRequired(true).setMaxLength(250))
    .addStringOption((o) => o.setName('options').setDescription('Варианты через « | » (от 2 до 10). Без вариантов будет «да / нет»').setMaxLength(1500))
    .addStringOption((o) => o.setName('duration').setDescription('Через сколько закончить и показать итоги: 30m, 2h, 1d. Без срока — как задано на сервере'))
    .addBooleanOption((o) => o.setName('single').setDescription('Только один ответ у каждого участника'))
    .addBooleanOption((o) => o.setName('anonymous').setDescription('Анонимно: голоса кнопками, никто не видит, кто как ответил (нужен срок)')),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [embeds.error('Голосования работают только на сервере.')], flags: MessageFlags.Ephemeral });
    const deny = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
    const { getOrCreateSettings } = require('../../modules/leveling');
    const cfg = mc.read(await getOrCreateSettings(interaction.guildId || interaction.guild.id), 'polls');
    if (!mayCreate(interaction.member, cfg)) return deny('Создавать голосования на этом сервере могут только участники с особыми ролями.');
    // The poll is posted by the bot into this channel: only where the person may write himself.
    const perms = interaction.channel?.permissionsFor?.(interaction.user);
    if (perms && !perms.has(['ViewChannel', 'SendMessages'])) return deny('В этом канале вы не можете писать — создайте голосование там, где можно.');
    const question = interaction.options.getString('question', true).trim();
    const options = parseOptions(interaction.options.getString('options'));
    const most = Math.min(cfg.maxOptions, NUMBERS.length);
    if (options.length === 1 || options.length > most) return deny(`Укажите от 2 до ${most} вариантов через « | », например: Пицца | Суши | Бургер. Или не указывайте их вовсе.`);
    if (options.some((x) => x.length > 200)) return deny('Каждый вариант должен быть короче 200 символов.');

    const maxMs = cfg.maxDays * 24 * 3600 * 1000;
    const durationText = interaction.options.getString('duration');
    let durationMs = durationText ? parseDuration(durationText) : (cfg.defaultMinutes ? cfg.defaultMinutes * 60_000 : null);
    if (durationText && (!durationMs || durationMs < 10_000 || durationMs > maxMs)) return deny(`Срок голосования — от 10 секунд до ${cfg.maxDays} дн., например: 30m, 2h или 1d.`);
    if (durationMs && durationMs > maxMs) durationMs = maxMs;
    const single = interaction.options.getBoolean('single') ?? !cfg.multi;
    const anonymous = Boolean(interaction.options.getBoolean('anonymous'));
    if (anonymous && !cfg.anonymous) return deny('Анонимные голосования на этом сервере выключены.');
    if (anonymous && !durationMs) return deny('У анонимного голосования должен быть срок: укажите его, например 1d.');

    const reactions = options.length ? NUMBERS.slice(0, options.length) : ['👍', '👎'];
    const labels = options.length ? options : ['Да', 'Нет'];
    const body = reactions.map((e, i) => `${e} ${labels[i]}`).join('\n');
    const how = anonymous ? 'Голосуйте кнопками ниже — никто не увидит, кто как ответил.' : 'Голосуйте реакциями под сообщением.';
    const color = cfg.color ? parseInt(cfg.color.slice(1), 16) : undefined;
    const embed = embeds.baseEmbed(color).setTitle(`📊 ${question}`)
      .setDescription(`${body}\n\n${how}${single ? ' Один ответ.' : ''}${durationMs ? `\n⏳ Итоги будут <t:${Math.floor((Date.now() + durationMs) / 1000)}:R>` : ''}`)
      .setFooter({ text: cfg.footer || `Голосование от ${interaction.member?.displayName || interaction.user.username}` });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    const message = await interaction.fetchReply();
    const row = (durationMs || single || anonymous)
      ? await Poll.create({ guildId: interaction.guildId, channelId: message.channelId || interaction.channelId, messageId: message.id, question,
        options: JSON.stringify(reactions.map((emoji, i) => ({ emoji, label: labels[i] }))), endsAt: durationMs ? new Date(Date.now() + durationMs) : require('../../modules/polls').NEVER,
        anonymous, multi: !single, authorId: interaction.user.id })
      : null;
    if (anonymous) await interaction.editReply({ components: require('../../modules/polls').voteButtons(row) }).catch(() => {});
    else for (const emoji of reactions) await message.react(emoji).catch(() => {}); // one by one, so the order is kept
    if (cfg.thread && message.startThread) await message.startThread({ name: `Обсуждение: ${question}`.slice(0, 100) }).catch(() => {});
    if (row && durationMs) require('../../utils/scheduler').poke('polls');
  }
};
