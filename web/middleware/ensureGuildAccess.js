const { getBotGuildIds } = require('../discordApi');

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

  if (ownerIds.includes(req.user.id)) {
    req.guildAccess = { manageable: true, viaOwnerOverride: true };
    return next();
  }

  const guild = (req.user.guilds || []).find((g) => g.id === guildId);
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

module.exports = { ensureGuildAccess };
