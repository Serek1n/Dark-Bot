const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, botApi } = require('../../discordApi');
const { snowflake, saved, getSettings } = require('../../utils/common');
const updates = require('../../../bot/modules/updates');
const { errorKey } = require('../../../bot/utils/discordErrors');

const router = express.Router();
const NOTE_CHANNEL_TYPES = [0, 5]; // text and announcement channels

// ---- "Обновления": what changed in the bot and the panel, and where the bot posts it ----
router.get('/:guildId/changelog', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId)]);
  res.render('dashboard/changelog', {
    guild, settings, releases: updates.releases(), latest: updates.latest(),
    channels: channels.filter((c) => NOTE_CHANNEL_TYPES.includes(c.type)), active: 'changelog'
  });
});

// The channel for the notes. A newly chosen channel starts from the current release: no backlog of old notes.
router.post('/:guildId/changelog/channel', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const channelId = snowflake(req.body.updatesChannelId);
  if (channelId && !(await getGuildChannels(guildId)).some((c) => c.id === channelId && NOTE_CHANNEL_TYPES.includes(c.type))) {
    return res.redirect(saved(guildId, 'changelog', 'badchannel'));
  }
  if (channelId !== settings.updatesChannelId) settings.updatesLastPosted = updates.latest()?.id || null;
  settings.updatesChannelId = channelId;
  await settings.save();
  res.redirect(saved(guildId, 'changelog'));
});

// Post the newest notes right now (to check how it looks, or to repeat them).
router.post('/:guildId/changelog/send', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const settings = await getSettings(guildId);
  const top = updates.latest();
  if (!settings.updatesChannelId || !top) return res.redirect(saved(guildId, 'changelog', 'invalid'));
  const base = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  const embed = updates.releaseEmbed(top, { panelUrl: base ? `${base}/dashboard/${guildId}/changelog` : null });
  try {
    await botApi.post(`/channels/${settings.updatesChannelId}/messages`, { embeds: [embed.toJSON()], allowed_mentions: { parse: [] } });
    settings.updatesLastPosted = top.id;
    await settings.save();
    res.redirect(saved(guildId, 'changelog', 'notesent'));
  } catch (err) {
    const key = errorKey(err);
    res.redirect(`/dashboard/${guildId}/changelog?whfail=1&reason=${key === 'perm' ? 'panelperm' : key}`);
  }
});

module.exports = router;
