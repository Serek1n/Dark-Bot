const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuildChannels, getGuild, botApi } = require('../../discordApi');
const { SavedMessage, ScheduledMessage } = require('../../../db');
const { clampInt, saved } = require('../../utils/common');
const { rateLimit } = require('../../middleware/rateLimit');
const { encrypt } = require('../../../db/crypto');
const kit = require('../../../bot/modules/messageKit');
const sched = require('../../../bot/modules/scheduledMessages');

// ---- Messages: a builder like message.style — text, embeds and link buttons, sent through a webhook or as the bot, edited later,
// kept as drafts and posted on a schedule. Creating and deleting webhooks stays on the "Вебхуки" page. ----
const router = express.Router();
const json = express.json({ limit: '96kb' });
const sendLimit = rateLimit({ windowMs: 60_000, max: 20, message: 'Слишком много сообщений подряд. Подождите минуту.' });
const toolLimit = rateLimit({ windowMs: 60_000, max: 30, message: 'Слишком много запросов. Подождите минуту.' });
const MAX_SAVED = 50;
const CHANNEL_TYPES = [0, 2, 5, 13, 15, 16];
const ZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Minsk', 'Europe/Kyiv', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

const MANAGE_WEBHOOKS = 1n << 29n; const ADMINISTRATOR = 1n << 3n; const MENTION_EVERYONE = 1n << 17n;
function rights(req) {
  const a = req.guildAccess || {};
  let perms = 0n;
  try { perms = BigInt(a.permissions || '0'); } catch { perms = 0n; }
  const full = Boolean(a.viaOwnerOverride || a.owner || (perms & ADMINISTRATOR));
  return { webhooks: full || Boolean(perms & MANAGE_WEBHOOKS), everyone: full || Boolean(perms & MENTION_EVERYONE) };
}

const who = (req) => req.user?.id || null;
// errors go back as text for the page; an English viewer gets them in English
const fail = (res, err, status = 400) => {
  const text = kit.errorText(err);
  res.status(err?.kit ? status : 502).json({ ok: false, error: res.req?.lang === 'en' ? require('../../../i18n').toEnglish(text, true) : text });
};
const parse = (v, fallback) => { try { const x = JSON.parse(v); return x && typeof x === 'object' ? x : fallback; } catch { return fallback; } };

/** The target from the editor, with the right to use webhooks checked. */
function readTarget(req, raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const mode = t.mode === 'webhook' ? 'webhook' : 'channel';
  if (mode === 'webhook' && !rights(req).webhooks) throw new kit.KitError('Отправка через вебхук требует права «Управлять вебхуками» на этом сервере.', 'forbidden');
  return { mode, webhookId: String(t.webhookId || ''), url: String(t.url || '').trim(), channelId: String(t.channelId || ''), threadId: String(t.threadId || '').trim(), threadName: String(t.threadName || '').trim().slice(0, 100) };
}
/** The message without what the person may not do: @everyone only with the right for it. */
function readMessage(req, raw) {
  const msg = kit.cleanMessage(raw);
  if (msg.mentions === 'everyone' && !rights(req).everyone) msg.mentions = 'roles';
  return msg;
}

async function ownHooks(guildId) {
  try {
    const { data } = await botApi.get(`/guilds/${guildId}/webhooks`);
    const settings = await require('../../../db').GuildSettings.findByPk(guildId);
    return data.filter((w) => w.application_id === process.env.DISCORD_CLIENT_ID && w.token && w.id !== settings?.logWebhookId).map((w) => ({ id: w.id, name: w.name, channelId: w.channel_id }));
  } catch { return []; }
}

// Previews show pictures from the links typed in the editor: this page alone may load images from any https address.
function previewImages(req, res, next) {
  const csp = res.get('Content-Security-Policy');
  if (csp) res.set('Content-Security-Policy', csp.replace("img-src 'self' https://cdn.discordapp.com data:", "img-src 'self' https: data:"));
  next();
}

router.get('/:guildId/messages', ensureGuildAccess, previewImages, async (req, res) => {
  const { guildId } = req.params;
  const r = rights(req);
  const [guild, channels, savedList, scheduled, hooks] = await Promise.all([
    getGuild(guildId), getGuildChannels(guildId),
    SavedMessage.findAll({ where: { guildId }, order: [['updatedAt', 'DESC']], attributes: ['id', 'name', 'updatedAt'] }),
    ScheduledMessage.findAll({ where: { guildId }, order: [['enabled', 'DESC'], ['nextRunAt', 'ASC']] }),
    r.webhooks ? ownHooks(guildId) : []
  ]);
  res.render('dashboard/messages', {
    guild, active: 'messages', rights: r, hooks, zones: ZONES, defaultZone: sched.DEFAULT_TZ,
    channels: channels.filter((c) => CHANNEL_TYPES.includes(c.type)).map((c) => ({ id: c.id, name: c.name, type: c.type })),
    savedList, maxSaved: MAX_SAVED, maxScheduled: sched.MAX_PER_GUILD,
    scheduled: scheduled.map((s) => ({ s, rule: sched.describeRule(parse(s.rule, null)), target: parse(s.target, {}) }))
  });
});

// Send now, or edit an earlier message (messageId).
router.post('/:guildId/messages/send', sendLimit, ensureGuildAccess, json, async (req, res) => {
  const { guildId } = req.params;
  try {
    const target = readTarget(req, req.body.target);
    const msg = readMessage(req, req.body.message);
    let messageId = null;
    if (req.body.messageRef) {
      const ref = kit.parseMessageRef(req.body.messageRef);
      if (!ref || (ref.guildId && ref.guildId !== guildId)) throw new kit.KitError('Не понял ID или ссылку сообщения этого сервера.');
      messageId = ref.messageId;
      if (ref.channelId && target.mode === 'channel' && !target.threadId && ref.channelId !== target.channelId) target.threadId = ref.channelId; // a link into a thread
    }
    const to = await kit.resolveTarget(guildId, target);
    const sent = await kit.deliver(to, msg, { messageId, canEveryone: rights(req).everyone });
    res.json({ ok: true, edited: Boolean(messageId), id: sent.id, channelId: sent.channelId, url: `https://discord.com/channels/${guildId}/${sent.channelId}/${sent.id}` });
  } catch (err) { fail(res, err, err?.code === 'forbidden' ? 403 : 400); }
});

// Load a sent message into the editor (to edit it or to make a copy).
router.post('/:guildId/messages/load', toolLimit, ensureGuildAccess, json, async (req, res) => {
  const { guildId } = req.params;
  try {
    const target = readTarget(req, req.body.target);
    const ref = kit.parseMessageRef(req.body.messageRef);
    if (!ref || (ref.guildId && ref.guildId !== guildId)) throw new kit.KitError('Не понял ID или ссылку сообщения этого сервера.');
    let to;
    if (ref.channelId && target.mode === 'channel') { // a link says where the message is, a thread included
      const ch = await botApi.get(`/channels/${ref.channelId}`).then((r) => r.data).catch(() => null);
      if (!ch || ch.guild_id !== guildId) throw new kit.KitError('Канал из ссылки не найден на этом сервере.');
      const thread = [10, 11, 12].includes(ch.type);
      to = { kind: 'channel', channelId: thread ? ch.parent_id : ch.id, threadId: thread ? ch.id : '', forum: false };
    } else {
      to = await kit.resolveTarget(guildId, target);
    }
    const message = await kit.fetchMessage(to, ref.messageId);
    res.json({ ok: true, message, messageId: ref.messageId });
  } catch (err) { fail(res, err, err?.code === 'forbidden' ? 403 : 400); }
});

// ---- Saved messages ----
router.get('/:guildId/messages/saved/:id', ensureGuildAccess, async (req, res) => {
  const row = await SavedMessage.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId: req.params.guildId } });
  if (!row) return res.status(404).json({ ok: false, error: 'Сообщение не найдено.' });
  res.json({ ok: true, id: row.id, name: row.name, state: parse(row.data, {}) });
});

router.post('/:guildId/messages/saved', toolLimit, ensureGuildAccess, json, async (req, res) => {
  const { guildId } = req.params;
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) throw new kit.KitError('Дайте сообщению название.');
    kit.cleanMessage(req.body.state?.message); // only what could be sent is kept
    const state = { message: req.body.state.message, target: { ...(req.body.state.target || {}), url: '' } }; // a webhook link is never stored in a draft
    const data = JSON.stringify(state);
    if (data.length > 90_000) throw new kit.KitError('Сообщение слишком большое.');
    const id = clampInt(req.body.id, 0, 2147483647, 0);
    if (id) {
      const row = await SavedMessage.findOne({ where: { id, guildId } });
      if (!row) throw new kit.KitError('Сообщение не найдено.');
      await row.update({ name, data });
      return res.json({ ok: true, id: row.id });
    }
    if (await SavedMessage.count({ where: { guildId } }) >= MAX_SAVED) throw new kit.KitError(`Можно сохранить не больше ${MAX_SAVED} сообщений. Удалите ненужные.`);
    const row = await SavedMessage.create({ guildId, name, data, createdBy: who(req) });
    res.json({ ok: true, id: row.id });
  } catch (err) { fail(res, err); }
});

router.post('/:guildId/messages/saved/:id/delete', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  await SavedMessage.destroy({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId } });
  res.redirect(saved(guildId, 'messages', 'deleted') + '#saved');
});

// ---- Scheduled messages ----
router.get('/:guildId/messages/schedule/:id', ensureGuildAccess, async (req, res) => {
  const row = await ScheduledMessage.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId: req.params.guildId } });
  if (!row) return res.status(404).json({ ok: false, error: 'Запись не найдена.' });
  res.json({ ok: true, id: row.id, name: row.name, message: parse(row.data, {}), target: { ...parse(row.target, {}), url: '' }, hasUrl: Boolean(row.webhookUrl), rule: parse(row.rule, {}), timezone: row.timezone });
});

router.post('/:guildId/messages/schedule', toolLimit, ensureGuildAccess, json, async (req, res) => {
  const { guildId } = req.params;
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) throw new kit.KitError('Дайте записи название.');
    const id = clampInt(req.body.id, 0, 2147483647, 0);
    const existing = id ? await ScheduledMessage.findOne({ where: { id, guildId } }) : null;
    if (id && !existing) throw new kit.KitError('Запись не найдена.');
    if (!id && await ScheduledMessage.count({ where: { guildId } }) >= sched.MAX_PER_GUILD) throw new kit.KitError(`Можно запланировать не больше ${sched.MAX_PER_GUILD} сообщений.`);
    const msg = readMessage(req, req.body.message);
    const target = readTarget(req, req.body.target);
    const { rule, timezone } = sched.cleanRule(req.body.rule, req.body.timezone);
    const next = sched.nextRun(rule, timezone);
    if (!next) throw new kit.KitError('Все указанные даты уже прошли.');
    // the target is checked now, so a mistake shows up here and not at the time of sending
    let webhookUrl = existing?.webhookUrl || null;
    if (target.mode === 'webhook' && target.url) webhookUrl = encrypt(target.url);
    if (target.mode !== 'webhook' || (target.webhookId && !target.url)) webhookUrl = null;
    const { decrypt } = require('../../../db/crypto');
    await kit.resolveTarget(guildId, target, { webhookUrl: webhookUrl ? decrypt(webhookUrl) : null });
    const fields = {
      name, data: JSON.stringify(msg), target: JSON.stringify({ ...target, url: '' }), webhookUrl,
      rule: JSON.stringify(rule), timezone, nextRunAt: new Date(next), enabled: true, canEveryone: msg.mentions === 'everyone', lastError: null
    };
    const row = existing ? await existing.update(fields) : await ScheduledMessage.create({ guildId, createdBy: who(req), ...fields });
    require('../../../bot/utils/scheduler').poke('messages');
    res.json({ ok: true, id: row.id, nextRunAt: new Date(next).toISOString() });
  } catch (err) { fail(res, err, err?.code === 'forbidden' ? 403 : 400); }
});

async function scheduleRow(req) {
  return ScheduledMessage.findOne({ where: { id: clampInt(req.params.id, 1, 2147483647, 0), guildId: req.params.guildId } });
}
router.post('/:guildId/messages/schedule/:id/toggle', ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const row = await scheduleRow(req);
  if (!row) return res.redirect(saved(guildId, 'messages', 'invalid'));
  if (row.enabled) await row.update({ enabled: false });
  else {
    const next = sched.nextRun(parse(row.rule, null), row.timezone);
    if (!next) return res.redirect(saved(guildId, 'messages', 'msgpast') + '#schedule');
    await row.update({ enabled: true, nextRunAt: new Date(next), lastError: null });
    require('../../../bot/utils/scheduler').poke('messages');
  }
  res.redirect(saved(guildId, 'messages') + '#schedule');
});
router.post('/:guildId/messages/schedule/:id/delete', ensureGuildAccess, async (req, res) => {
  const row = await scheduleRow(req);
  if (row) await row.destroy();
  res.redirect(saved(req.params.guildId, 'messages', 'deleted') + '#schedule');
});
router.post('/:guildId/messages/schedule/:id/test', sendLimit, ensureGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const row = await scheduleRow(req);
  if (!row) return res.redirect(saved(guildId, 'messages', 'invalid'));
  if (parse(row.target, {}).mode === 'webhook' && !rights(req).webhooks) return res.redirect(saved(guildId, 'messages', 'msgnoright') + '#schedule');
  try {
    await sched.sendEntry(row);
    res.redirect(saved(guildId, 'messages', 'msgtest') + '#schedule');
  } catch (err) {
    await row.update({ lastError: kit.errorText(err).slice(0, 250) }).catch(() => {});
    res.redirect(saved(guildId, 'messages', 'msgfail') + '#schedule');
  }
});

// ---- Tools ----
router.post('/:guildId/messages/webhook-info', toolLimit, ensureGuildAccess, json, async (req, res) => {
  try {
    const info = await kit.webhookInfo(req.body.url);
    res.json({ ok: true, info: { ...info, sameGuild: info.guildId === req.params.guildId } });
  } catch (err) { fail(res, err); }
});

module.exports = router;
