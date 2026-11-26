const crypto = require('crypto');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const mc = require('../../utils/moduleConfig');

// «Мини-игры» in the panel: each game on or off, a pause between games of one member, a private answer, the server's own
// answers of the ball and bets of the server's coins on /coinflip and /rps (bot/modules/funBets.js)
const lastGame = new Map(); // `${guild}:${game}:${user}` → time
/** The answers of the ball: the server's own lists when it has any, else the standard twenty. */
function answersOf(cfg) {
  const own = [...cfg.answersGood.map((a) => [a, 'good']), ...cfg.answersMaybe.map((a) => [a, 'maybe']), ...cfg.answersBad.map((a) => [a, 'bad'])];
  return own.length ? own : ANSWERS;
}

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
  ANSWERS, judge, rollDice, answersOf, lastGame,
  variants: [
    {
      sub: 'dice',
      data: new SlashCommandBuilder().setName('dice').setDescription('Бросить кубик')
        .addIntegerOption((o) => o.setName('sides').setDescription('Граней у кубика (по умолчанию 6)').setMinValue(2).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('count').setDescription('Сколько кубиков (по умолчанию 1)').setMinValue(1).setMaxValue(10))
    },
    { sub: 'coinflip', data: new SlashCommandBuilder().setName('coinflip').setDescription('Подбросить монетку')
      .addStringOption((o) => o.setName('side').setDescription('На что ставите (для ставки)').addChoices({ name: 'Орёл', value: 'heads' }, { name: 'Решка', value: 'tails' }))
      .addIntegerOption((o) => o.setName('bet').setDescription('Ставка монетами сервера, если ставки включены').setMinValue(1)) },
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
        .addIntegerOption((o) => o.setName('bet').setDescription('Ставка монетами сервера, если ставки включены').setMinValue(1))
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
    const { getOrCreateSettings } = require('../../modules/leveling');
    const settings = interaction.guildId ? await getOrCreateSettings(interaction.guildId) : null;
    const cfg = mc.read(settings, 'fun');
    const quiet = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    if (cfg[sub] === false) return quiet(embeds.info('Эта игра на сервере выключена.'));
    if (cfg.cooldownSec && interaction.guildId) {
      const k = `${interaction.guildId}:${sub}:${interaction.user.id}`; const left = Math.ceil(((lastGame.get(k) || 0) + cfg.cooldownSec * 1000 - Date.now()) / 1000);
      if (left > 0) return quiet(embeds.info(`Подождите ${left} сек. перед следующей игрой.`));
      lastGame.set(k, Date.now()); if (lastGame.size > 20000) lastGame.delete(lastGame.keys().next().value);
    }
    // a bet: checked before the game is played (the money moves after, with the result)
    const bet = ['coinflip', 'rps'].includes(sub) ? interaction.options.getInteger?.('bet') : null;
    const bets = require('../../modules/funBets');
    if (bet) {
      const { isEnabled } = require('../../utils/features');
      const why = await bets.refusal(interaction.guildId, interaction.user.id, cfg, bet, isEnabled(settings, 'economy'));
      if (why) return quiet(embeds.error(why));
      if (sub === 'coinflip' && !interaction.options.getString('side')) return quiet(embeds.error('Для ставки выберите сторону: орёл или решка.'));
    }
    const cur = settings?.currencyName || 'монет';
    const settleLine = async (result) => {
      if (!bet) return '';
      const r = await bets.settle(interaction.guildId, interaction.user.id, cfg, bet, result, sub);
      if (!r.ok) return `\n\n💸 Ставка не сыграла: не хватает ${cur} (нужно ${bet}).`;
      if (result === 'lose') return `\n\n💸 Ставка ${bet} ${cur} проиграна. Баланс: ${r.balance}.`;
      if (result === 'draw') return `\n\n↩️ Ставка ${bet} ${cur} вернулась.`;
      return `\n\n💰 Выигрыш: +${r.paid - bet} ${cur}${r.tax ? ` (налог в казну ${r.tax})` : ''}. Баланс: ${r.balance}.`;
    };
    // «Оформление» (bot/modules/appearance.js): a picture of the result, the text, or both; in a frame or plain
    const appearance = require('../../modules/appearance');
    const look = interaction.guildId ? await appearance.forGuild(interaction.guildId) : appearance.read(null);
    const shape = look.targets.fun;
    const flags = cfg.ephemeral ? MessageFlags.Ephemeral : undefined;
    const send = async (embed, plain, game) => {
      let png = null;
      if (shape.card) png = await require('../../modules/lookCards').renderGameCard({ ...game, player: name, colors: appearance.palette(look) }).catch(() => null);
      const files = png ? [{ attachment: png, name: 'game.png' }] : [];
      if (png && !shape.text) return interaction.reply({ files, flags, allowedMentions: { parse: [] } });
      if (shape.frame) return interaction.reply({ embeds: [png ? embed.setImage('attachment://game.png') : embed], files, flags, allowedMentions: { parse: [] } });
      return interaction.reply({ content: plain, files, flags, allowedMentions: { parse: [] } });
    };
    const accent = appearance.embedColor(look);

    if (sub === 'dice') {
      const sides = interaction.options.getInteger('sides') || 6;
      const count = interaction.options.getInteger('count') || 1;
      const rolls = rollDice(sides, count);
      const text = count === 1 ? `🎲 **${rolls[0]}** из ${sides}` : `🎲 ${rolls.join(' + ')} = **${rolls.reduce((a, b) => a + b, 0)}**`;
      const line = `${name} бросает ${count > 1 ? `${count} кубика(ов)` : 'кубик'} (d${sides}):\n${text}`;
      return send(embeds.baseEmbed(accent).setDescription(line), line, { game: 'dice', rolls, sides });
    }
    if (sub === 'coinflip') {
      const heads = crypto.randomInt(2) === 0;
      const side = interaction.options.getString?.('side');
      let line = `🪙 ${name} подбрасывает монетку: **${heads ? 'Орёл' : 'Решка'}**`;
      if (bet) line += (await settleLine((side === 'heads') === heads ? 'win' : 'lose'));
      return send(embeds.baseEmbed(accent).setDescription(line), line, { game: 'coinflip', heads });
    }
    if (sub === '8ball') {
      const question = interaction.options.getString('question', true);
      const [answer, mood] = pick(answersOf(cfg));
      const color = mood === 'good' ? embeds.COLORS.success : mood === 'bad' ? embeds.COLORS.danger : embeds.COLORS.warning;
      return send(embeds.baseEmbed(color).setTitle('🎱 Шар предсказаний').addFields({ name: 'Вопрос', value: question.slice(0, 250) }, { name: 'Ответ', value: answer }),
        `🎱 **${question.slice(0, 250)}**\n${answer}`, { game: '8ball', question: question.slice(0, 250), answer, mood });
    }
    // rps
    const player = interaction.options.getString('choice', true);
    const bot = pick(Object.keys(RPS));
    const result = judge(player, bot);
    const verdict = { win: 'Вы победили! 🎉', lose: 'Бот победил.', draw: 'Ничья.' }[result];
    const color = result === 'win' ? embeds.COLORS.success : result === 'lose' ? embeds.COLORS.danger : embeds.COLORS.warning;
    const body = `Вы: ${RPS[player].join(' ')}\nБот: ${RPS[bot].join(' ')}\n\n**${verdict}**${await settleLine(result)}`;
    return send(embeds.baseEmbed(color).setTitle('Камень, ножницы, бумага').setDescription(body), body, { game: 'rps', you: player, bot, result });
  }
};
