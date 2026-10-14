// Everything that is written to the "Логи" forum. Each handler first asks the (cached) log setup
// whether its category is on, so guilds without the forum cost almost nothing.
const { ChannelType, PermissionsBitField } = require('discord.js');
const { TempVoiceChannel } = require('../../db');
const L = require('../modules/serverLog');
const perms = require('../utils/permissionNames');
const logger = require('../utils/logger');

const COLORS = { create: 0x5cb98a, delete: 0xe5686c, edit: 0xe3a857, info: 0x7f8bff, voice: 0x4fb3d9 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const user = (id) => (id ? `<@${id}>` : 'неизвестно');
const clip = (text, n = 1000) => {
  const s = String(text ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const code = (text, n = 1000) => '```\n' + clip(text, n).replaceAll('```', "'''") + '\n```';
const ts = (date) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:f>`;
const safe = (name, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    logger.error(`Log event ${name}:`, err);
  }
};

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);
const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const tempRooms = new Set(); // temporary rooms of the bot are too noisy to log

async function isTempRoom(id) {
  if (tempRooms.has(id)) return true;
  const found = await TempVoiceChannel.findOne({ where: { channelId: id } }).catch(() => null);
  if (found) tempRooms.add(id);
  return Boolean(found);
}

const channelKind = (type) => ({ [ChannelType.GuildText]: 'Текстовый канал', [ChannelType.GuildAnnouncement]: 'Канал объявлений', [ChannelType.GuildForum]: 'Форум', [ChannelType.GuildMedia]: 'Медиаканал', [ChannelType.GuildVoice]: 'Голосовой канал', [ChannelType.GuildStageVoice]: 'Трибуна' })[type] || 'Канал';
const catOf = (type) => (VOICE_TYPES.has(type) ? 'voice' : TEXT_TYPES.has(type) ? 'channels' : null);

const fileLines = (list) => list.map((a) => `[${clip(a.name || 'файл', 80)}](${a.url})${a.size ? ` · ${(a.size / 1024).toFixed(a.size > 1048576 ? 0 : 1)} КБ` : ''}`).join('\n');

// Differences between two lists of permission overwrites of a channel.
function overwriteChanges(before, after) {
  const lines = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    const a = before.get(id);
    const b = after.get(id);
    const label = (b || a).type === 0 ? `<@&${id}>` : `<@${id}>`;
    if (!a) lines.push(`➕ ${label}: добавлены права`);
    else if (!b) lines.push(`➖ ${label}: права удалены`);
    else if (a.allow.bitfield !== b.allow.bitfield || a.deny.bitfield !== b.deny.bitfield) {
      const allowed = new PermissionsBitField(b.allow.bitfield & ~a.allow.bitfield).toArray();
      const denied = new PermissionsBitField(b.deny.bitfield & ~a.deny.bitfield).toArray();
      const reset = new PermissionsBitField((a.allow.bitfield | a.deny.bitfield) & ~(b.allow.bitfield | b.deny.bitfield)).toArray();
      const parts = [];
      if (allowed.length) parts.push(`✅ ${perms.list(allowed, 6)}`);
      if (denied.length) parts.push(`⛔ ${perms.list(denied, 6)}`);
      if (reset.length) parts.push(`⬜ сброшено: ${perms.list(reset, 6)}`);
      lines.push(`✏️ ${label}: ${parts.join(' · ') || 'изменено'}`);
    }
  }
  return lines;
}

const handlers = [];
const on = (name, fn) => handlers.push({ name, execute: safe(name, fn) });

// ============================== Messages and files ==============================
on('messageCreate', async (message) => {
  if (!message.guild) return;
  const cfg = await L.getConfig(message.guild.id);
  if (!cfg || cfg.threadIds.has(message.channelId) || (message.webhookId && message.webhookId === cfg.webhookId)) return;
  L.remember(message);
  if (message.attachments.size && (await L.isOn(message.guild.id, 'files'))) {
    await L.log(message.guild.id, 'files', (base) =>
      base(COLORS.create)
        .setTitle('📎 Отправлены файлы')
        .setDescription(fileLines([...message.attachments.values()].slice(0, 10)))
        .addFields(
          { name: 'Автор', value: user(message.author?.id), inline: true },
          { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
          { name: 'Сообщение', value: `[Перейти](${message.url})`, inline: true }
        )
    );
  }
});

on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  const guildId = newMessage.guild.id;
  const cfg = await L.getConfig(guildId);
  if (!cfg || cfg.threadIds.has(newMessage.channelId) || (newMessage.webhookId && newMessage.webhookId === cfg.webhookId)) return;
  const cached = L.recall(newMessage.id);
  const after = newMessage.content;
  if (after === null || after === undefined) return; // an embed-only update (link preview)
  const before = cached ? cached.content : oldMessage?.content;
  const authorId = newMessage.author?.id || cached?.authorId;
  const removed = (cached?.attachments || []).filter((a) => !newMessage.attachments?.some?.((n) => n.url === a.url));
  L.remember(newMessage);
  if (before !== after && before !== null && before !== undefined) {
    await L.log(guildId, 'messages', (base) =>
      base(COLORS.edit)
        .setTitle('✏️ Сообщение изменено')
        .addFields(
          { name: 'Автор', value: user(authorId), inline: true },
          { name: 'Канал', value: `<#${newMessage.channelId}>`, inline: true },
          { name: 'Сообщение', value: `[Перейти](${newMessage.url})`, inline: true },
          { name: 'Было', value: before ? code(before, 900) : '*пусто*' },
          { name: 'Стало', value: after ? code(after, 900) : '*пусто*' }
        )
    );
  }
  if (removed.length) {
    await L.log(guildId, 'files', (base) =>
      base(COLORS.delete)
        .setTitle('🗑️ Файл убран из сообщения')
        .setDescription(fileLines(removed))
        .addFields({ name: 'Автор', value: user(authorId), inline: true }, { name: 'Канал', value: `<#${newMessage.channelId}>`, inline: true })
    );
  }
});

on('messageDelete', async (message) => {
  if (!message.guildId) return;
  const guildId = message.guildId;
  const cfg = await L.getConfig(guildId);
  if (!cfg || cfg.threadIds.has(message.channelId)) return;
  const cached = L.forget(message.id);
  if ((cached?.webhookId || message.webhookId) === cfg.webhookId) return;
  const authorId = message.author?.id || cached?.authorId;
  const content = message.content ?? cached?.content;
  await L.log(guildId, 'messages', (base) =>
    base(COLORS.delete)
      .setTitle('🗑️ Сообщение удалено')
      .addFields(
        { name: 'Автор', value: user(authorId), inline: true },
        { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
        { name: 'Содержимое', value: content ? code(content, 1000) : '*текст неизвестен: сообщение отправлено до запуска логов или состояло из файла*' }
      )
  );
  const files = cached?.attachments?.length ? cached.attachments : [...(message.attachments?.values?.() || [])];
  if (files.length) {
    await L.log(guildId, 'files', (base) =>
      base(COLORS.delete)
        .setTitle('🗑️ Удалены файлы')
        .setDescription(fileLines(files))
        .addFields({ name: 'Автор', value: user(authorId), inline: true }, { name: 'Канал', value: `<#${message.channelId}>`, inline: true })
    );
  }
});

on('messageDeleteBulk', async (messages, channel) => {
  if (!channel.guild) return;
  const cfg = await L.getConfig(channel.guild.id);
  if (!cfg || cfg.threadIds.has(channel.id)) return;
  for (const id of messages.keys()) L.forget(id);
  await L.log(channel.guild.id, 'messages', (base) =>
    base(COLORS.delete).setTitle('🧹 Массовое удаление сообщений').addFields({ name: 'Канал', value: `<#${channel.id}>`, inline: true }, { name: 'Количество', value: String(messages.size), inline: true })
  );
});

// ============================== Members ==============================
on('guildMemberAdd', async (member) => {
  const isBot = member.user.bot;
  await L.log(member.guild.id, 'members', (base) =>
    base(COLORS.create)
      .setTitle(isBot ? '🤖 Добавлен бот' : '📥 Участник зашёл')
      .setThumbnail(member.user.displayAvatarURL?.() || null)
      .setDescription(`${user(member.id)} (${clip(member.user.username, 60)})`)
      .addFields({ name: 'Аккаунт создан', value: ts(member.user.createdAt), inline: true }, { name: 'Участников', value: String(member.guild.memberCount ?? '?'), inline: true })
  );
});

on('guildMemberRemove', async (member) => {
  const isBot = member.user?.bot;
  const roles = member.roles?.cache ? [...member.roles.cache.values()].filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`) : [];
  await L.log(member.guild.id, 'members', (base) => {
    const e = base(COLORS.delete)
      .setTitle(isBot ? '🤖 Бот удалён' : '📤 Участник вышел')
      .setThumbnail(member.user?.displayAvatarURL?.() || null)
      .setDescription(`${user(member.id)} (${clip(member.user?.username || '—', 60)})`);
    if (member.joinedAt) e.addFields({ name: 'Был на сервере с', value: ts(member.joinedAt), inline: true });
    if (roles.length) e.addFields({ name: 'Роли', value: clip(roles.join(' '), 1000) });
    return e;
  });
});

on('guildMemberUpdate', async (oldMember, newMember) => {
  if (oldMember.partial) return;
  const guildId = newMember.guild.id;
  if (!(await L.getConfig(guildId))) return;
  const who = `${user(newMember.id)} (${clip(newMember.user.username, 60)})`;

  if (oldMember.nickname !== newMember.nickname) {
    await L.log(guildId, 'members', (base) =>
      base(COLORS.edit).setTitle('📝 Изменён никнейм').setDescription(who).addFields({ name: 'Было', value: oldMember.nickname || '*нет*', inline: true }, { name: 'Стало', value: newMember.nickname || '*нет*', inline: true })
    );
  }

  const added = [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
  const removed = [...oldMember.roles.cache.keys()].filter((id) => !newMember.roles.cache.has(id));
  if (added.length || removed.length) {
    await L.log(guildId, 'members', (base) => {
      const e = base(COLORS.edit).setTitle('🏷️ Изменены роли').setDescription(who);
      if (added.length) e.addFields({ name: 'Выданы', value: added.map((id) => `<@&${id}>`).join(' ') });
      if (removed.length) e.addFields({ name: 'Сняты', value: removed.map((id) => `<@&${id}>`).join(' ') });
      return e;
    });
  }

  if (oldMember.avatar !== newMember.avatar || oldMember.user.avatar !== newMember.user.avatar) {
    await L.log(guildId, 'members', (base) =>
      base(COLORS.edit).setTitle('🖼️ Изменён аватар').setDescription(who).setThumbnail(newMember.displayAvatarURL?.({ size: 256 }) || null)
    );
  }

  if (!oldMember.premiumSince !== !newMember.premiumSince) {
    const boosted = Boolean(newMember.premiumSince);
    await L.log(guildId, 'server', (base) =>
      base(boosted ? COLORS.create : COLORS.delete)
        .setTitle(boosted ? '🚀 Новый буст сервера' : '💔 Буст сервера снят')
        .setDescription(who)
        .addFields({ name: 'Бустов на сервере', value: String(newMember.guild.premiumSubscriptionCount ?? '?'), inline: true })
    );
  }

  const muteBefore = oldMember.communicationDisabledUntilTimestamp > Date.now();
  const muteAfter = newMember.communicationDisabledUntilTimestamp > Date.now();
  if (muteBefore !== muteAfter) {
    const action = muteAfter ? 'mute' : 'unmute';
    await sleep(1500); // let /mod finish and report the same action first
    if (!L.wasReported(guildId, newMember.id, action)) {
      await L.log(guildId, 'punishments', (base) =>
        base(muteAfter ? COLORS.delete : COLORS.create)
          .setTitle(muteAfter ? '🔇 Тайм-аут выдан' : '🔊 Тайм-аут снят')
          .setDescription(who)
          .addFields(muteAfter ? [{ name: 'До', value: ts(newMember.communicationDisabledUntil), inline: true }] : [])
      );
    }
  }
});

// ============================== Punishments done by hand in Discord ==============================
for (const [event, action, title, color] of [
  ['guildBanAdd', 'ban', '🔨 Участник заблокирован', COLORS.delete],
  ['guildBanRemove', 'unban', '♻️ Участник разблокирован', COLORS.create]
]) {
  on(event, async (ban) => {
    const guildId = ban.guild.id;
    if (!(await L.isOn(guildId, 'punishments'))) return;
    await sleep(1500);
    if (L.wasReported(guildId, ban.user.id, action)) return;
    await L.log(guildId, 'punishments', (base) => {
      const e = base(color).setTitle(title).setDescription(`${user(ban.user.id)} (${clip(ban.user.username, 60)})`);
      if (ban.reason) e.addFields({ name: 'Причина', value: clip(ban.reason, 1000) });
      return e;
    });
  });
}

// ============================== Voice ==============================
on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = (newState.guild || oldState.guild).id;
  if (!(await L.isOn(guildId, 'voice'))) return;
  const id = newState.id;
  const who = `${user(id)} (${clip((newState.member || oldState.member)?.user?.username || '—', 60)})`;
  const make = (color, title, fields = []) => L.log(guildId, 'voice', (base) => base(color).setTitle(title).setDescription(who).addFields(fields));

  if (oldState.channelId !== newState.channelId) {
    if (!oldState.channelId) return void (await make(COLORS.create, '🔊 Вход в голосовой канал', [{ name: 'Канал', value: `<#${newState.channelId}>`, inline: true }]));
    if (!newState.channelId) return void (await make(COLORS.delete, '🔇 Выход из голосового канала', [{ name: 'Канал', value: `<#${oldState.channelId}>`, inline: true }]));
    return void (await make(COLORS.voice, '🔀 Перемещение между каналами', [
      { name: 'Из', value: `<#${oldState.channelId}>`, inline: true },
      { name: 'В', value: `<#${newState.channelId}>`, inline: true }
    ]));
  }
  const channel = [{ name: 'Канал', value: `<#${newState.channelId}>`, inline: true }];
  if (oldState.serverMute !== newState.serverMute) await make(COLORS.voice, newState.serverMute ? '🎙️ Серверное отключение микрофона' : '🎙️ Микрофон включён модератором', channel);
  if (oldState.serverDeaf !== newState.serverDeaf) await make(COLORS.voice, newState.serverDeaf ? '🎧 Серверное отключение звука' : '🎧 Звук включён модератором', channel);
  if (oldState.streaming !== newState.streaming) await make(COLORS.voice, newState.streaming ? '🖥️ Начата трансляция экрана' : '🖥️ Трансляция экрана остановлена', channel);
  if (oldState.selfVideo !== newState.selfVideo) await make(COLORS.voice, newState.selfVideo ? '📷 Включена камера' : '📷 Камера выключена', channel);
});

// ============================== Channels (text -> "channels", voice -> "voice") ==============================
on('channelCreate', async (channel) => {
  const key = catOf(channel.type);
  if (!key || !channel.guild) return;
  if (key === 'voice') {
    await sleep(1500);
    if (await isTempRoom(channel.id)) return;
  }
  await L.log(channel.guild.id, key, (base) =>
    base(COLORS.create).setTitle(`➕ ${channelKind(channel.type)} создан`).addFields({ name: 'Канал', value: `<#${channel.id}> (${clip(channel.name, 80)})`, inline: true }, ...(channel.parentId ? [{ name: 'Категория', value: `<#${channel.parentId}>`, inline: true }] : []))
  );
});

on('channelDelete', async (channel) => {
  const key = catOf(channel.type);
  if (!key || !channel.guild) return;
  if (key === 'voice' && (await isTempRoom(channel.id))) return tempRooms.delete(channel.id);
  await L.log(channel.guild.id, key, (base) => base(COLORS.delete).setTitle(`➖ ${channelKind(channel.type)} удалён`).addFields({ name: 'Название', value: clip(channel.name, 100), inline: true }));
});

on('channelUpdate', async (oldChannel, newChannel) => {
  const key = catOf(newChannel.type);
  if (!key || !newChannel.guild) return;
  if (key === 'voice' && (await isTempRoom(newChannel.id))) return;
  const lines = [];
  if (oldChannel.name !== newChannel.name) lines.push(['Название', `${clip(oldChannel.name, 100)} → ${clip(newChannel.name, 100)}`]);
  if ((oldChannel.topic || '') !== (newChannel.topic || '')) lines.push(['Описание', `${clip(oldChannel.topic || 'нет', 400)} → ${clip(newChannel.topic || 'нет', 400)}`]);
  if (oldChannel.nsfw !== newChannel.nsfw) lines.push(['Возрастное ограничение', newChannel.nsfw ? 'включено' : 'выключено']);
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) lines.push(['Медленный режим', `${oldChannel.rateLimitPerUser || 0} с → ${newChannel.rateLimitPerUser || 0} с`]);
  if (oldChannel.bitrate !== newChannel.bitrate) lines.push(['Битрейт', `${Math.round((oldChannel.bitrate || 0) / 1000)} → ${Math.round((newChannel.bitrate || 0) / 1000)} кбит/с`]);
  if (oldChannel.userLimit !== newChannel.userLimit) lines.push(['Лимит участников', `${oldChannel.userLimit || 'без лимита'} → ${newChannel.userLimit || 'без лимита'}`]);
  if (oldChannel.parentId !== newChannel.parentId) lines.push(['Категория', `${oldChannel.parentId ? `<#${oldChannel.parentId}>` : 'нет'} → ${newChannel.parentId ? `<#${newChannel.parentId}>` : 'нет'}`]);
  const overwrites = overwriteChanges(oldChannel.permissionOverwrites.cache, newChannel.permissionOverwrites.cache);
  if (overwrites.length) lines.push(['Права доступа', clip(overwrites.join('\n'), 1000)]);
  if (!lines.length) return; // a plain re-ordering is not worth a log line
  await L.log(newChannel.guild.id, key, (base) =>
    base(COLORS.edit)
      .setTitle(`✏️ ${channelKind(newChannel.type)} изменён`)
      .setDescription(`<#${newChannel.id}>`)
      .addFields(lines.slice(0, 20).map(([name, value]) => ({ name, value: clip(value, 1000) })))
  );
});

// ============================== Roles ==============================
on('roleCreate', async (role) => {
  await L.log(role.guild.id, 'roles', (base) => base(COLORS.create).setTitle('➕ Роль создана').setDescription(`<@&${role.id}> (${clip(role.name, 80)})`));
});

on('roleDelete', async (role) => {
  await L.log(role.guild.id, 'roles', (base) => base(COLORS.delete).setTitle('➖ Роль удалена').setDescription(`**${clip(role.name, 100)}**`).addFields({ name: 'Цвет', value: role.hexColor, inline: true }));
});

on('roleUpdate', async (oldRole, newRole) => {
  const lines = [];
  if (oldRole.name !== newRole.name) lines.push(['Название', `${clip(oldRole.name, 100)} → ${clip(newRole.name, 100)}`]);
  if (oldRole.color !== newRole.color) lines.push(['Цвет', `${oldRole.hexColor} → ${newRole.hexColor}`]);
  if (oldRole.hoist !== newRole.hoist) lines.push(['Отдельно в списке', newRole.hoist ? 'включено' : 'выключено']);
  if (oldRole.mentionable !== newRole.mentionable) lines.push(['Упоминание всеми', newRole.mentionable ? 'включено' : 'выключено']);
  const gained = oldRole.permissions.missing(newRole.permissions); // flags the new role has and the old one lacked
  const lost = newRole.permissions.missing(oldRole.permissions); // flags the old role had and the new one lacks
  if (gained.length) lines.push(['Права добавлены', perms.list(gained, 15)]);
  if (lost.length) lines.push(['Права убраны', perms.list(lost, 15)]);
  if (!lines.length) return; // position changes only
  await L.log(newRole.guild.id, 'roles', (base) =>
    base(COLORS.edit).setTitle('✏️ Роль изменена').setDescription(`<@&${newRole.id}>`).addFields(lines.map(([name, value]) => ({ name, value: clip(value, 1000) })))
  );
});

// ============================== Server ==============================
on('guildUpdate', async (oldGuild, newGuild) => {
  const lines = [];
  if (oldGuild.name !== newGuild.name) lines.push(['Название', `${clip(oldGuild.name, 100)} → ${clip(newGuild.name, 100)}`]);
  if (oldGuild.icon !== newGuild.icon) lines.push(['Иконка', 'изменена']);
  if (oldGuild.banner !== newGuild.banner) lines.push(['Баннер', 'изменён']);
  if (oldGuild.splash !== newGuild.splash) lines.push(['Фон приглашений', 'изменён']);
  if ((oldGuild.description || '') !== (newGuild.description || '')) lines.push(['Описание', `${clip(oldGuild.description || 'нет', 400)} → ${clip(newGuild.description || 'нет', 400)}`]);
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) lines.push(['Уровень проверки', `${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`]);
  if (oldGuild.afkChannelId !== newGuild.afkChannelId) lines.push(['AFK-канал', newGuild.afkChannelId ? `<#${newGuild.afkChannelId}>` : 'нет']);
  if (oldGuild.systemChannelId !== newGuild.systemChannelId) lines.push(['Системный канал', newGuild.systemChannelId ? `<#${newGuild.systemChannelId}>` : 'нет']);
  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) lines.push(['Короткая ссылка', newGuild.vanityURLCode || 'нет']);
  if (oldGuild.ownerId !== newGuild.ownerId) lines.push(['Владелец', user(newGuild.ownerId)]);
  if (oldGuild.premiumTier !== newGuild.premiumTier) lines.push(['Уровень буста', `${oldGuild.premiumTier} → ${newGuild.premiumTier}`]);
  if (!lines.length) return;
  await L.log(newGuild.id, 'server', (base) => base(COLORS.edit).setTitle('⚙️ Сервер изменён').addFields(lines.map(([name, value]) => ({ name, value: clip(value, 1000) }))));
});

for (const [event, title, color] of [
  ['emojiCreate', '😀 Эмодзи добавлено', COLORS.create],
  ['emojiDelete', '😶 Эмодзи удалено', COLORS.delete],
  ['stickerCreate', '🏷️ Стикер добавлен', COLORS.create],
  ['stickerDelete', '🏷️ Стикер удалён', COLORS.delete]
]) {
  on(event, async (item) => {
    await L.log(item.guild.id, 'server', (base) => {
      const e = base(color).setTitle(title).setDescription(`**${clip(item.name, 80)}**`);
      if (event.startsWith('emoji') && event.endsWith('Create')) e.setThumbnail(item.imageURL?.() || null);
      return e;
    });
  });
}
for (const [event, kind] of [['emojiUpdate', 'Эмодзи'], ['stickerUpdate', 'Стикер']]) {
  on(event, async (oldItem, newItem) => {
    if (oldItem.name === newItem.name) return;
    await L.log(newItem.guild.id, 'server', (base) => base(COLORS.edit).setTitle(`✏️ ${kind} переименован`).setDescription(`${clip(oldItem.name, 80)} → ${clip(newItem.name, 80)}`));
  });
}

const eventLine = (ev) => [{ name: 'Событие', value: clip(ev.name, 200), inline: true }, ...(ev.scheduledStartTimestamp ? [{ name: 'Начало', value: ts(ev.scheduledStartTimestamp), inline: true }] : [])];
on('guildScheduledEventCreate', async (ev) => {
  await L.log(ev.guildId, 'server', (base) => base(COLORS.create).setTitle('📅 Создано событие').addFields([...eventLine(ev), ...(ev.creatorId ? [{ name: 'Создатель', value: user(ev.creatorId), inline: true }] : [])]));
});
on('guildScheduledEventDelete', async (ev) => {
  await L.log(ev.guildId, 'server', (base) => base(COLORS.delete).setTitle('📅 Событие удалено').addFields(eventLine(ev)));
});
on('guildScheduledEventUpdate', async (oldEv, ev) => {
  const status = { 1: 'запланировано', 2: 'началось', 3: 'завершено', 4: 'отменено' };
  const changes = [];
  if (oldEv && oldEv.status !== ev.status) changes.push({ name: 'Статус', value: status[ev.status] || String(ev.status), inline: true });
  if (oldEv && oldEv.name !== ev.name) changes.push({ name: 'Новое название', value: clip(ev.name, 200), inline: true });
  if (!oldEv) changes.push({ name: 'Статус', value: status[ev.status] || String(ev.status), inline: true });
  await L.log(ev.guildId, 'server', (base) => base(COLORS.edit).setTitle('📅 Событие изменено').addFields([...eventLine(ev), ...changes]));
});

// ============================== Member cache ==============================
// A role / nickname / avatar change can only be compared with the old state when the member is cached.
// After a restart the cache is empty, so members are loaded once for every guild that has the log forum.
const loaded = new Set();
async function loadMembersForLogs(client) {
  for (const guild of client.guilds.cache.values()) {
    if (loaded.has(guild.id) || !(await L.getConfig(guild.id))) continue;
    loaded.add(guild.id);
    await guild.members.fetch().catch((err) => {
      loaded.delete(guild.id);
      logger.warn(`Log: could not load members of ${guild.id}: ${err?.message || err}`);
    });
  }
}
handlers.push({
  name: 'clientReady',
  once: true,
  execute: safe('clientReady', async (client) => {
    await loadMembersForLogs(client);
    // A forum connected later in the panel is picked up here (the panel is another process).
    setInterval(() => loadMembersForLogs(client).catch(() => {}), 60_000).unref?.();
  })
});
handlers.push({ name: 'guildCreate', execute: safe('guildCreate', async (guild) => loadMembersForLogs(guild.client)) });

module.exports = handlers;
module.exports.loadMembersForLogs = loadMembersForLogs;
module.exports.tempRooms = tempRooms;
