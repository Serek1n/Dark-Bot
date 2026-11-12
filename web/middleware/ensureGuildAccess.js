const { getBotGuildIds } = require('../discordApi');
const { refreshUserGuilds, isStale } = require('../utils/userGuilds');
const { asyncHandler } = require('../utils/asyncHandler');

const { hasManageAccess, getSettings } = require('../utils/common');

// What the top menu ("Модули ▾") and the module headers need on every page of a server: which modules are on.
async function withModules(req, res, next) {
  if (res.locals) {
    try {
      const { moduleState } = require('../modules');
      res.locals.mods = moduleState(await getSettings(req.params.guildId));
    } catch (_) { res.locals.mods = null; } // the page builds the list from its own settings; it still opens
  }
  next();
}

async function ensureGuildAccess(req, res, next) {
  const { guildId } = req.params;
  const ownerIds = (process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!/^\d{15,25}$/.test(guildId || '')) {
    return res.status(404).render('error', { message: 'Страница не найдена.' });
  }

  if (ownerIds.includes(req.user.id)) {
    const present = await getBotGuildIds();
    if (!present.has(guildId)) {
      return res.status(404).render('error', { message: 'Бот не добавлен на этот сервер.' });
    }
    req.guildAccess = { manageable: true, viaOwnerOverride: true };
    return withModules(req, res, next);
  }

  // The rights are re-read from Discord (at most every 20 s per user), so an admin who lost the role loses the panel quickly,
  // not after the 3 days the session lasts. If Discord cannot confirm them for an hour, the user has to sign in again.
  const fresh = await refreshUserGuilds(req);
  if (isStale(req.user)) {
    return res.status(401).render('error', { message: 'Не удалось подтвердить ваши права на сервере. Выйдите из панели и войдите снова.' });
  }
  const guild = fresh.find((g) => g.id === guildId);
  if (!guild || !hasManageAccess(guild)) {
    return res.status(403).render('error', { message: 'У вас нет прав администратора на этом сервере.' });
  }

  const botGuildIds = await getBotGuildIds();
  if (!botGuildIds.has(guildId)) {
    return res.status(404).render('error', { message: 'Бот не добавлен на этот сервер.' });
  }

  // Kept for pages that need more than "Manage Server" (webhooks: "Manage Webhooks").
  req.guildAccess = { manageable: true, owner: Boolean(guild.owner), permissions: String(guild.permissions || '0') };
  return withModules(req, res, next);
}

module.exports = { ensureGuildAccess: asyncHandler(ensureGuildAccess) };
