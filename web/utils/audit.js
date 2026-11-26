// The log of the panel (stage 4): changes of the access matrix and every change made by a member with delegated rights.
// Kept in panel_audit (shown on «Права доступа») and, when the server chose a channel, posted there by the bot.
const logger = require('../../bot/utils/logger');

const LABELS = { 'access.grant': 'Права выданы', 'access.revoke': 'Права сняты', 'access.settings': 'Настройки доступа', change: 'Изменение в панели' };

async function record(guildId, userId, action, detail) {
  const { PanelAudit, GuildSettings } = require('../../db');
  const text = String(detail || '').slice(0, 500);
  await PanelAudit.create({ guildId, userId, action, detail: text }).catch((err) => logger.warn(`Panel audit not saved: ${err.message}`));
  try {
    const s = await GuildSettings.findByPk(guildId, { attributes: ['guildId', 'panelAuditChannelId'] });
    const client = require('../botBridge').getClient?.();
    if (!s?.panelAuditChannelId || !client) return;
    const ch = await client.channels.fetch(s.panelAuditChannelId).catch(() => null);
    if (!ch?.send) return;
    const embeds = require('../../bot/utils/embeds');
    await ch.send({ embeds: [embeds.baseEmbed(embeds.COLORS.neutral).setTitle(`Панель: ${LABELS[action] || action}`).setDescription(`${userId ? `<@${userId}>` : 'Кто-то'}: ${text}`)], allowedMentions: { parse: [] } });
  } catch { /* the log channel is optional */ }
}

module.exports = { record, LABELS };
