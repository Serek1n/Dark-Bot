const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuildRoles, getGuild } = require('../../discordApi');
const { VoiceRole, TempVoiceChannel } = require('../../../db');
const { getUsers } = require('../../discordApi');
const { roleGuard } = require('../../utils/roles');
const { snowflake, saved, getSettings } = require('../../utils/common');

const { extraTriggers, MAX_EXTRA } = require('../../../bot/utils/voiceTriggers');

const { pickChannels, noPerm } = require('../../utils/channels');
const router = express.Router();
// what the bot posts goes out in the server's language
const i18nOut = (body, guildId) => require('../../../i18n').translatePayload(body, require('../../../i18n').langOf(guildId));

// ---- «Временные голосовые»: tabs (the former module «Голосовые роли» is the tab temp-voice-roles) ----
async function pageData(req, page) {
  const { guildId } = req.params;
  const [guild, settings, channels, allRoles, guard] = await Promise.all([getGuild(guildId), getSettings(guildId), getGuildChannels(guildId), getGuildRoles(guildId), roleGuard(guildId, req.user?.id)]);
  const voiceRoles = await VoiceRole.findAll({ where: { guildId }, order: [['id', 'ASC']] });
  return { guild, settings, channels, roles: guard.annotate(allRoles), voiceRoles, voiceRoleCount: voiceRoles.length, triggers: extraTriggers(settings), maxTriggers: MAX_EXTRA, active: page };
}

router.get('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const data = await pageData(req, 'temp-voice');
  const rooms = await TempVoiceChannel.findAll({ where: { guildId: req.params.guildId }, order: [['createdAt', 'DESC']], limit: 50 });
  res.render('dashboard/temp-voice', { ...data, rooms, users: await getUsers(rooms.map((r) => r.ownerId)) });
});
for (const page of ['temp-voice-rooms', 'temp-voice-panel', 'temp-voice-roles']) {
  router.get(`/:guildId/${page}`, ensureGuildAccess, async (req, res) => res.render(`dashboard/${page}`, await pageData(req, page)));
}

router.post('/:guildId/temp-voice', ensureGuildAccess, async (req, res) => {
  const settings = await getSettings(req.params.guildId);
  const missing = await pickChannels(req.body, settings, req.params.guildId, { tempVoiceJoinChannelId: 'voice' });
  settings.tempVoiceCategoryId = snowflake(req.body.tempVoiceCategoryId);
  settings.tempVoiceNameTemplate = String(req.body.tempVoiceNameTemplate || '').trim().slice(0, 90) || settings.tempVoiceNameTemplate;
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
  res.redirect(missing.length ? noPerm(req.params.guildId, 'temp-voice-rooms', missing) : saved(req.params.guildId, 'temp-voice-rooms'));
});

// ---- Voice roles: a role while in voice ----
router.post('/:guildId/voice-roles', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const roleId = snowflake(req.body.roleId);
  const channelId = snowflake(req.body.channelId);
  const [roles, channels] = await Promise.all([getGuildRoles(guildId), getGuildChannels(guildId)]);
  if (!roleId || !roles.some((r) => r.id === roleId)) return res.redirect(saved(guildId, 'temp-voice-roles', 'invalid'));
  if (channelId && !channels.some((c) => c.id === channelId && [2, 13].includes(c.type))) return res.redirect(saved(guildId, 'temp-voice-roles', 'badchannel'));
  if ((await roleGuard(guildId, req.user?.id)).check(roleId)) return res.redirect(saved(guildId, 'temp-voice-roles', 'rolenotallowed'));
  if ((await VoiceRole.count({ where: { guildId } })) >= 25) return res.redirect(saved(guildId, 'temp-voice-roles', 'toomany'));
  await VoiceRole.findOrCreate({ where: { guildId, roleId, channelId: channelId || null } });
  res.redirect(saved(guildId, 'temp-voice-roles'));
});

router.post('/:guildId/voice-roles/:id/delete', ensureGuildAccess, async (req, res) => {
  await VoiceRole.destroy({ where: { id: Number(req.params.id) || 0, guildId: req.params.guildId } });
  res.redirect(saved(req.params.guildId, 'temp-voice-roles', 'deleted'));
});

// The message with the buttons that owners of rooms use (rename, close, trust, kick, ban, region, delete).
router.post('/:guildId/temp-voice/panel', ensureGuildAccess, async (req, res) => {
  const guildId = req.params.guildId;
  const channelId = snowflake(req.body.channelId);
  const channels = await getGuildChannels(guildId);
  if (!channelId || !channels.some((c) => c.id === channelId && [0, 5].includes(c.type))) return res.redirect(saved(guildId, 'temp-voice-panel', 'invalid'));
  const settings = await getSettings(guildId);
  const payload = require('../../../bot/modules/voiceRoom').panelPayload();
  try {
    await require('../../../services/panelMessages').postPanel(settings, channelId, payload, { channel: 'tempVoicePanelChannelId', message: 'tempVoicePanelMessageId' }, (b) => i18nOut(b, guildId));
    res.redirect(saved(guildId, 'temp-voice-panel', 'vpanel'));
  } catch (err) {
    const { errorKey } = require('../../../bot/utils/discordErrors');
    res.redirect(`/dashboard/${guildId}/temp-voice-panel?whfail=1&reason=${errorKey(err) === 'perm' ? 'panelperm' : 'panel'}`);
  }
});

module.exports = router;
