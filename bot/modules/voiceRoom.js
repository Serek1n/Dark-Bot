// Personal voice rooms: the control panel (buttons under one message) and the commands of /voice share these actions.
// The owner of a room can rename it, close or hide it, trust, invite, kick and ban people, pick the voice region and delete it.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  MessageFlags, PermissionFlagsBits, OverwriteType
} = require('discord.js');
const { TempVoiceChannel } = require('../../db');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { withLock } = require('../utils/lock');
const { isEnabled } = require('../utils/features');
const { getOrCreateSettings } = require('./leveling');

const P = PermissionFlagsBits;
const PREFIX = 'vr:';
const ephemeral = { flags: MessageFlags.Ephemeral };

/** A message meant for the person who pressed the button (not a program error). */
class RoomError extends Error {}
const fail = (text) => { throw new RoomError(text); };

const ACCESS = {
  open: { label: 'Открыта для всех', emoji: '🔓', hint: 'зайти может любой' },
  locked: { label: 'Закрыта', emoji: '🔒', hint: 'видна всем, зайти могут только владелец и доверенные' },
  hidden: { label: 'Скрыта', emoji: '🙈', hint: 'не видна и закрыта, зайти могут только владелец и доверенные' }
};

// Voice regions Discord offers for channels (null = chosen automatically).
const REGIONS = [
  ['auto', 'Автоматически'], ['russia', 'Россия'], ['rotterdam', 'Европа (Роттердам)'], ['singapore', 'Сингапур'], ['japan', 'Япония'], ['india', 'Индия'],
  ['hongkong', 'Гонконг'], ['sydney', 'Сидней'], ['southafrica', 'ЮАР'], ['brazil', 'Бразилия'], ['us-east', 'США (восток)'], ['us-west', 'США (запад)'],
  ['us-central', 'США (центр)'], ['us-south', 'США (юг)']
];
const regionName = (id) => (REGIONS.find(([r]) => r === (id || 'auto')) || [null, id])[1];

// id, icon (the buttons carry only the icon), name and a short explanation for the list in the message
const BUTTONS = [
  ['name', '✏️', 'Название', 'переименовать комнату, задать лимит участников'],
  ['access', '🔒', 'Доступ', 'открыть, закрыть или скрыть комнату'],
  ['trust', '🤝', 'Доверить', 'пускать участника, даже если комната закрыта'],
  ['untrust', '🙅', 'Убрать доверие', 'снять доверие с участника'],
  ['invite', '📨', 'Пригласить', 'позвать в комнату личным сообщением'],
  ['kick', '👢', 'Выгнать', 'отключить участника от голоса'],
  ['region', '🌍', 'Регион', 'регион голосового сервера'],
  ['ban', '⛔', 'Забанить', 'запретить участнику заходить в комнату'],
  ['unban', '✅', 'Разбанить', 'снять запрет на вход'],
  ['delete', '🗑️', 'Удалить', 'удалить комнату']
];

/** The message with the buttons that is posted into a control channel. */
function panelPayload() {
  const embed = embeds.baseEmbed().setTitle('Управление личной комнатой').setDescription(
    'Этот интерфейс управляет вашей личной голосовой комнатой. Чтобы её получить, зайдите в канал-создатель: бот сделает комнату, и вы станете её владельцем.\n\n' +
    `${BUTTONS.map(([, emoji, label, hint]) => `${emoji} **${label}** — ${hint}`).join('\n')}\n\n` +
    'Остальное — командами `/voice`: `/voice transfer` передаёт комнату, `/voice claim` забирает её, если владелец вышел.\n\n' +
    '**Чтобы воспользоваться функциями интерфейса, нажмите на кнопки ниже.**'
  );
  // Buttons without names, only icons: what each one does is written in the message above.
  const rows = [0, 5].map((from) => new ActionRowBuilder().addComponents(BUTTONS.slice(from, from + 5).map(([id, emoji]) => new ButtonBuilder()
    .setCustomId(`${PREFIX}${id}`).setEmoji(emoji).setStyle(id === 'delete' ? ButtonStyle.Danger : ButtonStyle.Secondary))));
  return { embeds: [embed], components: rows };
}

const isVoiceRoomComponent = (i) => Boolean((i.isButton?.() || i.isStringSelectMenu?.() || i.isUserSelectMenu?.() || i.isModalSubmit?.()) && String(i.customId || '').startsWith(PREFIX));

// ---------------------------------------------------------------- finding the room
async function channelOf(guild, id) {
  return guild.channels.cache?.get?.(id) || (await guild.channels.fetch(id).catch(() => null));
}

function authorize(rec, member) {
  if (rec.ownerId === member.id) return;
  if (member.permissions?.has?.(P.ManageChannels)) return;
  fail(`Эта комната принадлежит <@${rec.ownerId}>. Если владелец вышел из неё, используйте \`/voice claim\`.`);
}

/** The room the member is sitting in (or, failing that, the one he owns). */
async function findRoom(guild, member) {
  const inId = member.voice?.channelId;
  if (inId) {
    const rec = await TempVoiceChannel.findOne({ where: { channelId: inId } });
    if (rec) {
      const channel = await channelOf(guild, inId);
      if (!channel) { await rec.destroy(); fail('Эта комната уже удалена.'); }
      authorize(rec, member);
      return { guild, channel, rec, member };
    }
  }
  const own = await TempVoiceChannel.findOne({ where: { guildId: guild.id, ownerId: member.id } });
  const channel = own && (await channelOf(guild, own.channelId));
  if (own && !channel) { await own.destroy(); }
  if (!own || !channel) fail('У вас нет личной комнаты. Зайдите в канал-создатель, и бот сделает её для вас (или зайдите в свою комнату).');
  return { guild, channel, rec: own, member };
}

async function roomById(guild, member, channelId) {
  const rec = await TempVoiceChannel.findOne({ where: { channelId, guildId: guild.id } });
  const channel = rec && (await channelOf(guild, channelId));
  if (!rec || !channel) { if (rec) await rec.destroy(); fail('Эта комната уже удалена.'); }
  authorize(rec, member); // checked again at the moment of the action, not only when the button was pressed
  return { guild, channel, rec, member };
}

// ---------------------------------------------------------------- reading the permissions of a room
const botId = (ctx) => ctx.guild.client?.user?.id;
const everyoneOf = (guild) => guild.roles?.everyone?.id || guild.id;
const memberOverwrites = (ctx) => [...(ctx.channel.permissionOverwrites?.cache?.values?.() || [])].filter((o) => o.type === OverwriteType.Member && o.id !== ctx.rec.ownerId && o.id !== botId(ctx));
const trustedIds = (ctx) => memberOverwrites(ctx).filter((o) => o.allow?.has?.(P.Connect)).map((o) => o.id);
const bannedIds = (ctx) => memberOverwrites(ctx).filter((o) => o.deny?.has?.(P.Connect)).map((o) => o.id);
const parseState = (text) => { try { const v = JSON.parse(text || '{}'); return { connect: Array.isArray(v.connect) ? v.connect : [], view: Array.isArray(v.view) ? v.view : [] }; } catch { return { connect: [], view: [] }; } };

async function nameOf(guild, id) {
  const m = guild.members?.cache?.get?.(id) || (await guild.members?.fetch?.(id).catch(() => null));
  return m?.displayName || m?.user?.username || `участник ${id}`;
}

/** A person the owner wants to act on: a real member of the server, not himself, not the owner, not a bot. */
async function target(ctx, id, { needInServer = true } = {}) {
  if (id === ctx.member.id) return { skip: 'это вы сами' };
  if (id === ctx.rec.ownerId) return { skip: 'это владелец комнаты' };
  const member = await ctx.guild.members.fetch(id).catch(() => null);
  if (needInServer && !member) return { skip: 'его нет на сервере' };
  if (member?.user?.bot) return { skip: 'это бот' };
  return { member };
}

/** Runs one action for several people and writes down who was done and who was skipped (and why). */
async function forEach(ctx, ids, action, opts) {
  const done = []; const skipped = [];
  for (const id of [...new Set(ids)].slice(0, 25)) {
    const t = await target(ctx, id, opts);
    if (t.skip) { skipped.push(`<@${id}> — ${t.skip}`); continue; }
    try { const note = await action(t.member, id); done.push(`<@${id}>`); if (note) skipped.push(`<@${id}> — ${note}`); } catch (err) { logger.warn(`Voice room action failed for ${id}: ${err.message}`); skipped.push(`<@${id}> — Discord отказал (проверьте права бота)`); }
  }
  return { done, skipped };
}
const summary = (verb, { done, skipped }) => [done.length ? `${verb}: ${done.join(', ')}.` : 'Никого не изменил.', skipped.length ? `Пропущено: ${skipped.join('; ')}.` : ''].filter(Boolean).join('\n');

// ---------------------------------------------------------------- actions
const renames = new Map(); // channelId -> times of the latest renames: Discord allows 2 per 10 minutes and would make the bot wait

async function rename(ctx, name, limit) {
  const text = String(name ?? '').replace(/[\r\n]+/g, ' ').trim();
  const changes = [];
  if (text) {
    if (text.length > 100) fail('Название не длиннее 100 символов.');
    if (text !== ctx.channel.name) {
      const now = Date.now(); const recent = (renames.get(ctx.channel.id) || []).filter((t) => now - t < 10 * 60_000);
      if (recent.length >= 2) fail(`Discord разрешает менять название комнаты не чаще двух раз за 10 минут. Подождите ${Math.ceil((recent[0] + 10 * 60_000 - now) / 60_000)} мин.`);
      await ctx.channel.setName(text, 'Владелец комнаты изменил название');
      renames.set(ctx.channel.id, [...recent, now]); changes.push(`название: **${text}**`);
    }
  }
  if (limit !== undefined && limit !== null && String(limit).trim() !== '') {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 0 || n > 99) fail('Лимит участников — целое число от 0 до 99 (0 — без лимита).');
    await ctx.channel.setUserLimit(n, 'Владелец комнаты изменил лимит');
    changes.push(n ? `лимит: **${n}**` : 'лимит снят');
  }
  return changes.length ? `Готово: ${changes.join(', ')}.` : 'Ничего не изменилось.';
}

async function setAccess(ctx, mode) {
  if (!ACCESS[mode]) fail('Неизвестный вариант доступа.');
  const ow = ctx.channel.permissionOverwrites;
  const everyone = everyoneOf(ctx.guild);
  await ow.edit(ctx.rec.ownerId, { ViewChannel: true, Connect: true }, { reason: 'Владелец всегда может войти' });
  // A role that the category lets in would beat the lock on @everyone: those roles are switched off too (and back on when opened).
  const state = parseState(ctx.rec.lockState);
  const roles = [...(ow.cache?.values?.() || [])].filter((o) => o.type === OverwriteType.Role && o.id !== everyone);
  const connect = new Set([...state.connect, ...roles.filter((o) => o.allow?.has?.(P.Connect)).map((o) => o.id)]);
  const view = new Set([...state.view, ...roles.filter((o) => o.allow?.has?.(P.ViewChannel)).map((o) => o.id)]);
  for (const id of connect) await ow.edit(id, { Connect: mode === 'open' }, { reason: 'Доступ в комнату изменён' }).catch(() => {});
  for (const id of view) await ow.edit(id, { ViewChannel: mode !== 'hidden' }, { reason: 'Доступ в комнату изменён' }).catch(() => {});
  await ow.edit(everyone, { Connect: mode === 'open' ? null : false, ViewChannel: mode === 'hidden' ? false : null }, { reason: 'Доступ в комнату изменён' });
  ctx.rec.access = mode;
  ctx.rec.lockState = JSON.stringify(mode === 'open' ? { connect: [], view: [] } : { connect: [...connect], view: mode === 'hidden' ? [...view] : [] });
  await ctx.rec.save();
  return `Доступ: ${ACCESS[mode].emoji} **${ACCESS[mode].label}** — ${ACCESS[mode].hint}.`;
}

async function trust(ctx, ids) {
  return summary('Теперь в доверенных', await forEach(ctx, ids, (m, id) => ctx.channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true }, { reason: 'Владелец доверил участнику комнату' })));
}

async function untrust(ctx, ids) {
  return summary('Больше не доверенные', await forEach(ctx, ids, (m, id) => ctx.channel.permissionOverwrites.delete(id, 'Владелец убрал доверие'), { needInServer: false }));
}

async function invite(ctx, ids) {
  const inviteUrl = `https://discord.com/channels/${ctx.guild.id}/${ctx.channel.id}`;
  return summary('Приглашены', await forEach(ctx, ids, async (m, id) => {
    await ctx.channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true }, { reason: 'Владелец пригласил в комнату' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Зайти в комнату').setURL(inviteUrl));
    const sent = await m.send?.({ embeds: [embeds.baseEmbed().setTitle('Вас приглашают в голосовую комнату').setDescription(`**${await nameOf(ctx.guild, ctx.member.id)}** зовёт вас в комнату **${ctx.channel.name}** на сервере **${ctx.guild.name}**.`)], components: [row] }).then(() => true).catch(() => false);
    return sent === false ? 'доступ выдан, но личные сообщения у него закрыты' : null;
  }));
}

async function kick(ctx, ids) {
  return summary('Выгнаны', await forEach(ctx, ids, async (m) => {
    if (m.voice?.channelId !== ctx.channel.id) return 'он не в этой комнате';
    await m.voice.disconnect('Владелец комнаты выгнал участника');
  }));
}

async function ban(ctx, ids) {
  return summary('Забанены в комнате', await forEach(ctx, ids, async (m) => {
    await ctx.channel.permissionOverwrites.edit(m.id, { ViewChannel: false, Connect: false }, { reason: 'Владелец забанил участника в комнате' });
    if (m.voice?.channelId === ctx.channel.id) await m.voice.disconnect('Забанен в комнате').catch(() => {});
    return m.permissions?.has?.(P.Administrator) ? 'у него права администратора, запрет на него не действует' : null;
  }));
}

async function unban(ctx, ids) {
  return summary('Разбанены', await forEach(ctx, ids, (m, id) => ctx.channel.permissionOverwrites.delete(id, 'Владелец снял запрет'), { needInServer: false }));
}

async function setRegion(ctx, region) {
  const known = REGIONS.find(([id]) => id === region);
  if (!known) fail('Неизвестный регион.');
  await ctx.channel.setRTCRegion(region === 'auto' ? null : region, 'Владелец комнаты выбрал регион');
  return `Регион голоса: **${known[1]}**.`;
}

async function transfer(ctx, id) {
  const t = await target(ctx, id);
  if (t.skip) fail(`Нельзя передать комнату: ${t.skip}.`);
  if (t.member.voice?.channelId !== ctx.channel.id) fail('Передать комнату можно только тому, кто сейчас в ней сидит.');
  const old = ctx.rec.ownerId;
  await ctx.channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true }, { reason: 'Новый владелец комнаты' });
  await ctx.channel.permissionOverwrites.delete(old, 'Прежний владелец передал комнату').catch(() => {});
  ctx.rec.ownerId = id; await ctx.rec.save();
  return `Теперь владелец комнаты — <@${id}>.`;
}

/** Takes over a room whose owner has left it. */
async function claim(guild, member) {
  const inId = member.voice?.channelId;
  const rec = inId && (await TempVoiceChannel.findOne({ where: { channelId: inId, guildId: guild.id } }));
  if (!rec) fail('Зайдите в личную комнату, которую хотите забрать.');
  if (rec.ownerId === member.id) fail('Эта комната и так ваша.');
  const channel = await channelOf(guild, inId);
  if (!channel) fail('Эта комната уже удалена.');
  if (channel.members?.has?.(rec.ownerId)) fail(`Владелец <@${rec.ownerId}> сейчас в комнате, забрать её нельзя.`);
  const old = rec.ownerId;
  await channel.permissionOverwrites.edit(member.id, { ViewChannel: true, Connect: true }, { reason: 'Комнату забрал новый владелец' });
  await channel.permissionOverwrites.delete(old, 'Владелец ушёл, комнату забрали').catch(() => {});
  rec.ownerId = member.id; await rec.save();
  return `Теперь вы владелец комнаты **${channel.name}**.`;
}

async function removeRoom(ctx) {
  await ctx.rec.destroy();
  await ctx.channel.delete('Владелец удалил личную комнату');
  return 'Комната удалена.';
}

function describe(ctx) {
  const ch = ctx.channel; const a = ACCESS[ctx.rec.access] || ACCESS.open;
  const list = (ids) => (ids.length ? ids.slice(0, 15).map((id) => `<@${id}>`).join(' ') : '—');
  return embeds.baseEmbed().setTitle(ch.name).addFields(
    { name: 'Владелец', value: `<@${ctx.rec.ownerId}>`, inline: true },
    { name: 'Доступ', value: `${a.emoji} ${a.label}`, inline: true },
    { name: 'Лимит', value: ch.userLimit ? String(ch.userLimit) : 'без лимита', inline: true },
    { name: 'Регион', value: regionName(ch.rtcRegion), inline: true },
    { name: 'Сейчас в комнате', value: String(ch.members?.size ?? 0), inline: true },
    { name: 'Доверенные', value: list(trustedIds(ctx)) },
    { name: 'Забаненные', value: list(bannedIds(ctx)) }
  );
}

// ---------------------------------------------------------------- the panel: buttons, menus, windows
const reply = (i, content) => i.reply({ embeds: [embeds.info(content)], ...ephemeral });
const rowOf = (c) => new ActionRowBuilder().addComponents(c);

async function labelsFor(ctx, ids) {
  const out = [];
  for (const id of ids.slice(0, 25)) out.push({ label: String(await nameOf(ctx.guild, id)).slice(0, 100), value: id });
  return out;
}

async function showMenu(i, kind, ctx) {
  const cid = ctx.channel.id;
  const userMenu = (text, max = 5) => i.reply({ content: text, components: [rowOf(new UserSelectMenuBuilder().setCustomId(`${PREFIX}u:${kind}:${cid}`).setPlaceholder('Выберите участников').setMinValues(1).setMaxValues(max))], ...ephemeral });
  const listMenu = async (text, ids, empty) => {
    if (!ids.length) return reply(i, empty);
    return i.reply({ content: text, components: [rowOf(new StringSelectMenuBuilder().setCustomId(`${PREFIX}l:${kind}:${cid}`).setPlaceholder('Выберите участников').setMinValues(1).setMaxValues(Math.min(ids.length, 10)).addOptions(await labelsFor(ctx, ids)))], ...ephemeral });
  };
  if (kind === 'name') {
    const modal = new ModalBuilder().setCustomId(`${PREFIX}m:name:${cid}`).setTitle('Название и лимит комнаты').addComponents(
      rowOf(new TextInputBuilder().setCustomId('name').setLabel('Название').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(String(ctx.channel.name || '').slice(0, 100))),
      rowOf(new TextInputBuilder().setCustomId('limit').setLabel('Лимит участников (0 — без лимита)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(false).setValue(String(ctx.channel.userLimit || 0))));
    return i.showModal(modal);
  }
  if (kind === 'access') {
    return i.reply({ content: `Сейчас: ${ACCESS[ctx.rec.access]?.emoji || ''} **${ACCESS[ctx.rec.access]?.label || ACCESS.open.label}**. Выберите доступ:`, components: [rowOf(new StringSelectMenuBuilder().setCustomId(`${PREFIX}s:access:${cid}`).setPlaceholder('Кто может зайти').addOptions(Object.entries(ACCESS).map(([value, a]) => ({ label: a.label, description: a.hint.slice(0, 100), value, emoji: a.emoji }))))], ...ephemeral });
  }
  if (kind === 'region') {
    return i.reply({ content: `Сейчас: **${regionName(ctx.channel.rtcRegion)}**. Выберите регион голосового сервера:`, components: [rowOf(new StringSelectMenuBuilder().setCustomId(`${PREFIX}s:region:${cid}`).setPlaceholder('Регион').addOptions(REGIONS.map(([value, label]) => ({ label, value }))))], ...ephemeral });
  }
  if (kind === 'trust') return userMenu('Кому доверить комнату? Доверенные заходят, даже когда она закрыта или скрыта.');
  if (kind === 'invite') return userMenu('Кого пригласить? Бот выдаст доступ и отправит приглашение в личные сообщения.');
  if (kind === 'ban') return userMenu('Кого забанить в этой комнате? Он не сможет ни увидеть её, ни зайти.');
  if (kind === 'untrust') return listMenu('У кого убрать доверие?', trustedIds(ctx), 'Доверенных пока нет.');
  if (kind === 'unban') return listMenu('Кого разбанить?', bannedIds(ctx), 'В комнате никто не забанен.');
  if (kind === 'kick') return listMenu('Кого выгнать из комнаты?', [...(ctx.channel.members?.keys?.() || [])].filter((id) => id !== ctx.rec.ownerId && id !== ctx.member.id && !ctx.channel.members.get(id)?.user?.bot), 'В комнате больше никого нет.');
  if (kind === 'delete') {
    return i.reply({ content: `Удалить комнату **${ctx.channel.name}**? Всех, кто в ней сидит, отключит от голоса.`, components: [rowOf(new ButtonBuilder().setCustomId(`${PREFIX}y:delete:${cid}`).setStyle(ButtonStyle.Danger).setLabel('Да, удалить'))], ...ephemeral });
  }
  return reply(i, 'Неизвестная кнопка.');
}

/** Everything that starts with "vr:" ends up here. Errors meant for the person are shown to him alone. */
async function handleVoiceRoomComponent(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  // A choice made in an ephemeral menu replaces that menu with the result; a window (modal) or a panel button gets a new private message.
  const replaceMenu = !interaction.isModalSubmit?.() && interaction.customId.split(':').length > 2 && typeof interaction.update === 'function';
  const answer = (text, ok = true) => {
    const payload = { content: '', embeds: [ok ? embeds.success(text) : embeds.error(text)], components: [] };
    return replaceMenu ? interaction.update(payload) : interaction.reply({ ...payload, ...ephemeral });
  };
  try {
    if (!guild || !member) return await reply(interaction, 'Комнатами можно управлять только на сервере.');
    const settings = await getOrCreateSettings(guild.id);
    if (!isEnabled(settings, 'tempVoice')) return await reply(interaction, 'Временные голосовые каналы отключены на этом сервере.');

    const parts = interaction.customId.slice(PREFIX.length).split(':'); // panel button: [kind]; follow-up: [type, kind, channelId]
    if (parts.length === 1) return await showMenu(interaction, parts[0], await findRoom(guild, member));

    const [type, kind, channelId] = parts;
    return await withLock(`voiceroom:${channelId}`, async () => {
      const ctx = await roomById(guild, member, channelId);
      const ids = interaction.values || [];
      let text;
      if (type === 'm') text = await rename(ctx, interaction.fields.getTextInputValue('name'), interaction.fields.getTextInputValue('limit'));
      else if (type === 's' && kind === 'access') text = await setAccess(ctx, ids[0]);
      else if (type === 's' && kind === 'region') text = await setRegion(ctx, ids[0]);
      else if ((type === 'u' || type === 'l') && kind === 'trust') text = await trust(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'invite') text = await invite(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'ban') text = await ban(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'untrust') text = await untrust(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'unban') text = await unban(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'kick') text = await kick(ctx, ids);
      else if (type === 'y' && kind === 'delete') text = await removeRoom(ctx);
      else fail('Неизвестное действие.');
      return answer(text);
    });
  } catch (err) {
    if (!(err instanceof RoomError)) logger.error('Voice room action failed:', err);
    const text = err instanceof RoomError ? err.message : 'Не получилось выполнить действие. Проверьте, что у бота есть права «Управлять каналами», «Управлять ролями» и «Перемещать участников».';
    if (interaction.replied || interaction.deferred) return interaction.followUp({ embeds: [embeds.error(text)], ...ephemeral }).catch(() => {});
    return answer(text, false).catch(() => {});
  }
}

module.exports = {
  PREFIX, ACCESS, REGIONS, BUTTONS, RoomError, panelPayload, isVoiceRoomComponent, handleVoiceRoomComponent,
  findRoom, roomById, rename, setAccess, trust, untrust, invite, kick, ban, unban, setRegion, transfer, claim, removeRoom, describe, trustedIds, bannedIds, renames
};
