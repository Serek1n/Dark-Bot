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

// The public page says "updated once a minute": the ranking of a server is built once a minute, every other visitor in that
// minute gets the same rows without asking the database and Discord again.
const PAGE_TTL_MS = 60_000;
const pages = new Map(); // guildId:minLevel -> { rows, expires }

router.get('/:guildId', limit, async (req, res) => {
  const { guildId } = req.params;
  if (!/^\d{15,25}$/.test(guildId)) return notFound(res);
  const settings = await GuildSettings.findByPk(guildId);
  if (!settings || !settings.leaderboardPublic || !settings.levelingEnabled || settings.leftAt) return notFound(res);
  if (!(await getBotGuildIds()).has(guildId)) return notFound(res);
  const minLevel = Math.max(0, Number(settings.leaderboardMinLevel) || 0);
  const key = `${guildId}:${minLevel}`;
  const hit = pages.get(key);
  const [guild, rows] = await Promise.all([
    getGuild(guildId),
    hit && hit.expires > Date.now() ? hit.rows : (async () => {
      const top = await MemberProfile.findAll({ where: { guildId, xp: { [Op.gt]: 0 }, level: { [Op.gte]: minLevel } }, attributes: ['userId', 'xp', 'level'], order: [['xp', 'DESC']], limit: 100, raw: true });
      const users = await getUsers(top.map((p) => p.userId));
      const { xpForLevel, totalXpForLevel } = require('../../bot/modules/leveling');
      const list = top.map((p, i) => {
        const into = Math.max(0, Number(p.xp) - totalXpForLevel(p.level));
        const need = xpForLevel(p.level);
        return { place: i + 1, level: p.level, xp: Number(p.xp), into, need, user: users[p.userId] || { name: 'Участник', avatar: '' } };
      });
      pages.delete(key); pages.set(key, { rows: list, expires: Date.now() + PAGE_TTL_MS });
      if (pages.size > 200) pages.delete(pages.keys().next().value);
      return list;
    })()
  ]);
  res.set('Cache-Control', 'public, max-age=60');
  res.render('public-top', { guild, rows, minLevel });
});

module.exports = router;
