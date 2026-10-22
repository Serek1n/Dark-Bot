const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild } = require('../../discordApi');
const { clampInt, parseWords, snowflake, saved, getSettings } = require('../../utils/common');

const router = express.Router();

// ---- Automod ----
router.get('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const [guild, settings, channels, roles] = await Promise.all([getGuild(req.params.guildId), getSettings(req.params.guildId), getGuildChannels(req.params.guildId), getGuildRoles(req.params.guildId)]);
  res.render('dashboard/automod', {
    guild, settings, channels, roles,
    bannedWords: parseWords(settings.automodBannedWords),
    linkWhitelist: parseWords(settings.automodLinkWhitelist),
    ignoredChannels: parseWords(settings.automodIgnoredChannels),
    ignoredRoles: parseWords(settings.automodIgnoredRoles),
    active: 'automod'
  });
});

router.post('/:guildId/automod', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const lines = (text, max, len) => [...new Set(String(text || '').split(/\r?\n/).map((w) => w.trim().toLowerCase().slice(0, len)).filter(Boolean))].slice(0, max);
  const ids = (v) => [...new Set([].concat(v ?? []).map(snowflake).filter(Boolean))].slice(0, 200);
  settings.automodEnabled = req.body.automodEnabled === 'on';
  settings.automodBlockInvites = req.body.automodBlockInvites === 'on';
  settings.automodAntiSpam = req.body.automodAntiSpam === 'on';
  settings.automodSpamMessages = clampInt(req.body.automodSpamMessages, 2, 30, settings.automodSpamMessages);
  settings.automodSpamSeconds = clampInt(req.body.automodSpamSeconds, 2, 60, settings.automodSpamSeconds);
  settings.automodBannedWords = JSON.stringify(lines(req.body.bannedWords, 500, 64));
  // New rules: 0 switches a numeric rule off
  settings.automodBlockLinks = req.body.automodBlockLinks === 'on';
  settings.automodLinkWhitelist = JSON.stringify(lines(req.body.linkWhitelist, 100, 100).map((d) => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean));
  settings.automodDuplicates = req.body.automodDuplicates === 'on';
  settings.automodProfanity = req.body.automodProfanity === 'on';
  settings.automodZalgo = req.body.automodZalgo === 'on';
  settings.automodMentionLimit = clampInt(req.body.automodMentionLimit, 0, 50, settings.automodMentionLimit);
  settings.automodEmojiLimit = clampInt(req.body.automodEmojiLimit, 0, 100, settings.automodEmojiLimit);
  settings.automodCapsPercent = clampInt(req.body.automodCapsPercent, 0, 100, settings.automodCapsPercent);
  settings.automodCapsMinLength = clampInt(req.body.automodCapsMinLength, 5, 200, settings.automodCapsMinLength);
  // What to do with the author
  settings.automodAction = ['delete', 'warn', 'mute'].includes(req.body.automodAction) ? req.body.automodAction : 'delete';
  settings.automodMuteMinutes = clampInt(req.body.automodMuteMinutes, 1, 40320, settings.automodMuteMinutes);
  // Exceptions
  settings.automodIgnoredChannels = JSON.stringify(ids(req.body.ignoredChannels));
  settings.automodIgnoredRoles = JSON.stringify(ids(req.body.ignoredRoles));
  await settings.save();
  res.redirect(saved(req.params.guildId, 'automod'));
});

module.exports = router;
