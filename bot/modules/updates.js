// "Что нового": the short list of changes in the bot and the panel (changelog.json, newest first), shown on the panel's
// "Обновления" page and posted by the bot into the channel a server chose, once per new release.
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

const FILE = path.join(__dirname, '..', '..', 'changelog.json');
let cached = null;

/** All releases, newest first. Each: { id, bot, panel, date, botChanges[], panelChanges[] }. */
function releases() {
  if (!cached) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (err) { logger.warn(`changelog.json unreadable: ${err.message}`); }
    cached = (Array.isArray(list) ? list : []).map((r) => ({
      ...r,
      id: `${r.bot}/${r.panel}`,
      botChanges: Array.isArray(r.botChanges) ? r.botChanges : [],
      panelChanges: Array.isArray(r.panelChanges) ? r.panelChanges : []
    }));
  }
  return cached;
}

const latest = () => releases()[0] || null;

/** Releases newer than the one with `lastId` (all of them if it is unknown), at most `max`, newest first. */
function newerThan(lastId, max = 3) {
  const list = releases();
  const i = list.findIndex((r) => r.id === lastId);
  return (i === -1 ? list : list.slice(0, i)).slice(0, max);
}

const dateRu = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); };
const bullets = (list) => list.map((x) => `• ${x}`).join('\n').slice(0, 1000);

/** The message about one release. */
function releaseEmbed(r, { panelUrl } = {}) {
  const e = new EmbedBuilder().setColor(0x9a93ff).setTitle(`🌙 Dark обновлён: бот v${r.bot} · панель v${r.panel}`);
  if (r.botChanges.length) e.addFields({ name: 'Бот', value: bullets(r.botChanges) });
  if (r.panelChanges.length) e.addFields({ name: 'Веб-панель', value: bullets(r.panelChanges) });
  if (!r.botChanges.length && !r.panelChanges.length) e.setDescription('Мелкие исправления.');
  if (panelUrl) e.setURL(panelUrl);
  if (r.date) e.setFooter({ text: dateRu(r.date) });
  return e;
}

/**
 * Posts what is new into every server's chosen channel (after a restart with a new version). A server gets the releases it
 * has not seen yet (up to 3), and remembers the newest one. Never throws.
 */
async function announceUpdates(client) {
  const top = latest();
  if (!top) return 0;
  const { GuildSettings } = require('../../db');
  const rows = await GuildSettings.findAll({ where: { updatesChannelId: { [require('sequelize').Op.ne]: null } }, attributes: ['guildId', 'updatesChannelId', 'updatesLastPosted'] }).catch(() => []);
  let posted = 0;
  for (const row of rows) {
    if (row.updatesLastPosted === top.id) continue;
    const guild = client.guilds.cache.get(row.guildId);
    const channel = guild?.channels?.cache?.get(row.updatesChannelId) || (guild ? await guild.channels.fetch(row.updatesChannelId).catch(() => null) : null);
    if (!channel?.send) continue; // the bot left, or the channel is gone: try again after the next restart
    const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
    const list = newerThan(row.updatesLastPosted).reverse(); // oldest first, so the newest ends up at the bottom
    try {
      await channel.send({ embeds: list.map((r) => releaseEmbed(r, { panelUrl: base ? `${base}/dashboard/${row.guildId}/changelog` : null })), allowedMentions: { parse: [] } });
      await GuildSettings.update({ updatesLastPosted: top.id }, { where: { guildId: row.guildId } });
      posted++;
    } catch (err) {
      logger.warn(`Update notes not posted on ${row.guildId}: ${err.message}`);
    }
  }
  if (posted) logger.info(`Update notes v${top.bot}/v${top.panel} posted on ${posted} server(s)`);
  return posted;
}

/** For tests. */
function resetUpdates() { cached = null; }

module.exports = { releases, latest, newerThan, releaseEmbed, announceUpdates, resetUpdates };
