const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isModerator, isAdmin } = require('../../utils/permissions');

// The accent bars of the cards fade smoothly from the brand yellow (ember) to a deep dark yellow,
// top to bottom, however many cards the asker's role gets.
const FROM = [0xe3, 0xa8, 0x57];
const TO = [0x6e, 0x4f, 0x17]; // dark amber
function fadeColor(index, total) {
  const t = total > 1 ? index / (total - 1) : 0;
  const [r, g, b] = FROM.map((from, i) => Math.round(from + (TO[i] - from) * t));
  return (r << 16) | (g << 8) | b;
}

// Each section is one embed: a title, a few plain sentences, and one bold line that
// says what matters. Sections are grouped by who can actually use them.
const MEMBER_SECTIONS = [
  {
    title: 'Профиль и уровни',
    text:
      'Опыт идёт за сообщения (чат) и за время в голосовых каналах (голос), уровень один, общий. `/profile` показывает карточку: уровень, место и обе валюты. `/top` — таблица лидеров с переключением Общий и Голос. `/calc` — сколько опыта и сообщений осталось до нужного уровня. Профиль любого участника — правый клик по нему → «Приложения» → «Профиль». Администраторы меняют уровень командой `/level`.\n\n' +
      '**Чем активнее вы в чате, тем выше уровень.**'
  },
  {
    title: 'Экономика',
    text:
      'Валюты две: монеты (за активность и ежедневную награду) и кристаллы (за новые уровни). `/daily` даёт награду раз в 24 часа (за каждый день подряд она растёт), `/shop` открывает магазин сервера, `/balance` показывает баланс, `/pay` отправляет монеты или кристаллы другому участнику.\n\n' +
      '**Награду можно забирать каждый день.**'
  },
  {
    title: 'Музыка',
    text:
      'Зайдите в голосовой канал и напишите `/play` с названием или ссылкой (YouTube, SoundCloud, Spotify, Apple Music). Для поиска в SoundCloud начните запрос с `sc:`. Появится панель с кнопками: назад, пауза, пропуск, очередь, стоп и громкость. Чтобы добавить ещё трек, снова используйте `/play`.\n\n' +
      '**Если музыки нет 5 минут, бот сам выйдет из канала.**'
  },
  {
    title: 'Жалоба на сообщение',
    text:
      'Нашли нарушение? Нажмите на сообщение правой кнопкой → «Приложения» → «Пожаловаться» (в английском Discord — «Report message»).\n\n' +
      '**Жалоба уйдёт модераторам сервера.**'
  }
];

const MODERATOR_SECTION = {
  title: 'Модерация',
  text:
    '`/mod` — наказания: `warn`, `mute`, `kick`, `ban` (можно на срок: `30m`, `2h`, `7d`), а также `unwarn`, `clearwarns`, `unmute`, `unban`.\n' +
    'Дела: `case`, `history`, `reason`, `note`. Каналы: `clear`, `slowmode`, `lock`, `unlock`. Для `kick`, `ban`, `clear` и каналов нужны соответствующие права в Discord.\n\n' +
    '**Каждое наказание получает номер дела, участник получает уведомление в личные сообщения, а за несколько предупреждений бот сам мутит, кикает или банит (настраивается в панели).**'
};

function adminSection() {
  const url = process.env.WEB_BASE_URL ? `${process.env.WEB_BASE_URL.replace(/\/$/, '')}/dashboard` : null;
  return {
    title: 'Настройка сервера',
      text:
      'Настройка сервера делается в веб-панели, команд для неё нет: каналы логов и жалоб, приветствие и автороль, уровни и валюта, автомодерация, роли по реакциям, свои команды и префикс, временные голосовые, оповещения YouTube и Twitch.\n' +
      'Вебхуки создаются командой `/webhook` (`create`, `list`, `delete`, `send`): нужно право «Управлять вебхуками», ссылка видна только вам.\n\n' +
      (url ? `**Веб-панель:** ${url}` : '**Откройте веб-панель бота и войдите через Discord.**')
  };
}

function toEmbed(section, index, total) {
  return new EmbedBuilder()
    .setColor(fadeColor(index, total))
    .setTitle(section.title)
    .setDescription(section.text);
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Что умеет бот и какие команды вам доступны'),

  async execute(interaction) {
    const member = interaction.member;
    const sections = [...MEMBER_SECTIONS];
    const roleNote = [];

    if (member && isModerator(member)) {
      sections.push(MODERATOR_SECTION);
      roleNote.push('модерации');
    }
    if (member && isAdmin(member)) {
      sections.push(adminSection());
      roleNote.push('настройки сервера');
    }

    const embeds = sections.map((section, i) => toEmbed(section, i, sections.length));
    const footer = roleNote.length
      ? `Показаны и команды ${roleNote.join(' и ')}, которые доступны вам`
      : 'Dark · /help';
    embeds[embeds.length - 1].setFooter({ text: footer });

    // Ephemeral: the list depends on who asks, and it keeps busy channels tidy.
    await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
  }
};
