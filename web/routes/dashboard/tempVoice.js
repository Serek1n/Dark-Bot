const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild, botApi } = require('../../discordApi');
const { VoiceRole } = require('../../../db');
const { roleGuard } = require('../../utils/roles');
const { snowflake, saved, getSettings } = require('../../utils/common');

const { extraTriggers, MAX_EXTRA } = require('../../../bot/utils/voiceTriggers');

const { pickChannels, noPerm } = require('../../utils/channels');
const router = express.Router();
// what the bot posts goes out in the server's language
const i18nOut = (body, guildId) => require('../../../i18n').translatePayload(body, require('../../../i18n').langOf(guildId));

// ---- Temp voice ----
router.get('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels, allRoles, guard] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId), getGuildRoles(req.params.guildId), roleGuard(req.params.guildId, req.user?.id)]);
  const voiceRoles = await VoiceRole.findAll({ where: { guildId: req.params.guildId }, order: [['id', 'ASC']] });
  res.render('dashboard/temp-voice', { guild, settings, channels, roles: guard.annotate(allRoles), voiceRoles, triggers: extraTriggers(settings), maxTriggers: MAX_EXTRA, active: 'temp-voice' });
});

router.post('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const missing = await pickChannels(req.body, settings, req.params.guildId, { tempVoiceJoinChannelId: 'voice' });
  settings.tempVoiceCategoryId = snowflake(req.body.tempVoiceCategoryId);
  settings.tempVoiceNameTemplate = (req.body.tempVoiceNameTemplate || '').trim().slice(0, 90) || settings.tempVoiceNameTemplate;
  settings.tempVoiceUserLimit = Math.max(0, Math.min(99, parseInt(req.body.tempVoiceUserLimit, 10) || 0));
  // More trigger channels: rows trig_channel[], trig_category[], trig_name[], trig_limit[] (an empty channel drops the row)
  const col = (k) => [].concat(req.body[k] ?? []);
  const chs = col('trig_channel'), cats = col('trig_category'), names = col('trig_name'), limits = col('trig_limit');
  const seen = new Set([settings.tempVoiceJoinChannelId].filter(Boolean));
  const extra = [];
  chs.forEach((c, i) => {
    const channelId = snowflake(c);
    if (!channelId || seen.has(channelId) || extra.length >= MAX_EXTRA) return;
    seen.add(channelId);
    extra.push({ channelId, categoryId: snowflake(cats[i]) || null, name: String(names[i] || '').trim().slice(0, 90), limit: Math.max(0, Math.min(99, parseInt(limits[i], 10) || 0)) });
  });
  settings.tempVoiceTriggers = JSON.stringify(extra);
  await settings.save();
  res.redirect(missing.length ? noPerm(req.params.guildId, 'temp-voice', missing) : saved(req.params.guildId, 'temp-voice'));
});

// ---- Voice roles: a role while in voice ----
router.post('/:guildId/voice-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const roleId = snowflake(req.body.roleId);
  const channelId = snowflake(req.body.channelId);
  const [roles, channels] = await Promise.all([getGuildRoles(guildId), getGuildChannels(guildId)]);
  if (!roleId || !roles.some((r) => r.id === roleId)) return res.redirect(saved(guildId, 'temp-voice', 'invalid'));
  if (channelId && !channels.some((c) => c.id === channelId && [2, 13].includes(c.type))) return res.redirect(saved(guildId, 'temp-voice', 'badchannel'));
  if ((await roleGuard(guildId, req.user?.id)).check(roleId)) return res.redirect(saved(guildId, 'temp-voice', 'rolenotallowed'));
  if ((await VoiceRole.count({ where: { guildId } })) >= 25) return res.redirect(saved(guildId, 'temp-voice', 'toomany'));
  await VoiceRole.findOrCreate({ where: { guildId, roleId, channelId: channelId || null } });
  res.redirect(saved(guildId, 'temp-voice'));
});

router.post('/:guildId/voice-roles/:id/delete', ensureGuildAccess, async (req, res) => {
  await VoiceRole.destroy({ where: { id: Number(req.params.id) || 0, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'temp-voice', 'deleted'));
});

// The message with the buttons that owners of rooms use (rename, close, trust, kick, ban, region, delete).
router.post('/:guildId/temp-voice/panel', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const channelId = snowflake(req.body.channelId);
  const channels = await getGuildChannels(guildId);
  if (!channelId || !channels.some((c) => c.id === channelId && [0, 5].includes(c.type))) return res.redirect(saved(guildId, 'temp-voice', 'invalid'));
  const settings = await getSettings(guildId);
  const payload = require('../../../bot/modules/voiceRoom').panelPayload();
  try {
    const { data } = await botApi.post(`/channels/${channelId}/messages`, i18nOut({ embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } }, guildId));
    if (settings.tempVoicePanelChannelId && settings.tempVoicePanelMessageId) { // the older panel is replaced, not left next to the new one
      await botApi.delete(`/channels/${settings.tempVoicePanelChannelId}/messages/${settings.tempVoicePanelMessageId}`).catch(() => {});
    }
    settings.tempVoicePanelChannelId = channelId;
    settings.tempVoicePanelMessageId = data.id;
    await settings.save();
    res.redirect(saved(guildId, 'temp-voice', 'vpanel'));
  } catch (err) {
    const { errorKey } = require('../../../bot/utils/discordErrors');
    res.redirect(`/dashboard/${guildId}/temp-voice?whfail=1&reason=${errorKey(err) === 'perm' ? 'panelperm' : 'panel'}`);
  }
});

module.exports = router;
