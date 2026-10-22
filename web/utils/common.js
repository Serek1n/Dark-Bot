const { GuildSettings } = require('../../db');

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseWords(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

// Discord IDs from forms: accept only real snowflakes (or empty = "not set").
const snowflake = (v) => (/^\d{15,25}$/.test(String(v || '').trim()) ? String(v).trim() : null);

/** Where to go after saving a page: back to it with ?saved=1 (or another flag). */
const saved = (guildId, page, flag = 'saved') => `/dashboard/${guildId}/${page}?${flag}=1`;

const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;
/** Does this server entry (from the user's Discord login) give the right to manage it? */
function hasManageAccess(guild) {
  if (guild.owner) return true;
  const perms = BigInt(guild.permissions || 0);
  return (perms & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD) || (perms & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR);
}

async function getSettings(guildId) {
  const [settings] = await GuildSettings.findOrCreate({ where: { guildId } });
  return settings;
}

module.exports = { clampInt, parseWords, parseJson, snowflake, saved, hasManageAccess, getSettings };
