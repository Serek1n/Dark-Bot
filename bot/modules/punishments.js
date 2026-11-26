// Punishments by roles (stage 5), next to Discord's own timeout, kick and ban (bot/modules/moderation.js):
//   role_mute  — the server's mute role: longer than the 28 days of a timeout, or until lifted;
//   quarantine — every role the bot can take is taken and kept (RolePunishment.savedRoles), one quarantine role given;
//                lifting gives them back (roles deleted meanwhile are skipped, the lift never fails because of them);
//   restrict   — one of the server's restriction roles (no media, no voice, no reactions…).
// Each is a case (ModLog), lifted by the scheduler at its end, kept when the member leaves and given again when he
// comes back (onRejoin). Which roles: GuildSettings.modConfig (bot/utils/moduleConfig.js «mod»).
const { Op } = require('sequelize');
const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { RolePunishment, ModLog, CaseNote, MemberSnapshot } = require('../../db');
const mc = require('../utils/moduleConfig');
const logger = require('../utils/logger');
const { formatDuration } = require('../utils/duration');
const { createScheduler, poke } = require('../utils/scheduler');
const { withLock } = require('../utils/lock');

const KINDS = ['role_mute', 'quarantine', 'restrict'];
const TITLE = { role_mute: 'мут ролью', quarantine: 'карантин', restrict: 'ограничение' };
const refusal = (text) => Object.assign(new Error(text), { refusal: true });
const parseIds = (t) => { try { const v = JSON.parse(t || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const botTop = (guild) => guild.members?.me?.roles?.highest?.position ?? Infinity;
const canManageRole = (guild, role) => Boolean(role) && !role.managed && role.id !== guild.id && (role.editable !== undefined ? role.editable : role.position < botTop(guild));

/** The role of a kind on this server: { role } or { error } with a sentence for the moderator. */
function roleFor(guild, cfg, kind, roleId) {
  let id = roleId;
  if (kind === 'role_mute') id = cfg.muteRoleId;
  if (kind === 'quarantine') id = cfg.quarantineRoleId;
  if (kind === 'restrict' && !cfg.restrictRoles.some((r) => r.roleId === roleId)) return { error: 'Эта роль не в списке ограничительных ролей сервера (Наказания → Настройки).' };
  const name = kind === 'role_mute' ? 'Роль мута' : kind === 'quarantine' ? 'Роль карантина' : 'Ограничительная роль';
  if (!id) return { error: `${name} не настроена: выберите её в панели (Наказания → Настройки).` };
  const role = guild.roles.cache.get(id);
  if (!role) return { error: `${name} удалена в Discord: выберите другую в панели (Наказания → Настройки).` };
  if (!canManageRole(guild, role)) return { error: `${name} @${role.name} стоит выше роли бота или управляется интеграцией — бот не может её выдать. Поднимите роль бота выше.` };
  return { role };
}

/** Why the bot cannot punish this member by roles, or null. */
function whyCannotRoles(guild, member) {
  if (member.id === guild.ownerId) return 'Нельзя наказать владельца сервера.';
  if (member.id === guild.client?.user?.id) return 'Нельзя наказать самого бота.';
  if (guild.members?.me && !guild.members.me.permissions?.has?.(P.ManageRoles)) return 'У бота нет права «Управлять ролями».';
  const theirs = member.roles?.highest?.position ?? 0;
  if (theirs >= botTop(guild)) return 'Высшая роль участника не ниже роли бота — бот не может менять его роли. Поднимите роль бота выше.';
  return null;
}

async function dm(guild, userId, text, settings) {
  if (settings && settings.modDmEnabled === false) return;
  await guild.client.users.send(userId, `${text}\n— сервер **${guild.name}**`).catch(() => {});
}

/**
 * Gives a punishment by role. opts: { roleId (restrict), ms (null: until lifted), moderatorId, reason, settings }.
 * Returns { entry, row, skipped } — skipped: roles quarantine could not take (above the bot or of an integration).
 */
async function apply(guild, member, kind, { roleId = null, ms = null, moderatorId, reason, settings } = {}) {
  if (!KINDS.includes(kind)) throw refusal('Неизвестный вид наказания.');
  settings = settings || await require('./leveling').getOrCreateSettings(guild.id);
  const cfg = mc.read(settings, 'mod');
  const { role, error } = roleFor(guild, cfg, kind, roleId);
  if (error) throw refusal(error);
  const why = whyCannotRoles(guild, member);
  if (why) throw refusal(why);
  reason = String(reason || 'Без причины').slice(0, 900);
  return withLock(`rolepun:${guild.id}:${member.id}`, async () => {
    // the same punishment again replaces the running one (its new end counts)
    const same = await RolePunishment.findOne({ where: { guildId: guild.id, userId: member.id, kind, roleId: role.id, active: true } });
    let saved = same?.savedRoles ? parseIds(same.savedRoles) : null; const skipped = [];
    if (kind === 'quarantine' && !same) {
      const take = []; const keep = [];
      for (const r of member.roles.cache.values()) {
        if (r.id === guild.id) continue;
        if (r.managed || !canManageRole(guild, r)) { keep.push(r.id); if (!r.managed) skipped.push(r.id); continue; }
        if (r.id !== role.id) take.push(r.id);
      }
      saved = take;
      try { await member.roles.set([...keep, role.id], `Карантин: ${reason}`.slice(0, 500)); } catch (err) {
        throw refusal(require('../utils/punishable').apiErrorText(err, 'mute'));
      }
    } else {
      try { await member.roles.add(role.id, `${TITLE[kind]}: ${reason}`.slice(0, 500)); } catch (err) {
        throw refusal(require('../utils/punishable').apiErrorText(err, 'mute'));
      }
    }
    const expiresAt = ms ? new Date(Date.now() + ms) : null;
    const { createCase, announceCase } = require('../utils/modlog');
    const entry = await createCase(guild.id, { userId: member.id, moderatorId, action: kind, reason, duration: ms, expiresAt, active: false }); // ModLog.active is for bans; the term lives in RolePunishment
    if (same) await same.update({ active: false, liftedAt: new Date(), liftedBy: moderatorId });
    const row = await RolePunishment.create({ guildId: guild.id, userId: member.id, kind, roleId: role.id, savedRoles: saved ? JSON.stringify(saved) : null, caseNumber: entry.caseNumber, reason, givenBy: moderatorId, expiresAt });
    if (expiresAt) poke('rolepun');
    await announceCase(guild, entry);
    const until = ms ? `на ${formatDuration(ms)}` : 'до снятия модератором';
    const what = kind === 'restrict' ? `ограничение «${cfg.restrictRoles.find((x) => x.roleId === role.id)?.label || role.name}»` : TITLE[kind];
    await dm(guild, member.id, `${kind === 'quarantine' ? '🚧' : '🔇'} Вам выдан ${what} ${until}: ${reason}${kind === 'restrict' ? '' : require('./appeals').appealHint(settings, 'mute')}`, settings);
    return { entry, row, skipped };
  });
}

/** Gives back the roles a quarantine kept: those that still exist and the bot can give. Returns { given, skipped }. */
async function giveBack(guild, member, ids) {
  const given = []; const skipped = [];
  const ok = ids.filter((id) => { const r = guild.roles.cache.get(id); if (!r) return false; if (!canManageRole(guild, r)) { skipped.push(id); return false; } return true; });
  if (!ok.length) return { given, skipped };
  try { await member.roles.add(ok, 'Карантин снят: роли возвращены'); given.push(...ok); } catch {
    for (const id of ok) { try { await member.roles.add(id, 'Карантин снят: роли возвращены'); given.push(id); } catch { skipped.push(id); } }
  }
  return { given, skipped };
}

/**
 * Lifts a punishment by role (a moderator, the panel, the scheduler, an approved appeal). The member who left gets it
 * lifted in his saved roles instead. Returns { ok, given, skipped } or { ok: false } when it was not active.
 */
async function lift(guild, row, { by, reason = null, announce = true } = {}) {
  return withLock(`rolepun:${row.guildId}:${row.userId}`, async () => {
    await row.reload();
    if (!row.active) return { ok: false };
    const member = await guild.members.fetch(row.userId).catch(() => null);
    let given = []; let skipped = [];
    if (member) {
      if (member.roles.cache.has(row.roleId)) await member.roles.remove(row.roleId, `${TITLE[row.kind]} снят`).catch((err) => { if (!require('../utils/discordErrors').isGone(err)) throw refusal(require('../utils/punishable').apiErrorText(err, 'unmute')); });
      if (row.kind === 'quarantine') ({ given, skipped } = await giveBack(guild, member, parseIds(row.savedRoles)));
    } else {
      // he is away: his saved roles (memberRestore) get the punishment lifted
      const snap = await MemberSnapshot.findOne({ where: { guildId: row.guildId, userId: row.userId } });
      if (snap) {
        let ids = parseIds(snap.roleIds).filter((id) => id !== row.roleId);
        if (row.kind === 'quarantine') ids = [...new Set([...ids, ...parseIds(row.savedRoles)])];
        await snap.update({ roleIds: JSON.stringify(ids) });
      }
    }
    await row.update({ active: false, liftedAt: new Date(), liftedBy: by || null });
    const text = reason || (by === guild.client.user.id ? 'Срок закончился' : 'Снято модератором');
    if (row.caseNumber) await CaseNote.create({ guildId: row.guildId, caseNumber: row.caseNumber, authorId: by || null, kind: 'lifted', text: text.slice(0, 1000) }).catch(() => {});
    if (announce) await require('../utils/modlog').recordAndAnnounce(guild, { userId: row.userId, moderatorId: by || guild.client.user.id, action: `un${row.kind}`, reason: `${text}${row.caseNumber ? ` (дело #${row.caseNumber})` : ''}` });
    return { ok: true, given, skipped };
  });
}

/** A new end of a running punishment (null: until lifted). The change is written in its case. */
async function extend(row, ms, by) {
  const old = row.expiresAt;
  const expiresAt = ms ? new Date(Math.max(Date.now(), new Date(row.expiresAt || Date.now()).getTime()) + ms) : null;
  await row.update({ expiresAt });
  if (row.caseNumber) {
    await ModLog.update({ expiresAt, duration: ms ? (expiresAt.getTime() - Date.now()) : null }, { where: { guildId: row.guildId, caseNumber: row.caseNumber } }).catch(() => {});
    await CaseNote.create({ guildId: row.guildId, caseNumber: row.caseNumber, authorId: by, kind: 'duration', text: `Срок изменён: ${old ? new Date(old).toISOString().slice(0, 16).replace('T', ' ') : 'до снятия'} → ${expiresAt ? expiresAt.toISOString().slice(0, 16).replace('T', ' ') : 'до снятия'} (UTC)` });
  }
  if (expiresAt) poke('rolepun');
  return expiresAt;
}

/** The member came back: what is still running is given again (after his saved roles came back). Never throws. */
async function onRejoin(member) {
  try {
    const rows = await RolePunishment.findAll({ where: { guildId: member.guild.id, userId: member.id, active: true } });
    for (const row of rows) {
      if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) { await lift(member.guild, row, { by: member.client.user.id }).catch(() => {}); continue; }
      if (row.kind === 'quarantine') {
        // the roles of before do not come back early: only what the bot cannot take stays, plus the quarantine role
        const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch(() => member);
        const keep = [...fresh.roles.cache.values()].filter((r) => r.id !== member.guild.id && (r.managed || !canManageRole(member.guild, r))).map((r) => r.id);
        await fresh.roles.set([...keep, row.roleId], 'Карантин продолжается после возвращения').catch((err) => logger.warn(`Quarantine on rejoin: ${err.message}`));
      } else {
        await member.roles.add(row.roleId, `${TITLE[row.kind]} продолжается после возвращения`).catch((err) => logger.warn(`Role punishment on rejoin: ${err.message}`));
      }
    }
    return rows.length;
  } catch (err) { logger.warn('Role punishments on rejoin failed:', err.message); return 0; }
}

/** The punishments by roles whose time is up. */
async function tick(client) {
  const due = await RolePunishment.findAll({ where: { active: true, expiresAt: { [Op.lte]: new Date() } }, limit: 50 });
  for (const row of due) {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild) { await row.update({ expiresAt: new Date(Date.now() + 3600_000) }).catch(() => {}); continue; }
    try { await lift(guild, row, { by: client.user.id, reason: 'Срок закончился' }); } catch (err) {
      logger.warn(`Role punishment ${row.id} not lifted: ${err.message}`);
      await row.update({ expiresAt: new Date(Date.now() + 10 * 60_000) }).catch(() => {});
    }
  }
}
let scheduler = null;
function startRolePunishmentScheduler(client) {
  if (scheduler) scheduler.stop();
  scheduler = createScheduler({ name: 'rolepun', nextDue: () => RolePunishment.min('expiresAt', { where: { active: true } }), run: () => tick(client) }).start();
}

// ---- the panel's check of the roles' channel rights ----
const MUTE_DENY = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions', 'Speak', 'Connect'];
const TEXTLIKE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia];
const VOICELIKE = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
/**
 * What is wrong with the mute or quarantine role: [{ text, channels? }]. Mute: channels where it may still write, react
 * or join voice, and channels where another role is explicitly allowed to write (an allow beats its deny). Quarantine:
 * channels it still sees (besides the chosen one).
 */
function checkRole(guild, kind, roleId, keepChannelId = null) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return [{ text: 'Роль удалена в Discord.' }];
  const out = [];
  if (!canManageRole(guild, role)) out.push({ text: 'Роль стоит выше роли бота: бот не сможет её выдать.' });
  const chans = [...guild.channels.cache.values()].filter((c) => [...TEXTLIKE, ...VOICELIKE].includes(c.type));
  const can = (c, perm) => { try { return c.permissionsFor(role).has(perm); } catch { return false; } };
  if (kind === 'role_mute') {
    // the role alone, on top of @everyone: what would a muted member still do
    const write = chans.filter((c) => TEXTLIKE.includes(c.type) && can(c, 'ViewChannel') && can(c, 'SendMessages'));
    const voice = chans.filter((c) => VOICELIKE.includes(c.type) && can(c, 'ViewChannel') && can(c, 'Connect'));
    if (write.length) out.push({ text: `В ${write.length} каналах роль мута не запрещает писать или реагировать.`, channels: write.slice(0, 10).map((c) => c.name) });
    if (voice.length) out.push({ text: `В ${voice.length} голосовых каналах роль мута не запрещает подключаться.`, channels: voice.slice(0, 10).map((c) => c.name) });
    const allowed = chans.filter((c) => [...(c.permissionOverwrites?.cache?.values?.() || [])].some((o) => o.type === 0 && o.id !== role.id && o.id !== guild.id && o.allow?.has?.('SendMessages')));
    if (allowed.length) out.push({ text: `В ${allowed.length} каналах другим ролям явно разрешено писать — такое разрешение сильнее запрета мута.`, channels: allowed.slice(0, 10).map((c) => c.name) });
  }
  if (kind === 'quarantine') {
    const visible = chans.filter((c) => c.id !== keepChannelId && can(c, 'ViewChannel'));
    if (visible.length) out.push({ text: `Роль карантина видит ${visible.length} каналов, кроме канала разбора.`, channels: visible.slice(0, 10).map((c) => c.name) });
    if (keepChannelId && !guild.channels.cache.get(keepChannelId)) out.push({ text: 'Канал разбора удалён в Discord.' });
  }
  return out;
}

/** Puts the role's denies on every channel (mute: no writing, reactions, threads, voice; quarantine: sees only one channel). */
async function fixChannels(guild, kind, roleId, keepChannelId = null) {
  const role = guild.roles.cache.get(roleId);
  if (!role) throw refusal('Роль удалена в Discord.');
  let done = 0; let failed = 0;
  const all = [...guild.channels.cache.values()].filter((c) => [...TEXTLIKE, ...VOICELIKE, ChannelType.GuildCategory].includes(c.type));
  for (const c of all) {
    const set = kind === 'role_mute' ? Object.fromEntries(MUTE_DENY.map((p) => [p, false]))
      : c.id === keepChannelId ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false };
    try { await c.permissionOverwrites.edit(role.id, set, { reason: kind === 'role_mute' ? 'Роль мута: запреты в каналах' : 'Роль карантина: доступ только к каналу разбора' }); done++; } catch { failed++; }
  }
  return { done, failed };
}

module.exports = { KINDS, TITLE, apply, lift, extend, onRejoin, tick, startRolePunishmentScheduler, checkRole, fixChannels, roleFor, whyCannotRoles, canManageRole, giveBack, parseIds };
