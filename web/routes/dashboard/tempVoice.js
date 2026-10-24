const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, botApi } = require('../../discordApi');
const { snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Temp voice ----
router.get('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId)]);
  res.render('dashboard/temp-voice', { guild, settings, channels, active: 'temp-voice' });
});

router.post('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  settings.tempVoiceJoinChannelId = snowflake(req.body.tempVoiceJoinChannelId);
  settings.tempVoiceCategoryId = snowflake(req.body.tempVoiceCategoryId);
  settings.tempVoiceNameTemplate = (req.body.tempVoiceNameTemplate || '').trim().slice(0, 90) || settings.tempVoiceNameTemplate;
  await settings.save();
  res.redirect(saved(req.params.guildId, 'temp-voice'));
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
    const { data } = await botApi.post(`/channels/${channelId}/messages`, { embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } });
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
