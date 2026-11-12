// What the signed-in user may do on this server beyond "Manage Server", read from the rights Discord reported for him
// (req.guildAccess, filled by ensureGuildAccess). One reading for every page that needs it.
const ADMINISTRATOR = 1n << 3n;
const MENTION_EVERYONE = 1n << 17n;
const MANAGE_WEBHOOKS = 1n << 29n;

function panelRights(req) {
  const a = req.guildAccess || {};
  let perms = 0n;
  try { perms = BigInt(a.permissions || '0'); } catch { perms = 0n; }
  const full = Boolean(a.viaOwnerOverride || a.owner || (perms & ADMINISTRATOR));
  return { full, webhooks: full || Boolean(perms & MANAGE_WEBHOOKS), everyone: full || Boolean(perms & MENTION_EVERYONE) };
}

module.exports = { panelRights, ADMINISTRATOR, MENTION_EVERYONE, MANAGE_WEBHOOKS };
