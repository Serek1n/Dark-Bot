// When Discord refuses an action for lack of rights (50013 Missing Permissions, 50001 Missing Access), say exactly what the
// bot needs and where, instead of "an error happened". The refused request (its method and route) tells which rights the action
// takes; the bot's rights in that channel/server are then checked, and the missing ones are listed by name. When all of them
// are there, the cause is the role order (the bot's role below the member or the role it handles), and that is what is said.
const { PermissionFlagsBits: P } = require('discord.js');
const { errorKey } = require('./discordErrors');
const permNames = require('./permissionNames');

const BASE = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

/** Rights an API request needs, from its method, route and body. */
function rightsFor(method, route, body = {}) {
  const m = String(method || '').toUpperCase();
  const r = String(route || '');
  if (/\/channels\/\d+\/messages\/bulk-delete/.test(r)) return { where: 'channel', perms: ['ViewChannel', 'ManageMessages', 'ReadMessageHistory'] };
  if (/\/channels\/\d+\/messages\/\d+\/reactions/.test(r)) return { where: 'channel', perms: m === 'PUT' ? ['ViewChannel', 'ReadMessageHistory', 'AddReactions'] : ['ViewChannel', 'ManageMessages'] };
  if (/\/channels\/\d+\/messages\/\d+$/.test(r)) return { where: 'channel', perms: m === 'DELETE' ? ['ViewChannel', 'ManageMessages'] : ['ViewChannel', 'ReadMessageHistory'] };
  if (/\/channels\/\d+\/messages$/.test(r)) return { where: 'channel', perms: m === 'GET' ? ['ViewChannel', 'ReadMessageHistory'] : [...BASE, ...(body?.files?.length || body?.attachments?.length ? ['AttachFiles'] : [])] };
  if (/\/channels\/\d+\/webhooks/.test(r) || /\/webhooks\/\d+$/.test(r)) return { where: 'channel', perms: ['ViewChannel', 'ManageWebhooks'] };
  if (/\/channels\/\d+\/permissions/.test(r)) return { where: 'channel', perms: ['ViewChannel', 'ManageChannels', 'ManageRoles'] };
  if (/\/channels\/\d+\/threads/.test(r)) return { where: 'channel', perms: ['ViewChannel', 'CreatePublicThreads', 'SendMessagesInThreads'] };
  if (/\/channels\/\d+$/.test(r)) return { where: 'channel', perms: ['ViewChannel', 'ManageChannels'] };
  if (/\/guilds\/\d+\/channels/.test(r)) return { where: 'guild', perms: ['ManageChannels'] };
  if (/\/guilds\/\d+\/members\/\d+\/roles\/\d+/.test(r)) return { where: 'guild', perms: ['ManageRoles'], order: true };
  if (/\/guilds\/\d+\/bans/.test(r)) return { where: 'guild', perms: ['BanMembers'], order: true };
  if (/\/guilds\/\d+\/members\/\d+$/.test(r)) {
    if (m === 'DELETE') return { where: 'guild', perms: ['KickMembers'], order: true };
    const perms = [];
    if (body && 'communication_disabled_until' in body) perms.push('ModerateMembers');
    if (body && 'nick' in body) perms.push('ManageNicknames');
    if (body && 'roles' in body) perms.push('ManageRoles');
    if (body && 'channel_id' in body) perms.push('MoveMembers');
    if (body && 'mute' in body) perms.push('MuteMembers');
    if (body && 'deaf' in body) perms.push('DeafenMembers');
    return { where: 'guild', perms: perms.length ? perms : ['ManageNicknames'], order: true };
  }
  if (/\/guilds\/\d+\/roles/.test(r)) return { where: 'guild', perms: ['ManageRoles'], order: true };
  return null;
}

const routeOf = (err) => { try { return new URL(err.url).pathname.replace(/^\/api\/v\d+/, ''); } catch { return String(err?.url || ''); } };
const bodyOf = (err) => { const b = err?.requestBody?.json; return b && typeof b === 'object' ? b : {}; };

/**
 * A clear text about the rights the bot lacks for this failed action, or null when the error is not about rights.
 * `guild` is where it happened; `fallbackChannel` is used when the request was not about a particular channel.
 */
function explainMissing(err, guild, fallbackChannel = null) {
  if (errorKey(err) !== 'perm' || !guild || !err?.url) return null; // without the refused request we can't know which rights
  const route = routeOf(err);
  const need = rightsFor(err.method, route, bodyOf(err)) || { where: 'channel', perms: BASE };
  const me = guild.members?.me;
  const channelId = route.match(/\/channels\/(\d+)/)?.[1] || fallbackChannel?.id || null;
  const channel = channelId ? guild.channels?.cache?.get(channelId) || (fallbackChannel?.id === channelId ? fallbackChannel : null) : null;
  const where = need.where === 'channel' && channelId ? ` в <#${channelId}>` : ' на сервере';
  if (Number(err.code) === 50001 && channelId) return `Бот не видит канал <#${channelId}>: дайте его роли право «${permNames.name('ViewChannel')}» в настройках канала.`;
  let have = null;
  try { have = need.where === 'channel' && channel?.permissionsFor ? channel.permissionsFor(me) : me?.permissions; } catch { have = null; }
  const missing = have ? need.perms.filter((p) => !have.has(P[p])) : need.perms;
  if (missing.length) {
    return `У бота не хватает прав${where}: ${permNames.list(missing)}. Выдайте их роли бота в настройках сервера (Роли) или в настройках канала.`;
  }
  if (need.order) return 'Права у бота есть, но Discord отказал: роль бота должна быть выше роли участника и тех ролей, которые он выдаёт или снимает. Поднимите роль бота в списке ролей сервера.';
  return `Discord отказал боту${where}. Проверьте права роли бота: ${permNames.list(need.perms)}.`;
}

/** Rights the bot lacks in a channel right now (names of flags), for checks before an action. */
function missingIn(channel, me, perms = BASE) {
  try { const have = channel?.permissionsFor?.(me); return have ? perms.filter((p) => !have.has(P[p])) : []; } catch { return []; }
}

module.exports = { explainMissing, missingIn, rightsFor, BASE };
