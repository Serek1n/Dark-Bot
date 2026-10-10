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
      'За сообщения вы получаете опыт и растёте в уровнях. `/profile view` показывает карточку: уровень, место на сервере и баланс. `/profile top` — таблица лидеров.\n\n' +
      '**Чем активнее вы в чате, тем выше уровень.**'
  },
  {
    title: 'Экономика',
    text:
      '`/economy daily` даёт награду раз в 24 часа, `/economy pay` переводит валюту другому участнику. Монеты также копятся за сообщения.\n\n' +
      '**Награду можно забирать каждый день.**'
  },
  {
    title: 'Музыка',
    text:
      'Зайдите в голосовой канал и напишите `/music play` с названием или ссылкой (YouTube, SoundCloud, Spotify). Управление: `skip`, `pause`, `resume`, `queue`, `volume`, `stop`.\n\n' +
      '**Если музыки нет 5 минут, бот сам выйдет из канала.**'
  },
  {
    title: 'Жалоба на сообщение',
    text:
      'Нашли нарушение? Нажмите на сообщение правой кнопкой → «Приложения» → «Пожаловаться на сообщение».\n\n' +
      '**Жалоба уйдёт модераторам сервера.**'
  }
];

const MODERATOR_SECTION = {
  title: 'Модерация',
  text:
    '`/moderation` — `warn`, `unwarn`, `warnings`, `mute`, `unmute`, `kick`, `ban`, `unban`, `clear`. Для `kick`, `ban` и `clear` нужны соответствующие права в Discord.\n\n' +
    '**Каждое действие записывается в журнал модерации.**'
};

function adminSection() {
  const url = process.env.WEB_BASE_URL ? `${process.env.WEB_BASE_URL.replace(/\/$/, '')}/dashboard` : null;
  return {
    title: 'Настройка сервера',
      text:
      '`/settings` — каналы логов и жалоб, приветствие, автороль, префикс, валюта.\n' +
      '`/automod` — запрещённые слова, инвайты, антиспам.\n' +
      '`/manage` — свои команды, роли по реакциям, временные голосовые, оповещения YouTube и Twitch.\n\n' +
      (url ? `**То же самое можно настроить в веб-панели:** ${url}` : '**Всё это также доступно в веб-панели.**')
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
