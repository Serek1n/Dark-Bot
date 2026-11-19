// The owners of the platform (BOT_OWNER_IDS) see «Платформа DARK» in the profile menu and on the catalog pages, with the
// size of the moderation queue: without it a community sent for checking was nowhere to be found in the panel.
let cache = { at: 0, value: null };

module.exports = async function platformQueue(req, res, next) {
  res.locals.platformQueue = null;
  if (req.method !== 'GET') cache.at = 0; // a decision changes the queue at once
  try {
    if (!req.user || !require('../../bot/modules/darkCoins').isPlatformOwner(req.user.id)) return next();
    if (Date.now() - cache.at > 20000) cache = { at: Date.now(), value: await require('../../bot/modules/communities').queue() };
    res.locals.platformQueue = cache.value || { total: 0 };
  } catch { res.locals.platformQueue = { total: 0 }; }
  next();
};
