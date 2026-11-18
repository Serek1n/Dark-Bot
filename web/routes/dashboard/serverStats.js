// «Статистика сервера»: the overview (numbers right now, charts by day, the most active members, the server itself) and the
// counters in channel names (create, change the text, remove, update now). The bot side is bot/modules/serverStats.js.
const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild, getGuildChannels, getUsers } = require('../../discordApi');
const { saved, getSettings, snowflake } = require('../../utils/common');
const { getClient } = require('../../botBridge');

const router = express.Router();
const ss = () => require('../../../bot/modules/serverStats');
const PERIODS = [7, 30, 90];

router.get('/:guildId/server-stats', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const days = PERIODS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
  const live = getClient()?.guilds?.cache?.get(guildId) || null;
  const hist = await ss().history(guildId, days);
  const sum = (k) => hist.reduce((s, d) => s + (d[k] || 0), 0);
  const firstMembers = hist.find((d) => d.members)?.members || null;
  const { MemberProfile } = require('../../../db');
  const [byMessages, byVoice, online, split] = await Promise.all([
    MemberProfile.findAll({ where: { guildId }, order: [['messageCount', 'DESC']], limit: 5, attributes: ['userId', 'messageCount'], raw: true }),
    MemberProfile.findAll({ where: { guildId }, order: [['voiceSeconds', 'DESC']], limit: 5, attributes: ['userId', 'voiceSeconds'], raw: true }),
    live ? ss().onlineNow(live).catch(() => null) : null,
    live ? Promise.resolve({ bots: live.members.cache.filter((m) => m.user?.bot).size, exact: live.members.cache.size >= live.memberCount * 0.98 }) : null
  ]);
  const users = await getUsers([...byMessages, ...byVoice].map((r) => r.userId));
  const busiest = hist.reduce((b, d) => (d.messages > (b?.messages || 0) ? d : b), null);
  res.render('dashboard/server-stats', {
    guild, settings, active: 'server-stats', days, PERIODS, hist, chart: require('../../utils/statChart'), live, online, split, users,
    totals: { messages: sum('messages'), joins: sum('joins'), leaves: sum('leaves'), voiceHours: Math.round(sum('voiceMinutes') / 60), voicePeak: Math.max(0, ...hist.map((d) => d.voicePeak)) },
    members: live?.memberCount ?? guild?.approximate_member_count ?? null, firstMembers, busiest,
    byMessages: byMessages.filter((r) => r.messageCount > 0), byVoice: byVoice.filter((r) => r.voiceSeconds > 0), inVoice: live ? ss().inVoice(live) : null, tz: ss().TZ
  });
});

router.get('/:guildId/server-stats-channels', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const [guild, settings, channels] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId)]);
  const live = getClient()?.guilds?.cache?.get(guildId) || null;
  const cfg = ss().read(settings);
  let v = null;
  if (live) v = await ss().values(live).catch(() => null); // every value: the ready-made counters show real numbers
  const counters = cfg.counters.map((c) => {
    const ch = live?.channels?.cache?.get(c.channelId) || channels.find((x) => x.id === c.channelId) || null;
    return { ...c, name: ch?.name || null, next: v ? ss().renderName(c.template, v) : null, problem: ss().problems.get(c.channelId) || null };
  });
  const used = new Set(cfg.counters.map((c) => c.channelId));
  res.render('dashboard/server-stats-channels', {
    guild, settings, active: 'server-stats-channels', S: ss(), cfg, counters, values: v, live: Boolean(live),
    categories: channels.filter((c) => c.type === 4), freeChannels: channels.filter((c) => (c.type === 2 || c.type === 13 || c.type === 0) && !used.has(c.id))
  });
});

const cleanTemplate = (t) => String(t || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);

router.post('/:guildId/server-stats/create', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const live = getClient()?.guilds?.cache?.get(guildId);
  const template = cleanTemplate(req.body.template) || '👥 Участники: {members}';
  const settings = await getSettings(guildId);
  if (!live) return res.redirect(saved(guildId, 'server-stats-channels', 'ssfail'));
  const existing = snowflake(req.body.channelId);
  if (existing) { // an existing channel becomes a counter
    const cfg = ss().read(settings);
    if (cfg.counters.length >= ss().MAX_COUNTERS) return res.redirect(saved(guildId, 'server-stats-channels', 'ssmax'));
    if (!live.channels.cache.get(existing)) return res.redirect(saved(guildId, 'server-stats-channels', 'ssfail'));
    cfg.counters.push({ channelId: existing, template });
    ss().write(settings, cfg); await settings.save();
    ss().refreshGuild(live, { force: true }).catch(() => {});
    return res.redirect(saved(guildId, 'server-stats-channels', 'sscreated'));
  }
  const r = await ss().createCounter(live, settings, template);
  res.redirect(saved(guildId, 'server-stats-channels', r.ok ? 'sscreated' : { max: 'ssmax', perm: 'ssperm' }[r.code] || 'ssfail'));
});

router.post('/:guildId/server-stats/save', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const cfg = ss().read(settings);
  for (const c of cfg.counters) { const t = cleanTemplate(req.body[`t_${c.channelId}`]); if (t) c.template = t; }
  const cat = snowflake(req.body.categoryId);
  cfg.categoryId = cat || null;
  ss().write(settings, cfg); await settings.save();
  const live = getClient()?.guilds?.cache?.get(guildId);
  if (live) ss().refreshGuild(live, { force: true }).catch(() => {});
  res.redirect(saved(guildId, 'server-stats-channels'));
});

router.post('/:guildId/server-stats/remove', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const id = snowflake(req.body.channelId);
  const settings = await getSettings(guildId);
  if (id) await ss().removeCounter(getClient()?.guilds?.cache?.get(guildId) || null, settings, id, req.body.deleteChannel === '1');
  res.redirect(saved(guildId, 'server-stats-channels', 'ssremoved'));
});

router.post('/:guildId/server-stats/refresh', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const live = getClient()?.guilds?.cache?.get(guildId);
  if (live) await ss().refreshGuild(live, { force: true }).catch(() => {});
  res.redirect(saved(guildId, 'server-stats-channels', 'ssrefresh'));
});

module.exports = router;
