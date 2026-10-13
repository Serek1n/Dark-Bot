// The list of features an admin can switch on and off in the web panel ("Функции").
// One place for both sides: the panel draws the switches from it, the bot checks the same flags.
// Moderation commands (/mod) are not listed on purpose: admins should not be able to lock themselves out.
const FEATURES = [
  { key: 'leveling', field: 'levelingEnabled', title: 'Уровни', desc: 'Опыт за чат и голос, команды /profile и /top', commands: ['profile', 'top'], page: 'leveling' },
  { key: 'economy', field: 'economyEnabled', title: 'Экономика', desc: 'Ежедневная награда, баланс и переводы: /daily, /balance, /pay', commands: ['daily', 'balance', 'pay'], page: 'economy' },
  { key: 'shop', field: 'shopEnabled', title: 'Магазин', desc: 'Покупка ролей и предметов за валюту: /shop', commands: ['shop'], page: 'shop' },
  { key: 'music', field: 'musicEnabled', title: 'Музыка', desc: 'Команда /play. Уже играющая музыка продолжит играть, пока её не остановят кнопкой', commands: ['play'], page: null },
  { key: 'automod', field: 'automodEnabled', title: 'Автомодерация', desc: 'Удаление спама, приглашений и запрещённых слов', commands: [], page: 'automod' },
  { key: 'welcome', field: 'welcomeEnabled', title: 'Приветствие и автороль', desc: 'Сообщение и роль для новых участников', commands: [], page: 'welcome' },
  { key: 'reactionRoles', field: 'reactionRolesEnabled', title: 'Роли по реакциям', desc: 'Выдача ролей за реакцию на сообщение', commands: [], page: 'reaction-roles' },
  { key: 'customCommands', field: 'customCommandsEnabled', title: 'Свои команды', desc: 'Ответы на сообщения с префиксом, например !правила', commands: [], page: 'custom-commands' },
  { key: 'tempVoice', field: 'tempVoiceEnabled', title: 'Временные голосовые', desc: 'Личные комнаты по входу в специальный канал', commands: [], page: 'temp-voice' },
  { key: 'alerts', field: 'alertsEnabled', title: 'Оповещения', desc: 'Уведомления о новых видео и стримах', commands: [], page: 'alerts' },
  { key: 'report', field: 'reportEnabled', title: 'Жалобы', desc: 'Меню «Report message» для жалоб на сообщения', commands: ['Report message'], page: 'moderation' }
];

const byCommand = new Map(FEATURES.flatMap((f) => f.commands.map((c) => [c, f])));

/** The feature a slash/context command belongs to, or undefined for commands that can't be switched off. */
const featureForCommand = (name) => byCommand.get(name);

/** True when the feature is on for these settings (a missing row counts as the defaults: on). */
function isEnabled(settings, key) {
  const f = FEATURES.find((x) => x.key === key);
  if (!f) return true;
  if (!settings) return f.key !== 'automod';
  return Boolean(settings[f.field]);
}

module.exports = { FEATURES, featureForCommand, isEnabled };
