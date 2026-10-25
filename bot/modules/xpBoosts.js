// Role multipliers (an idea from Polaris): a role can pay more XP and coins (boosters ×1.5) or nothing (a "muted" role ×0).
// Stored like channel bonuses: JSON { "<roleId>": { xp, coins } } in GuildSettings.roleBoosts.
//
// How several roles of one member combine (roleBoostMode):
//   largest  — the biggest multiplier among the member's roles (default)
//   smallest — the smallest one
//   highest  — the multiplier of the member's highest role that has one
//   add      — added up: every role adds its bonus over ×1 (×1.5 and ×2 give ×2.5)
//   multiply — multiplied (×1.5 and ×2 give ×3)
// How the role result meets the channel bonus (boostStacking):
//   multiply (default) · add · largest · channel (the channel's bonus wins where there is one) · role (the role's wins)
// A ×0 always wins: a channel or a role that pays nothing is never outvoted.
const { parseBoosts } = require('./leveling');

const ROLE_MODES = ['largest', 'smallest', 'highest', 'add', 'multiply'];
const STACK_MODES = ['multiply', 'add', 'largest', 'channel', 'role'];
const MAX_TOTAL = 20; // a combination never pays more than this

const parsed = new WeakMap(); // settings row -> parsed role table
function roleTable(settings) {
  if (!settings || typeof settings !== 'object') return {};
  let t = parsed.get(settings);
  if (!t) { t = parseBoosts(settings.roleBoosts); parsed.set(settings, t); }
  return t;
}

const round = (n) => Math.round(n * 100) / 100;
const clampTotal = (n) => Math.min(MAX_TOTAL, Math.max(0, round(n)));

/** One currency over several roles. `list`: [{ value, position }]. Empty list = ×1. */
function combineRoles(list, mode) {
  if (!list.length) return 1;
  if (list.some((r) => r.value === 0)) return 0;
  const values = list.map((r) => r.value);
  switch (mode) {
    case 'smallest': return Math.min(...values);
    case 'highest': return list.reduce((a, b) => (b.position > a.position ? b : a)).value;
    case 'add': return clampTotal(1 + values.reduce((s, v) => s + (v - 1), 0));
    case 'multiply': return clampTotal(values.reduce((s, v) => s * v, 1));
    default: return Math.max(...values);
  }
}

/** The role multipliers of a member: { xp, coins, roles: [ids that count] }. Works with a discord.js member or a list of role ids. */
function roleBoostFor(settings, member) {
  const table = roleTable(settings);
  const ids = Object.keys(table);
  if (!ids.length || !member) return { xp: 1, coins: 1, roles: [] };
  const cache = member.roles?.cache;
  const has = (id) => (cache ? cache.has(id) : Array.isArray(member) && member.includes(id));
  const mine = ids.filter(has).map((id) => ({ id, ...table[id], position: cache?.get?.(id)?.position ?? 0 }));
  const mode = ROLE_MODES.includes(settings.roleBoostMode) ? settings.roleBoostMode : 'largest';
  return {
    xp: combineRoles(mine.map((r) => ({ value: r.xp, position: r.position })), mode),
    coins: combineRoles(mine.map((r) => ({ value: r.coins, position: r.position })), mode),
    roles: mine.map((r) => r.id)
  };
}

/** Channel bonus and role bonus of one currency together. */
function stack(channel, role, mode) {
  if (channel === 0 || role === 0) return 0;
  switch (mode) {
    case 'add': return clampTotal(1 + (channel - 1) + (role - 1));
    case 'largest': return Math.max(channel, role);
    case 'channel': return channel !== 1 ? channel : role;
    case 'role': return role !== 1 ? role : channel;
    default: return clampTotal(channel * role);
  }
}

/** Final multipliers for a member in a place: the channel bonus (from boostFor) combined with the member's roles. */
function totalBoost(settings, channelBoost, member) {
  const role = roleBoostFor(settings, member);
  const mode = STACK_MODES.includes(settings?.boostStacking) ? settings.boostStacking : 'multiply';
  const ch = channelBoost || { xp: 1, coins: 1 };
  return { xp: stack(ch.xp, role.xp, mode), coins: stack(ch.coins, role.coins, mode) };
}

module.exports = { roleBoostFor, totalBoost, combineRoles, stack, ROLE_MODES, STACK_MODES, MAX_TOTAL };
