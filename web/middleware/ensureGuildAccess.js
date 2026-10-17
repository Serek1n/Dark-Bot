const { getBotGuildIds } = require('../discordApi');
const { refreshUserGuilds, isStale } = require('../utils/userGuilds');
const { asyncHandler } = require('../utils/asyncHandler');

const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;

function hasManageAccess(guild) {
  if (guild.owner) return true;
  const perms = BigInt(guild.permissions || 0);
  return (perms & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD) || (perms & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR);
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
    return next();
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

  req.guildAccess = { manageable: true };
  next();
}

module.exports = { ensureGuildAccess: asyncHandler(ensureGuildAccess) };
