// The temporary voice rooms the bot knows about: their ids in memory (so an ordinary voice event costs no database
// query) and the clean-up after downtime (a room that emptied while the bot was off would otherwise stay forever).
const { TempVoiceChannel } = require('../../db');
const logger = require('../utils/logger');

let known = null;
let loading = null;

async function ids() {
  if (known) return known;
  loading = loading || TempVoiceChannel.findAll({ attributes: ['channelId'], raw: true }).then((rows) => new Set(rows.map((r) => r.channelId)));
  const set = await loading;
  if (!known) known = set;
  return known;
}

async function isTempRoom(channelId) { return (await ids()).has(channelId); }
function rememberTempRoom(channelId) { if (known) known.add(channelId); }
function forgetTempRoom(channelId) { if (known) known.delete(channelId); }
function resetTempRooms() { known = null; loading = null; }

// Whoever creates a room record (the voice event, a test, a future command) — the set learns about it.
TempVoiceChannel.addHook('afterCreate', 'tempRoomsRemember', (row) => rememberTempRoom(row.channelId));

/** At start: rooms that emptied (or were deleted) while the bot was not running. Returns how many were removed. */
async function sweepTempRooms(client) {
  const rows = await TempVoiceChannel.findAll();
  let removed = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild || guild.available === false) continue; // not on that server right now: its rows wait
    try {
      const channel = await guild.channels.fetch(row.channelId).catch((err) => (err?.code === 10003 || err?.status === 404 ? null : undefined));
      if (channel === undefined) continue; // Discord did not answer: decide next time
      if (channel && channel.members?.size > 0) continue;
      if (channel) await channel.delete('Пустая временная комната').catch(() => {});
      await row.destroy();
      forgetTempRoom(row.channelId);
      removed++;
    } catch (err) {
      logger.warn(`temp room sweep: ${err.message}`);
    }
  }
  if (removed) logger.info(`Temporary rooms removed after downtime: ${removed}`);
  return removed;
}

// ---------------------------------------------------------------- creating a room
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const lastCreate = new Map(); // guildId:userId -> time of the last room made for him
const busy = new Set(); // guildId:userId while his room is being made (two quick joins must not make two rooms)

/**
 * The member joined a "join to create" channel: his room. If he already has one, he is moved there; a new one gets the
 * settings he used last time (name, limit, access, bitrate, region, his trusted and banned people). Limits: one room per
 * person, a pause between new rooms (against join-leave spam), at most N rooms on the server. Returns the room or null.
 */
async function createRoomFor(newState, settings, trigger) {
  const guild = newState.guild; const member = newState.member;
  const key = `${guild.id}:${member.id}`;
  if (busy.has(key)) return null;
  busy.add(key);
  try {
    const room = require('./voiceRoom');
    const notify = (text) => member.send?.({ content: `${text}\n— сервер **${guild.name}**` }).catch(() => {});
    // his own room still exists: back into it, no second room
    const own = await TempVoiceChannel.findOne({ where: { guildId: guild.id, ownerId: member.id } });
    const ownChannel = own && (await guild.channels.fetch(own.channelId).catch(() => null));
    if (own && ownChannel) { await newState.setChannel(ownChannel).catch(() => {}); return ownChannel; }
    if (own && !ownChannel) { await own.destroy().catch(() => {}); forgetTempRoom(own.channelId); }
    const wait = (lastCreate.get(key) || 0) + Math.max(0, Number(settings.tempVoiceCooldownSec) || 0) * 1000 - Date.now();
    if (wait > 0) {
      await newState.setChannel(null, 'Слишком частое создание комнат').catch(() => {});
      await notify(`⏳ Новую комнату можно создать через ${Math.ceil(wait / 1000)} с.`);
      await room.logRoom(guild.id, null, 'spam', { actorId: member.id, details: 'частое создание комнат' });
      return null;
    }
    const max = Math.max(0, Number(settings.tempVoiceMaxRooms) || 0);
    if (max && (await TempVoiceChannel.count({ where: { guildId: guild.id } })) >= max) {
      await newState.setChannel(null, 'Достигнут предел комнат').catch(() => {});
      await notify(`Все ${max} комнат на сервере заняты. Попробуйте позже или зайдите в уже созданную.`);
      return null;
    }
    lastCreate.set(key, Date.now());
    if (lastCreate.size > 5000) for (const [k, t] of lastCreate) if (Date.now() - t > 3600_000) lastCreate.delete(k);

    const pref = settings.tempVoiceRemember !== false ? await require('../../db').VoiceRoomPref.findOne({ where: { guildId: guild.id, userId: member.id } }) : null;
    const { render, buildContext } = require('../utils/replacers');
    const templateName = render(trigger.name, buildContext({ member }), { user: member.displayName }).replace(/<[@#&!]+\d+>/g, '').trim().slice(0, 100) || 'Комната';
    const name = (pref?.name || templateName).slice(0, 100);
    const maxKbps = Math.round((guild.maximumBitrate || 96000) / 1000);
    const kbps = Math.min(maxKbps, Number(pref?.bitrate) || Number(settings.tempVoiceBitrate) || 0);
    const limit = pref?.userLimit ?? trigger.limit ?? 0;
    const banned = room.parseJson(pref?.banned, []).filter((id) => /^\d{15,25}$/.test(id) && id !== member.id).slice(0, 50);
    const trusted = room.parseJson(pref?.trusted, []).filter((id) => /^\d{15,25}$/.test(id) && id !== member.id && !banned.includes(id)).slice(0, 50);
    const channel = await guild.channels.create({
      name, type: ChannelType.GuildVoice, parent: trigger.categoryId || newState.channel.parentId,
      ...(limit ? { userLimit: Math.min(99, limit) } : {}), ...(kbps >= 8 ? { bitrate: kbps * 1000 } : {}), ...(pref?.region ? { rtcRegion: pref.region } : {}),
      // The category's rules, plus the owner: he can always see and enter his room, even when he closes it;
      // his white list may enter, his black list may not.
      permissionOverwrites: [
        ...(newState.channel.parent?.permissionOverwrites?.cache ? [...newState.channel.parent.permissionOverwrites.cache.values()] : []),
        { id: member.id, allow: [P.ViewChannel, P.Connect, P.Speak] },
        ...trusted.map((id) => ({ id, allow: [P.ViewChannel, P.Connect] })),
        ...banned.map((id) => ({ id, deny: [P.ViewChannel, P.Connect] }))
      ]
    });
    const rec = await TempVoiceChannel.create({ guildId: guild.id, channelId: channel.id, ownerId: member.id });
    rememberTempRoom(channel.id);
    // The member may already have left the trigger channel: then the new room would stay empty forever.
    const moved = await newState.setChannel(channel).then(() => true).catch(() => false);
    if (!moved) {
      await channel.delete('Владелец вышел до переноса в комнату').catch(() => {});
      await TempVoiceChannel.destroy({ where: { channelId: channel.id } }).catch(() => {});
      forgetTempRoom(channel.id);
      return null;
    }
    const access = pref?.access || settings.tempVoiceDefaultAccess || 'open';
    if (access !== 'open' && room.ACCESS[access]) await room.setAccess({ guild, channel, rec, member }, access).catch(() => {});
    await room.logRoom(guild.id, channel, 'create', { actorId: member.id, details: pref ? 'с сохранёнными настройками' : null });
    return channel;
  } finally { busy.delete(key); }
}

/**
 * The owner left his room and others stay in it: with automatic hand-over on, the room goes to the one who is there
 * (the first in Discord's list — usually the longest there), and the chat of the room is told.
 */
async function ownerLeft(guild, rec, channel, settings) {
  if (settings?.tempVoiceAutoTransfer === false) return null;
  const heir = [...(channel.members?.values?.() || [])].find((m) => !m.user?.bot && m.id !== rec.ownerId);
  if (!heir) return null;
  const old = rec.ownerId;
  await channel.permissionOverwrites.edit(heir.id, { ViewChannel: true, Connect: true }, { reason: 'Владелец ушёл: комната передана' }).catch(() => {});
  await channel.permissionOverwrites.delete(old, 'Владелец ушёл из комнаты').catch(() => {});
  rec.ownerId = heir.id; await rec.save();
  const room = require('./voiceRoom');
  await room.logRoom(guild.id, channel, 'autotransfer', { targetId: heir.id, details: `прежний владелец: ${old}` });
  await channel.send?.({ content: `👑 <@${old}> вышел — комната теперь у <@${heir.id}>. Управление: панель комнат или \`/voice\`.`, allowedMentions: { users: [heir.id] } }).catch(() => {});
  return heir.id;
}

module.exports = { isTempRoom, rememberTempRoom, forgetTempRoom, resetTempRooms, sweepTempRooms, createRoomFor, ownerLeft, lastCreate };
