// Russian names of Discord permissions for the role / channel logs.
const NAMES = {
  CreateInstantInvite: 'Создавать приглашения', KickMembers: 'Выгонять участников', BanMembers: 'Банить участников',
  Administrator: 'Администратор', ManageChannels: 'Управлять каналами', ManageGuild: 'Управлять сервером',
  AddReactions: 'Добавлять реакции', ViewAuditLog: 'Просматривать журнал аудита', PrioritySpeaker: 'Приоритетный режим',
  Stream: 'Видео', ViewChannel: 'Просматривать каналы', SendMessages: 'Отправлять сообщения',
  SendTTSMessages: 'Отправлять TTS', ManageMessages: 'Управлять сообщениями', EmbedLinks: 'Встраивать ссылки',
  AttachFiles: 'Прикреплять файлы', ReadMessageHistory: 'Читать историю', MentionEveryone: 'Упоминать @everyone',
  UseExternalEmojis: 'Внешние эмодзи', ViewGuildInsights: 'Просматривать аналитику', Connect: 'Подключаться',
  Speak: 'Говорить', MuteMembers: 'Отключать микрофон', DeafenMembers: 'Отключать звук',
  MoveMembers: 'Перемещать участников', UseVAD: 'Режим активации голосом', ChangeNickname: 'Менять никнейм',
  ManageNicknames: 'Управлять никнеймами', ManageRoles: 'Управлять ролями', ManageWebhooks: 'Управлять вебхуками',
  ManageGuildExpressions: 'Управлять эмодзи и стикерами', UseApplicationCommands: 'Использовать команды',
  RequestToSpeak: 'Запрос на выступление', ManageEvents: 'Управлять событиями', ManageThreads: 'Управлять ветками',
  CreatePublicThreads: 'Создавать публичные ветки', CreatePrivateThreads: 'Создавать приватные ветки',
  UseExternalStickers: 'Внешние стикеры', SendMessagesInThreads: 'Писать в ветках',
  UseEmbeddedActivities: 'Использовать активности', ModerateMembers: 'Отправлять в тайм-аут',
  ViewCreatorMonetizationAnalytics: 'Аналитика монетизации', UseSoundboard: 'Использовать звуки',
  CreateGuildExpressions: 'Создавать эмодзи и стикеры', CreateEvents: 'Создавать события',
  UseExternalSounds: 'Внешние звуки', SendVoiceMessages: 'Голосовые сообщения', SendPolls: 'Создавать опросы',
  UseExternalApps: 'Внешние приложения'
};

const name = (flag) => NAMES[flag] || flag;
const list = (flags, max = 12) => {
  const shown = flags.slice(0, max).map(name).join(', ');
  return flags.length > max ? `${shown} и ещё ${flags.length - max}` : shown;
};

module.exports = { name, list };
