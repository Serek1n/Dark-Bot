// The public leaderboard (an idea from Polaris): /top/<server id> opens without signing in, but only for servers whose
// admins switched it on (panel → Таблица лидеров). Shows the top 100 by total XP from the chosen minimum level.
const express = require('express');
const { Op } = require('sequelize');
const { MemberProfile, GuildSettings } = require('../../db');
const { getGuild, getUsers, getBotGuildIds } = require('../discordApi');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const limit = rateLimit({ windowMs: 60_000, max: 60, key: (req) => req.ip, message: 'Слишком много запросов. Подождите минуту.' });
const notFound = (res) => res.status(404).render('error', { message: 'Рейтинг этого сервера не опубликован.' });

router.get('/:guildId', limit, async (req, res) => {
  const { guildId } = req.params;
  if (!/^\d{15,25}$/.test(guildId)) return notFound(res);
  const settings = await GuildSettings.findByPk(guildId);
  if (!settings || !settings.leaderboardPublic || !settings.levelingEnabled || settings.leftAt) return notFound(res);
  if (!(await getBotGuildIds()).has(guildId)) return notFound(res);
  const minLevel = Math.max(0, Number(settings.leaderboardMinLevel) || 0);
  const [guild, top] = await Promise.all([
    getGuild(guildId),
    MemberProfile.findAll({ where: { guildId, xp: { [Op.gt]: 0 }, level: { [Op.gte]: minLevel } }, order: [['xp', 'DESC']], limit: 100 })
  ]);
  const users = await getUsers(top.map((p) => p.userId));
  const { xpForLevel, totalXpForLevel } = require('../../bot/modules/leveling');
  const rows = top.map((p, i) => {
    const into = Math.max(0, Number(p.xp) - totalXpForLevel(p.level));
    const need = xpForLevel(p.level);
    return { place: i + 1, level: p.level, xp: Number(p.xp), into, need, user: users[p.userId] || { name: 'Участник', avatar: '' } };
  });
  res.set('Cache-Control', 'public, max-age=60');
  res.render('public-top', { guild, rows, minLevel });
});

module.exports = router;
