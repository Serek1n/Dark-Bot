// Personal voice rooms: the control panel (buttons under one message) and the commands of /voice share these actions.
// The owner of a room can rename it, close or hide it, trust, invite, kick and ban people, pick the voice region and delete it.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  MessageFlags, PermissionFlagsBits, OverwriteType
} = require('discord.js');
const { TempVoiceChannel, VoiceRoomPref, VoiceRoomLog } = require('../../db');
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

// The panel, in three sections (like the best room bots do it): the room itself, the people, the owner.
// [id, icon, name, what it does]
const SECTIONS = [
  ['Комната', [
    ['name', '✏️', 'Название', 'переименовать комнату'],
    ['limit', '👥', 'Лимит', 'сколько человек может зайти'],
    ['access', '🔒', 'Доступ', 'открыть, закрыть или скрыть'],
    ['region', '🌍', 'Регион', 'регион голосового сервера'],
    ['bitrate', '📶', 'Битрейт', 'качество звука']]],
  ['Участники', [
    ['invite', '📨', 'Пригласить', 'позвать в личные сообщения'],
    ['trust', '🛡️', 'Доверять', 'пускать, даже когда закрыто'],
    ['untrust', '🚫', 'Не доверять', 'убрать из доверенных'],
    ['ban', '⛔', 'Забанить', 'запретить вход'],
    ['unban', '✅', 'Разбанить', 'снять запрет']]],
  ['Владелец', [
    ['kick', '👢', 'Выгнать', 'отключить от голоса'],
    ['transfer', '🔁', 'Передать', 'отдать комнату другому'],
    ['claim', '👑', 'Забрать', 'если владелец ушёл'],
    ['info', 'ℹ️', 'Инфо', 'сведения о комнате'],
    ['delete', '🗑️', 'Удалить', 'удалить комнату']]]
];
const BUTTONS = SECTIONS.flatMap(([, list]) => list);

/**
 * The message with the buttons that is posted into a control channel: one framed card (Discord's components v2) with the
 * three sections, each a line of icons with names and a row of icon buttons under it. The icons are the bot's own line
 * icons (bot/modules/appEmojis.js); until they are uploaded, ordinary emojis stand in. lang: the server's language.
 */
function panelPayload({ lang, look = null } = {}) {
  const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
  const i18n = require('../../i18n');
  const tr = (text) => (lang ? i18n.t(text, lang) : i18n.t(text));
  const appearance = require('./appearance');
  // «Оформление»: own icons or ordinary emojis, the lines with the names of the buttons, names on the buttons, the title,
  // the text under it and the colour of the frame (bot/modules/appearance.js)
  const shape = (look || appearance.read(null)).targets.voicePanel;
  const own = require('./appEmojis');
  const icons = shape.card ? own : { inline: (id, fb) => fb, emoji: (id, fb) => fb };
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
  const title = shape.headline || tr('Управление комнатой');
  const intro = shape.intro || tr('Зайдите в свою комнату и нажмите кнопку. Настройки запоминаются для следующего раза.\nСвоей комнаты нет? Зайдите в канал-создатель — бот сделает её и отдаст вам.');
  const box = new ContainerBuilder().setAccentColor(look ? appearance.embedColor(look) : 0x9a93ff)
    .addTextDisplayComponents(text(`### ${icons.inline('mic', '🎙️')} ${title}\n${intro}`));
  for (const [section, list] of SECTIONS) {
    box.addSeparatorComponents(line());
    if (shape.text) box.addTextDisplayComponents(text(`**${tr(section)}**\n${list.map(([id, emoji, label]) => `${icons.inline(id, emoji)} ${tr(label)}`).join(' · ')}`));
    else box.addTextDisplayComponents(text(`**${tr(section)}**`));
    box.addActionRowComponents(new ActionRowBuilder().addComponents(list.map(([id, emoji, label]) => {
      const b = new ButtonBuilder().setCustomId(`${PREFIX}${id}`).setEmoji(icons.emoji(id, emoji)).setStyle(ButtonStyle.Secondary);
      return shape.labels ? b.setLabel(tr(label)) : b;
    })));
  }
  box.addSeparatorComponents(line()).addTextDisplayComponents(text(`-# ${tr('DARK · личные комнаты')}`));
  return { flags: MessageFlags.IsComponentsV2, components: [box], allowedMentions: { parse: [] } };
}

/**
 * Panels posted before the new look get it on start (the message is edited in place; nothing new is posted). A panel that
 * can't be edited keeps its old look until an admin posts it again from the panel page or /voice panel.
 */
async function refreshPanels(client) {
  const { GuildSettings } = require('../../db');
  const { Op } = require('sequelize');
  const rows = await GuildSettings.findAll({ where: { tempVoicePanelMessageId: { [Op.ne]: null } }, attributes: ['guildId', 'tempVoicePanelChannelId', 'tempVoicePanelMessageId', 'appearance'] });
  const i18n = require('../../i18n');
  let done = 0;
  for (const r of rows) {
    const guild = client.guilds.cache.get(r.guildId);
    const channel = guild && r.tempVoicePanelChannelId ? await guild.channels.fetch(r.tempVoicePanelChannelId).catch(() => null) : null;
    const msg = channel?.messages ? await channel.messages.fetch(r.tempVoicePanelMessageId).catch(() => null) : null;
    if (!msg || msg.author?.id !== client.user.id) continue;
    const payload = panelPayload({ lang: i18n.langOf(r.guildId), look: require('./appearance').read(r) });
    const ok = await msg.edit({ content: null, embeds: [], ...payload }).then(() => true).catch((err) => { logger.warn(`Room panel ${r.guildId}: ${err.message}`); return false; });
    if (ok) done++;
  }
  if (done) logger.info(`Room panels refreshed: ${done}`);
  return done;
}

// ---------------------------------------------------------------- what owners may do, remembered settings, history
// The admin may forbid some actions to owners (JSON in tempVoiceOwnerPerms); staff with "Управлять каналами" may always.
const OWNER_PERMS = [['name', 'Название'], ['limit', 'Лимит'], ['access', 'Доступ (закрыть и скрыть)'], ['region', 'Регион'], ['bitrate', 'Битрейт'],
  ['invite', 'Приглашать'], ['trust', 'Доверять и убирать доверие'], ['ban', 'Банить и разбанивать'], ['kick', 'Выгонять'], ['transfer', 'Передавать комнату'], ['claim', 'Забирать комнату ушедшего владельца']];
const PERM_OF = { untrust: 'trust', unban: 'ban' };
const parseJson = (t, d) => { try { const v = JSON.parse(t || ''); return v ?? d; } catch { return d; } };
function ownerPerms(settings) {
  const raw = parseJson(settings?.tempVoiceOwnerPerms, {});
  return Object.fromEntries(OWNER_PERMS.map(([k]) => [k, raw[k] !== false]));
}
function ownerMay(settings, kind, member) {
  if (member?.permissions?.has?.(P.ManageChannels)) return true;
  const key = PERM_OF[kind] || kind;
  return !OWNER_PERMS.some(([k]) => k === key) || ownerPerms(settings)[key];
}

/** One line of the rooms' history. Never throws. */
async function logRoom(guildId, channel, action, { actorId = null, targetId = null, details = null } = {}) {
  await VoiceRoomLog.create({ guildId, channelId: channel?.id || null, roomName: channel?.name ? String(channel.name).slice(0, 100) : null, actorId, action, targetId, details: details ? String(details).slice(0, 300) : null }).catch(() => {});
}

/** Remembers how the owner set up his room, for the next one (when the server keeps them). */
async function savePrefs(ctx, settings) {
  if (settings?.tempVoiceRemember === false || !ctx?.rec) return;
  const ch = ctx.channel;
  const values = {
    name: ch.name ? String(ch.name).slice(0, 100) : null, userLimit: Number(ch.userLimit) || 0, access: ctx.rec.access || 'open',
    bitrate: ch.bitrate ? Math.round(ch.bitrate / 1000) : null, region: ch.rtcRegion || null,
    trusted: JSON.stringify(trustedIds(ctx).slice(0, 50)), banned: JSON.stringify(bannedIds(ctx).slice(0, 50))
  };
  const [row] = await VoiceRoomPref.findOrCreate({ where: { guildId: ctx.guild.id, userId: ctx.rec.ownerId }, defaults: values }).catch(() => [null]);
  if (row) await row.update(values).catch(() => {});
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
    try { const note = await action(t.member, id); if (note?.skip) { skipped.push(`<@${id}> — ${note.skip}`); continue; } done.push(`<@${id}>`); if (note) skipped.push(`<@${id}> — ${note}`); } catch (err) { logger.warn(`Voice room action failed for ${id}: ${err.message}`); skipped.push(`<@${id}> — Discord отказал (проверьте права бота)`); }
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
      for (const [id, times] of renames) if (times.every((t) => now - t >= 10 * 60_000)) renames.delete(id); // forget rooms renamed long ago (or deleted)
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

// Invitations send DMs from the bot: at most one batch per room owner a minute, so the button cannot be used to spam.
const lastInvite = new Map(); // userId -> time
const isStaff = (m) => Boolean(m?.permissions?.has?.(P.Administrator) || m?.permissions?.has?.(P.ModerateMembers) || m?.permissions?.has?.(P.MoveMembers));

async function invite(ctx, ids) {
  const wait = (lastInvite.get(ctx.member.id) || 0) + 60_000 - Date.now();
  if (wait > 0) fail(`Приглашать можно раз в минуту. Подождите ${Math.ceil(wait / 1000)} с.`);
  lastInvite.set(ctx.member.id, Date.now());
  if (lastInvite.size > 5000) lastInvite.clear();
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
    if (isStaff(m)) return { skip: 'это модератор сервера' };
    await m.voice.disconnect('Владелец комнаты выгнал участника');
  }));
}

async function ban(ctx, ids) {
  return summary('Забанены в комнате', await forEach(ctx, ids, async (m) => {
    if (isStaff(m)) return { skip: 'это модератор сервера' };
    await ctx.channel.permissionOverwrites.edit(m.id, { ViewChannel: false, Connect: false }, { reason: 'Владелец забанил участника в комнате' });
    if (m.voice?.channelId === ctx.channel.id) await m.voice.disconnect('Забанен в комнате').catch(() => {});
    return m.permissions?.has?.(P.Administrator) ? 'у него права администратора, запрет на него не действует' : null;
  }));
}

async function unban(ctx, ids) {
  return summary('Разбанены', await forEach(ctx, ids, (m, id) => ctx.channel.permissionOverwrites.delete(id, 'Владелец снял запрет'), { needInServer: false }));
}

/** Bitrate in kbps: 8 .. what the server allows (96 without boosts, up to 384 with level 3). */
async function setBitrate(ctx, kbps) {
  const n = Number(kbps);
  const max = Math.round((ctx.guild.maximumBitrate || 96000) / 1000);
  if (!Number.isInteger(n) || n < 8 || n > max) fail(`Битрейт — от 8 до ${max} кбит/с (больше — только на сервере с бустами).`);
  await ctx.channel.setBitrate(n * 1000, 'Владелец комнаты изменил битрейт');
  return `Битрейт: **${n} кбит/с**.`;
}
const bitrateChoices = (guild) => [8, 32, 48, 64, 96, 128, 192, 256, 320, 384].filter((n) => n <= Math.round((guild.maximumBitrate || 96000) / 1000));

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
    { name: 'Битрейт', value: ch.bitrate ? `${Math.round(ch.bitrate / 1000)} кбит/с` : '—', inline: true },
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
    return i.showModal(new ModalBuilder().setCustomId(`${PREFIX}m:name:${cid}`).setTitle('Название комнаты').addComponents(
      rowOf(new TextInputBuilder().setCustomId('name').setLabel('Название').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(String(ctx.channel.name || '').slice(0, 100)))));
  }
  if (kind === 'limit') {
    return i.showModal(new ModalBuilder().setCustomId(`${PREFIX}m:limit:${cid}`).setTitle('Лимит участников').addComponents(
      rowOf(new TextInputBuilder().setCustomId('limit').setLabel('Сколько человек может зайти (0 — без лимита)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true).setValue(String(ctx.channel.userLimit || 0)))));
  }
  if (kind === 'bitrate') {
    const now = Math.round((ctx.channel.bitrate || 64000) / 1000);
    return i.reply({ content: `Сейчас: **${now} кбит/с**. Выше — чище звук, но больше трафика:`, components: [rowOf(new StringSelectMenuBuilder().setCustomId(`${PREFIX}s:bitrate:${cid}`).setPlaceholder('Битрейт').addOptions(bitrateChoices(ctx.guild).map((n) => ({ label: `${n} кбит/с`, value: String(n), default: n === now }))))], ...ephemeral });
  }
  if (kind === 'transfer') {
    const ids = [...(ctx.channel.members?.keys?.() || [])].filter((id) => id !== ctx.rec.ownerId && !ctx.channel.members.get(id)?.user?.bot);
    if (!ids.length) return reply(i, 'Передать комнату можно тому, кто сейчас в ней сидит, — а больше никого нет.');
    return i.reply({ content: 'Кому передать комнату? Он станет владельцем, вы — обычным участником.', components: [rowOf(new StringSelectMenuBuilder().setCustomId(`${PREFIX}l:transfer:${cid}`).setPlaceholder('Новый владелец').addOptions(await labelsFor(ctx, ids)))], ...ephemeral });
  }
  if (kind === 'info') return i.reply({ embeds: [describe(ctx)], ...ephemeral });
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
    if (interaction.deferred) return interaction.editReply(payload);
    return replaceMenu ? interaction.update(payload) : interaction.reply({ ...payload, ...ephemeral });
  };
  try {
    if (!guild || !member) return await reply(interaction, 'Комнатами можно управлять только на сервере.');
    const settings = await getOrCreateSettings(guild.id);
    if (!isEnabled(settings, 'tempVoice')) return await reply(interaction, 'Временные голосовые каналы отключены на этом сервере.');

    const parts = interaction.customId.slice(PREFIX.length).split(':'); // panel button: [kind]; follow-up: [type, kind, channelId]
    const kind0 = parts.length === 1 ? parts[0] : parts[1];
    if (!ownerMay(settings, kind0, member)) return await reply(interaction, 'Это действие для владельцев комнат на сервере выключено.');
    if (parts.length === 1 && parts[0] === 'claim') {
      await interaction.deferReply(ephemeral);
      const text = await claim(guild, member);
      const rec = await TempVoiceChannel.findOne({ where: { channelId: member.voice?.channelId || '-' } });
      const channel = rec && (await channelOf(guild, rec.channelId));
      if (channel) { await logRoom(guild.id, channel, 'claim', { actorId: member.id }); await savePrefs({ guild, channel, rec, member }, settings); }
      return answer(text);
    }
    if (parts.length === 1 && parts[0] === 'info') {
      // anyone sitting in a room may look at it
      const rec = member.voice?.channelId && (await TempVoiceChannel.findOne({ where: { channelId: member.voice.channelId } }));
      const channel = rec && (await channelOf(guild, rec.channelId));
      if (channel) return await interaction.reply({ embeds: [describe({ guild, channel, rec, member })], ...ephemeral });
    }
    if (parts.length === 1) return await showMenu(interaction, parts[0], await findRoom(guild, member));

    const [type, kind, channelId] = parts;
    // Changing permissions for several roles or people takes more than Discord's 3 seconds: acknowledge first.
    if (replaceMenu) await interaction.deferUpdate();
    else await interaction.deferReply(ephemeral);
    return await withLock(`voiceroom:${channelId}`, async () => {
      const ctx = await roomById(guild, member, channelId);
      const ids = interaction.values || [];
      let text;
      const field = (k) => { try { return interaction.fields.getTextInputValue(k); } catch { return undefined; } };
      if (type === 'm' && kind === 'limit') text = await rename(ctx, '', field('limit'));
      else if (type === 'm') text = await rename(ctx, field('name'), field('limit'));
      else if (type === 's' && kind === 'access') text = await setAccess(ctx, ids[0]);
      else if (type === 's' && kind === 'region') text = await setRegion(ctx, ids[0]);
      else if (type === 's' && kind === 'bitrate') text = await setBitrate(ctx, ids[0]);
      else if (type === 'l' && kind === 'transfer') text = await transfer(ctx, ids[0]);
      else if ((type === 'u' || type === 'l') && kind === 'trust') text = await trust(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'invite') text = await invite(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'ban') text = await ban(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'untrust') text = await untrust(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'unban') text = await unban(ctx, ids);
      else if ((type === 'u' || type === 'l') && kind === 'kick') text = await kick(ctx, ids);
      else if (type === 'y' && kind === 'delete') text = await removeRoom(ctx);
      else fail('Неизвестное действие.');
      // the history, and the owner's settings for his next room (a deleted room has nothing left to remember)
      await logRoom(guild.id, ctx.channel, kind, { actorId: member.id, targetId: ids.length === 1 ? ids[0] : null, details: ids.length > 1 ? `${ids.length} участников` : null });
      if (kind !== 'delete' && kind !== 'kick' && kind !== 'invite') await savePrefs(ctx, settings);
      return answer(text);
    });
  } catch (err) {
    if (!(err instanceof RoomError)) logger.error('Voice room action failed:', err);
    const text = err instanceof RoomError ? err.message : require('../utils/missingPermissions').explainMissing(err, interaction.guild, interaction.channel) || 'Не получилось выполнить действие. Проверьте, что у бота есть права «Управлять каналами», «Управлять ролями» и «Перемещать участников».';
    if (interaction.deferred) return answer(text, false).catch(() => {});
    if (interaction.replied) return interaction.followUp({ embeds: [embeds.error(text)], ...ephemeral }).catch(() => {});
    return answer(text, false).catch(() => {});
  }
}

module.exports = {
  refreshPanels,
  PREFIX, ACCESS, REGIONS, BUTTONS, SECTIONS, OWNER_PERMS, RoomError, panelPayload, isVoiceRoomComponent, handleVoiceRoomComponent,
  findRoom, roomById, rename, setAccess, trust, untrust, invite, kick, ban, unban, setRegion, setBitrate, bitrateChoices, transfer, claim, removeRoom, describe, trustedIds, bannedIds, renames, lastInvite,
  ownerPerms, ownerMay, logRoom, savePrefs, parseJson
};
