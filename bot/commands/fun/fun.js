const crypto = require('crypto');
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

const ANSWERS = [
  ['Бесспорно.', 'good'], ['Предрешено.', 'good'], ['Никаких сомнений.', 'good'], ['Определённо да.', 'good'], ['Можешь быть уверен в этом.', 'good'],
  ['Мне кажется, да.', 'good'], ['Вероятнее всего.', 'good'], ['Хорошие перспективы.', 'good'], ['Знаки говорят: да.', 'good'], ['Да.', 'good'],
  ['Пока не ясно, попробуй снова.', 'maybe'], ['Спроси позже.', 'maybe'], ['Лучше не рассказывать.', 'maybe'], ['Сейчас нельзя предсказать.', 'maybe'], ['Сконцентрируйся и спроси опять.', 'maybe'],
  ['Даже не думай.', 'bad'], ['Мой ответ — нет.', 'bad'], ['По моим данным — нет.', 'bad'], ['Перспективы не очень хорошие.', 'bad'], ['Весьма сомнительно.', 'bad']
];
const RPS = { rock: ['🪨', 'Камень'], scissors: ['✂️', 'Ножницы'], paper: ['📄', 'Бумага'] };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const pick = (arr) => arr[crypto.randomInt(arr.length)];

function rollDice(sides, count) {
  return Array.from({ length: count }, () => crypto.randomInt(sides) + 1);
}

/** Rock-paper-scissors against the bot: 'win' | 'lose' | 'draw' from the player's side. */
function judge(player, bot) {
  if (player === bot) return 'draw';
  return BEATS[player] === bot ? 'win' : 'lose';
}

module.exports = {
  ANSWERS, judge, rollDice,
  variants: [
    {
      sub: 'dice',
      data: new SlashCommandBuilder().setName('dice').setDescription('Бросить кубик')
        .addIntegerOption((o) => o.setName('sides').setDescription('Граней у кубика (по умолчанию 6)').setMinValue(2).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('count').setDescription('Сколько кубиков (по умолчанию 1)').setMinValue(1).setMaxValue(10))
    },
    { sub: 'coinflip', data: new SlashCommandBuilder().setName('coinflip').setDescription('Подбросить монетку') },
    {
      sub: '8ball',
      data: new SlashCommandBuilder().setName('8ball').setDescription('Шар предсказаний: задайте вопрос, на который можно ответить «да» или «нет»')
        .addStringOption((o) => o.setName('question').setDescription('Ваш вопрос').setRequired(true).setMaxLength(250))
    },
    {
      sub: 'rps',
      data: new SlashCommandBuilder().setName('rps').setDescription('Камень, ножницы, бумага против бота')
        .addStringOption((o) => o.setName('choice').setDescription('Ваш ход').setRequired(true).addChoices(
          { name: 'Камень', value: 'rock' }, { name: 'Ножницы', value: 'scissors' }, { name: 'Бумага', value: 'paper' }))
    }
  ],
  data: new SlashCommandBuilder().setName('fun').setDescription('Мини-игры')
    .addSubcommand((s) => s.setName('dice').setDescription('Бросить кубик'))
    .addSubcommand((s) => s.setName('coinflip').setDescription('Подбросить монетку'))
    .addSubcommand((s) => s.setName('8ball').setDescription('Шар предсказаний'))
    .addSubcommand((s) => s.setName('rps').setDescription('Камень, ножницы, бумага')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const name = interaction.member?.displayName || interaction.user.username;

    if (sub === 'dice') {
      const sides = interaction.options.getInteger('sides') || 6;
      const count = interaction.options.getInteger('count') || 1;
      const rolls = rollDice(sides, count);
      const text = count === 1 ? `🎲 **${rolls[0]}** из ${sides}` : `🎲 ${rolls.join(' + ')} = **${rolls.reduce((a, b) => a + b, 0)}**`;
      return interaction.reply({ embeds: [embeds.info(`${name} бросает ${count > 1 ? `${count} кубика(ов)` : 'кубик'} (d${sides}):\n${text}`)], allowedMentions: { parse: [] } });
    }
    if (sub === 'coinflip') {
      const heads = crypto.randomInt(2) === 0;
      return interaction.reply({ embeds: [embeds.info(`🪙 ${name} подбрасывает монетку: **${heads ? 'Орёл' : 'Решка'}**`)], allowedMentions: { parse: [] } });
    }
    if (sub === '8ball') {
      const question = interaction.options.getString('question', true);
      const [answer, mood] = pick(ANSWERS);
      const color = mood === 'good' ? embeds.COLORS.success : mood === 'bad' ? embeds.COLORS.danger : embeds.COLORS.warning;
      return interaction.reply({ embeds: [embeds.baseEmbed(color).setTitle('🎱 Шар предсказаний').addFields({ name: 'Вопрос', value: question.slice(0, 250) }, { name: 'Ответ', value: answer })], allowedMentions: { parse: [] } });
    }
    // rps
    const player = interaction.options.getString('choice', true);
    const bot = pick(Object.keys(RPS));
    const result = judge(player, bot);
    const verdict = { win: 'Вы победили! 🎉', lose: 'Бот победил.', draw: 'Ничья.' }[result];
    const color = result === 'win' ? embeds.COLORS.success : result === 'lose' ? embeds.COLORS.danger : embeds.COLORS.warning;
    return interaction.reply({ embeds: [embeds.baseEmbed(color).setTitle('Камень, ножницы, бумага').setDescription(`Вы: ${RPS[player].join(' ')}\nБот: ${RPS[bot].join(' ')}\n\n**${verdict}**`)] });
  }
};
