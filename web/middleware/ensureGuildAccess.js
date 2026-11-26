const { getBotGuildIds } = require('../discordApi');
const { refreshUserGuilds, isStale } = require('../utils/userGuilds');
const { asyncHandler } = require('../utils/asyncHandler');

const { hasManageAccess, getSettings } = require('../utils/common');

// What the top menu ("Модули ▾") and the module headers need on every page of a server: which modules are on.
async function withModules(req, res, next) {
  if (res.locals) {
    let settings = null;
    try {
      const { moduleState, forViewer } = require('../modules');
      settings = await getSettings(req.params.guildId);
      res.locals.mods = forViewer(moduleState(settings), res.locals.access); // a member with delegated rights sees his part
    } catch (_) { res.locals.mods = null; } // the page builds the list from its own settings; it still opens
    // the server's channels and roles for the lists on the page (grouped by category, with icons and role colours; see
    // js/ui.js). Both are cached by discordApi, so this costs nothing on a page that asks for them anyway.
    if (req.method === 'GET') {
      try {
        const api = require('../discordApi');
        const [ch, ro] = await Promise.all([api.getGuildChannels(req.params.guildId), api.getGuildRoles(req.params.guildId)]);
        res.locals.entities = { channels: (ch || []).map((c) => ({ id: c.id, n: c.name, t: c.type, p: c.parent_id || null, o: c.position || 0 })), roles: (ro || []).map((r) => ({ id: r.id, c: r.color || 0 })) };
        // saved channels and roles that are gone in Discord (only when both lists came: an empty answer proves nothing)
        if (settings && ch && ch.length && ro && ro.length) res.locals.entities.gone = require('../utils/goneRefs')(settings, ch, ro);
      } catch (_) { res.locals.entities = null; }
    }
  }
  next();
}

// The part of the address after /dashboard/:guildId, for the table of scopes (web/utils/access.js).
const subPath = (req, guildId) => {
  const full = String(req.originalUrl || '').split('?')[0];
  const at = full.indexOf(`/${guildId}`);
  return at >= 0 ? full.slice(at + guildId.length + 1) : '';
};

/**
 * Opens a server's pages: who the person is on that server (web/utils/access.js) and whether this address is open to him.
 * req.access / res.locals.access: { full, scopes, member, reason }; req.guildAccess keeps Discord's own rights.
 */
async function ensureGuildAccess(req, res, next) {
  const { guildId } = req.params;
  const access = require('../utils/access');
  const ownerIds = (process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!/^\d{15,25}$/.test(guildId || '')) {
    return res.status(404).render('error', { message: 'Страница не найдена.' });
  }

  let guild = null;
  if (ownerIds.includes(req.user.id)) {
    const present = await getBotGuildIds();
    if (!present.has(guildId)) {
      return res.status(404).render('error', { message: 'Бот не добавлен на этот сервер.' });
    }
    req.guildAccess = { manageable: true, viaOwnerOverride: true };
  } else {
    // The rights are re-read from Discord (at most every 20 s per user), so an admin who lost the role loses the panel quickly,
    // not after the 3 days the session lasts. If Discord cannot confirm them for an hour, the user has to sign in again.
    const fresh = await refreshUserGuilds(req);
    if (isStale(req.user)) {
      return res.status(401).render('error', { message: 'Не удалось подтвердить ваши права на сервере. Выйдите из панели и войдите снова.' });
    }
    guild = fresh.find((g) => g.id === guildId);
    if (!guild) return res.status(403).render('error', { message: 'Вы не участник этого сервера.' });
    const botGuildIds = await getBotGuildIds();
    if (!botGuildIds.has(guildId)) {
      return res.status(404).render('error', { message: 'Бот не добавлен на этот сервер.' });
    }
    // Kept for pages that need more than the panel's own rights (webhooks: "Manage Webhooks").
    req.guildAccess = { manageable: hasManageAccess(guild), owner: Boolean(guild.owner), permissions: String(guild.permissions || '0') };
  }

  // who he is on this server: full access, or the scopes given to him and his roles
  const settings = await getSettings(guildId).catch(() => null);
  const a = await access.resolve(guildId, req.user.id, { guild, settings });
  a.userId = req.user.id;
  // Discord's list of the user's servers could not be refreshed just now (it is kept up to an hour): the bot itself, which
  // is on that server, has read the member's rights right now (access.memberInfo) — an admin who lost the role does not
  // keep the panel meanwhile.
  if (guild && a.full && a.reason === 'manage' && Date.now() - (Number(req.user.guildsOkAt) || 0) > 2 * 60 * 1000 && a.member && !a.member.manage && !a.member.admin) {
    a.full = false; a.scopes = new Set();
  }
  if (!a.full && !a.scopes.size) return res.status(403).render('error', { message: 'У вас нет доступа к панели этого сервера. Его выдают владелец или администраторы на странице «Права доступа».' });
  req.access = a; if (res.locals) res.locals.access = { full: a.full, scopes: [...a.scopes], reason: a.reason };

  // every address needs its scope; one that the table does not name is open to full access only
  const need = access.scopeFor(req.method, subPath(req, guildId));
  if (!a.full && (!need || !access.allows(a, need))) return access.forbidden(req, res, need || []);
  return withModules(req, res, next);
}

module.exports = { ensureGuildAccess: asyncHandler(ensureGuildAccess) };
